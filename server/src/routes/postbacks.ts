import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { config } from '../config';
import { adapters, getAdapter, normalizeParams } from '../postbacks/adapters';
import { awardReferralBonus } from '../referrals';

const router = Router();

function clientIp(req: Request): string {
  return (req.ip || '').replace('::ffff:', '');
}

const REDACTED_KEYS = new Set(['token', 'signature', 'identitysignature', 'authorization']);

async function recordAttempt(
  slug: string,
  params: Record<string, unknown>,
  outcome: string,
  ip: string,
  extra: { txnId?: string; subId?: string; rewardCents?: number | null; reason?: string } = {}
): Promise<void> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (REDACTED_KEYS.has(k.toLowerCase())) continue;
    clean[k] = v;
  }
  if (extra.reason) clean._reason = extra.reason;

  const txnId =
    extra.txnId ??
    String(params.transId ?? params.txnId ?? params.txn_id ?? params.transaction_id ?? '');
  const subId = extra.subId ?? String(params.subId ?? params.sub_id ?? params.userId ?? '');
  const reward =
    extra.rewardCents !== undefined && extra.rewardCents !== null
      ? extra.rewardCents
      : params.reward !== undefined && params.reward !== '' && Number.isFinite(Number(params.reward))
        ? Math.round(Number(params.reward))
        : null;

  console.log(
    `[postback:${slug}] attempt outcome=${outcome} txn=${txnId || '-'} subId=${subId || '-'} reward=${reward ?? '-'} ip=${ip || '-'}`
  );

  try {
    await pool.query(
      `INSERT INTO postback_attempts (offerwall_slug, txn_id, sub_id, reward_cents, outcome, ip, raw)
       VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), $4, $5, $6, $7)`,
      [slug, txnId, subId, reward, outcome, ip || null, JSON.stringify(clean)]
    );
  } catch (err) {
    console.error(`[postback:${slug}] failed to record attempt`, err);
  }
}

router.all('/:slug', async (req: Request, res: Response) => {
  const slug = String(req.params.slug);
  const wallResult = await pool.query(
    'SELECT slug, display_name, postback_secret, postback_config FROM offerwalls WHERE slug = $1 AND is_active = TRUE',
    [slug]
  );
  if (!wallResult.rowCount) {
    return res.status(404).json({ ok: false, error: 'unknown offerwall' });
  }
  const wall = wallResult.rowCount ? wallResult.rows[0] : null;
  if (!wall) {
    return res.status(404).json({ ok: false, error: 'unknown offerwall' });
  }

  const query = normalizeParams(req.query as Record<string, unknown>);
  const body =
    req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? normalizeParams(req.body as Record<string, unknown>)
      : {};
  const params = { ...body, ...query };

  const wallConfig = (wall.postback_config || {}) as Record<string, string>;
  const displayName = (wall.display_name as string | null) || 'Offer';
  const adapter = adapters[slug] ? adapters[slug] : getAdapter(slug, wallConfig);
  const ctx = {
    params,
    rawUrl: req.originalUrl,
    secret: wall.postback_secret as string | null,
    wallConfig,
    clientIp: clientIp(req),
    allowedIps: config.adgateIps,
  };

  const verdict = adapter.validate(ctx);
  if (!verdict.valid) {
    console.warn(`[postback:${slug}] rejected from ${ctx.clientIp}: ${verdict.reason}`);
    await recordAttempt(slug, params, 'rejected', ctx.clientIp, { reason: verdict.reason });
    return res.status(403).json({ ok: false, error: 'validation failed' });
  }

  const parsed = adapter.parse(ctx);
  if (!parsed.ok) {
    await recordAttempt(slug, params, 'parse_error', ctx.clientIp, { reason: parsed.error });
    return res.status(400).json({ ok: false, error: parsed.error });
  }
  const { userId, txnId, rewardCents, action, title } = parsed.value;

  if (action === 'ignore') {
    await recordAttempt(slug, params, 'ignored', ctx.clientIp, { txnId, subId: userId });
    return res.json({ ok: true, status: 'ignored' });
  }

  if (rewardCents > config.maxPostbackCents) {
    console.warn(
      `[postback:${slug}] reward ${rewardCents} exceeds cap ${config.maxPostbackCents} for txn ${txnId} — ignored`
    );
    await recordAttempt(slug, params, 'oversized_reward', ctx.clientIp, {
      txnId,
      subId: userId,
      rewardCents,
    });
    return res.json({ ok: true, status: 'oversized_reward' });
  }

  const userLookup = await pool.query('SELECT id FROM users WHERE id = $1', [Number(userId)]);
  const user = userLookup.rowCount ? userLookup.rows[0] : null;
  if (!user) {
    console.warn(`[postback:${slug}] unknown user ${userId} for txn ${txnId}`);
    await recordAttempt(slug, params, 'unknown_user', ctx.clientIp, {
      txnId,
      subId: userId,
      rewardCents,
    });
    return res.json({ ok: true, status: 'unknown_user' });
  }

  if (action === 'credit' && rewardCents <= 0) {
    await recordAttempt(slug, params, 'zero_reward', ctx.clientIp, {
      txnId,
      subId: userId,
      rewardCents,
    });
    return res.json({ ok: true, status: 'zero_reward' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (action === 'credit') {
      const inserted = await client.query(
        `INSERT INTO postbacks (offerwall_slug, txn_id, user_id, reward_cents, raw)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (offerwall_slug, txn_id) DO NOTHING
         RETURNING id`,
        [slug, txnId, user.id, rewardCents, JSON.stringify(params)]
      );
      if (!inserted.rowCount) {
        await client.query('ROLLBACK');
        await recordAttempt(slug, params, 'duplicate', ctx.clientIp, {
          txnId,
          subId: userId,
          rewardCents,
        });
        return res.json({ ok: true, status: 'duplicate' });
      }
      await client.query(
        'UPDATE users SET balance_cents = balance_cents + $1, total_earned_cents = total_earned_cents + $1 WHERE id = $2',
        [rewardCents, user.id]
      );
      await client.query(
        `INSERT INTO transactions (user_id, type, amount_cents, description)
         VALUES ($1, 'earn', $2, $3)`,
        [user.id, rewardCents, `${displayName}: ${title || 'offer completion'}`]
      );
      await awardReferralBonus(client, user.id, rewardCents, `${slug} postback`);
      await client.query('COMMIT');
      await recordAttempt(slug, params, 'credited', ctx.clientIp, {
        txnId,
        subId: userId,
        rewardCents,
      });
      return res.json({ ok: true, status: 'credited', reward_cents: rewardCents });
    }

    // reversal
    const original = await client.query(
      `SELECT id, reward_cents, status FROM postbacks
       WHERE offerwall_slug = $1 AND txn_id = $2
       FOR UPDATE`,
      [slug, txnId]
    );
    if (!original.rowCount) {
      await client.query('ROLLBACK');
      console.warn(`[postback:${slug}] reversal for unknown txn ${txnId}`);
      await recordAttempt(slug, params, 'reversal_no_original', ctx.clientIp, {
        txnId,
        subId: userId,
        rewardCents,
      });
      return res.json({ ok: true, status: 'no_original' });
    }
    if (original.rows[0].status === 'reversed') {
      await client.query('ROLLBACK');
      await recordAttempt(slug, params, 'reversal_duplicate', ctx.clientIp, {
        txnId,
        subId: userId,
        rewardCents,
      });
      return res.json({ ok: true, status: 'duplicate' });
    }
    const reverseCents = original.rows[0].reward_cents;
    await client.query(
      'UPDATE users SET balance_cents = GREATEST(balance_cents - $1, 0) WHERE id = $2',
      [reverseCents, user.id]
    );
    await client.query(`UPDATE postbacks SET status = 'reversed' WHERE id = $1`, [
      original.rows[0].id,
    ]);
    await client.query(
      `INSERT INTO transactions (user_id, type, amount_cents, description)
       VALUES ($1, 'adjustment', $2, $3)`,
      [user.id, -reverseCents, `${displayName}: reversal of txn ${txnId}`]
    );
    await client.query('COMMIT');
    await recordAttempt(slug, params, 'reversed', ctx.clientIp, {
      txnId,
      subId: userId,
      rewardCents: reverseCents,
    });
    return res.json({ ok: true, status: 'reversed', reversed_cents: reverseCents });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[postback:${slug}] error`, err);
    await recordAttempt(slug, params, 'error', ctx.clientIp, {
      txnId,
      subId: userId,
      rewardCents,
      reason: err instanceof Error ? err.message : 'unknown',
    });
    return res.status(500).json({ ok: false, error: 'processing failed' });
  } finally {
    client.release();
  }
});

export default router;
