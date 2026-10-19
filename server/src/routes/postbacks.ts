import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { config } from '../config';
import { adapters, getAdapter, normalizeParams } from '../postbacks/adapters';
import { awardReferralBonus } from '../referrals';

const router = Router();

function clientIp(req: Request): string {
  return (req.ip || '').replace('::ffff:', '');
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
    return res.status(403).json({ ok: false, error: 'validation failed' });
  }

  const parsed = adapter.parse(ctx);
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }
  const { userId, txnId, rewardCents, action, title } = parsed.value;

  if (action === 'ignore') {
    return res.json({ ok: true, status: 'ignored' });
  }

  if (rewardCents > config.maxPostbackCents) {
    console.warn(
      `[postback:${slug}] reward ${rewardCents} exceeds cap ${config.maxPostbackCents} for txn ${txnId} — ignored`
    );
    return res.json({ ok: true, status: 'oversized_reward' });
  }

  const userLookup = await pool.query('SELECT id FROM users WHERE id = $1', [Number(userId)]);
  const user = userLookup.rowCount ? userLookup.rows[0] : null;
  if (!user) {
    console.warn(`[postback:${slug}] unknown user ${userId} for txn ${txnId}`);
    return res.json({ ok: true, status: 'unknown_user' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (action === 'credit') {
      if (rewardCents <= 0) {
        await client.query('ROLLBACK');
        return res.json({ ok: true, status: 'zero_reward' });
      }
      const inserted = await client.query(
        `INSERT INTO postbacks (offerwall_slug, txn_id, user_id, reward_cents, raw)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (offerwall_slug, txn_id) DO NOTHING
         RETURNING id`,
        [slug, txnId, user.id, rewardCents, JSON.stringify(params)]
      );
      if (!inserted.rowCount) {
        await client.query('ROLLBACK');
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
      return res.json({ ok: true, status: 'no_original' });
    }
    if (original.rows[0].status === 'reversed') {
      await client.query('ROLLBACK');
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
    return res.json({ ok: true, status: 'reversed', reversed_cents: reverseCents });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[postback:${slug}] error`, err);
    return res.status(500).json({ ok: false, error: 'processing failed' });
  } finally {
    client.release();
  }
});

export default router;
