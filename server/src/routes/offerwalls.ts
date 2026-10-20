import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { pool } from '../db';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { awardReferralBonus } from '../referrals';
import {
  fetchFeed,
  submitTask,
  isOfferwallMeFeed,
  type OfferwallMeConfig,
  type FeedCampaign,
} from '../offerwallme';
import {
  fetchBitcoTasksFeed,
  isBitcoTasksFeed,
  type BitcoTasksConfig,
} from '../bitcotasks';
import { countryForIp } from '../geo';

const router = Router();

function clientIp(req: Request): string {
  const header = req.headers['x-forwarded-for'];
  const raw = Array.isArray(header) ? header[0] : header;
  const first = raw ? raw.split(',')[0].trim() : '';
  return (first || req.ip || '').replace('::ffff:', '');
}

function requestCountry(value: unknown): string {
  const raw = String(value ?? '').toUpperCase();
  return /^[A-Z]{2}$/.test(raw) ? raw : 'US';
}

interface WallFeedRow {
  postback_secret: string | null;
  postback_config: Record<string, string> | null;
}

interface LoadedFeed {
  offerwallme?: OfferwallMeConfig;
  bitcotasks?: BitcoTasksConfig;
  wallId: number;
}

async function loadFeedWall(
  id: number
): Promise<{ config: LoadedFeed } | { error: string; status: number }> {
  const result = await pool.query<WallFeedRow>(
    `SELECT postback_secret, postback_config FROM offerwalls
     WHERE id = $1 AND is_active = TRUE AND mode = 'live'`,
    [id]
  );
  if (!result.rowCount) return { error: 'Offerwall not found', status: 404 };
  const wall = result.rows[0];
  const cfg = wall.postback_config || {};
  const config: LoadedFeed = { wallId: id };

  if (isOfferwallMeFeed(cfg) && wall.postback_secret && cfg.bearer_token) {
    config.offerwallme = {
      publicKey: cfg.public_key,
      secret: wall.postback_secret,
      bearer: cfg.bearer_token,
    };
  }
  if (isBitcoTasksFeed(cfg) && cfg.bearer_token) {
    config.bitcotasks = {
      apiKey: cfg.api_key,
      secret: cfg.secret_key || wall.postback_secret || '',
      bearer: cfg.bearer_token,
    };
  }

  if (!config.offerwallme && !config.bitcotasks) {
    return { error: 'This offerwall does not support an on-site feed', status: 400 };
  }
  return { config };
}

router.get('/embed-urls', requireAuth, async (req: Request, res: Response) => {
  try {
    const walls = await pool.query(
      `SELECT id, wall_url, postback_secret, postback_config FROM offerwalls
       WHERE is_active = TRUE AND mode = 'live' AND wall_url IS NOT NULL
       ORDER BY id`
    );
    const userId = String(req.user!.id);
    const urls: Record<string, string> = {};
    for (const wall of walls.rows) {
      const cfg = (wall.postback_config || {}) as Record<string, string>;
      let url = String(wall.wall_url).split('{userId}').join(userId);
      if (cfg.signing === 'offerwallme') {
        if (!cfg.public_key || !wall.postback_secret) continue;
        url = url.split('{publicKey}').join(cfg.public_key);
        const expires = Math.floor(Date.now() / 1000) + 3600;
        const message = `offerwall-user-v1\n${cfg.public_key}\n${userId}\n${expires}`;
        const signature = crypto
          .createHmac('sha256', wall.postback_secret)
          .update(message)
          .digest('hex');
        url += `${url.includes('?') ? '&' : '?'}identityExpires=${expires}&identitySignature=${signature}`;
      } else if (url.includes('{publicKey}')) {
        continue;
      }
      urls[wall.id] = url;
    }
    res.json({ urls });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to build embed URLs' });
  }
});

router.get('/', optionalAuth, async (req: Request, res: Response) => {
  try {
    const isAdmin = req.user?.is_admin === true;
    const walls = await pool.query(
      `SELECT id, display_name, description, color, mode, wall_url, postback_config
       FROM offerwalls
       WHERE is_active = TRUE ${isAdmin ? '' : "AND mode = 'live'"}
       ORDER BY id`
    );
    const offers = await pool.query(
      'SELECT id, offerwall_id, title, description, reward_cents, device FROM offers ORDER BY reward_cents DESC'
    );
    const feedWallIds = (w: { postback_config: Record<string, unknown> | null }) =>
      isOfferwallMeFeed(w.postback_config) || isBitcoTasksFeed(w.postback_config);

    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const w of walls.rows) {
      const key = String(w.display_name || w.name || w.id);
      const list = grouped.get(key) ?? [];
      list.push(w as Record<string, unknown>);
      grouped.set(key, list);
    }

    const merged = Array.from(grouped.values()).map((group) => {
      const primary = group[0];
      const { postback_config, ...rest } = primary as {
        postback_config: Record<string, unknown> | null;
      } & Record<string, unknown>;
      const feedIds = group
        .filter((w) => w.mode === 'live' && feedWallIds(w as { postback_config: Record<string, unknown> | null }))
        .map((w) => w.id as number);
      const nameKey = `${String(primary.display_name || primary.name || primary.id)}`;
      return {
        ...rest,
        merged_key: nameKey,
        feed_wall_ids: feedIds,
        has_feed: feedIds.length > 0,
        offers: offers.rows.filter((o) =>
          group.some((w) => o.offerwall_id === w.id)
        ),
      };
    });

    res.json({ offerwalls: merged });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load offerwalls' });
  }
});

router.get('/:id/feed', requireAuth, async (req: Request, res: Response) => {
  const raw = String(req.params.id);
  const ids = raw.split(',').map((s) => Number(s.trim()));
  if (ids.length === 0 || ids.some((n) => !Number.isInteger(n))) {
    return res.status(400).json({ error: 'Invalid offerwall id' });
  }
  const countryHint = requestCountry(req.query.country);
  try {
    const walls = await Promise.all(ids.map((id) => loadFeedWall(id)));
    const loaded = walls.filter((w): w is { config: LoadedFeed } => !('error' in w));
    if (loaded.length === 0) {
      const first = walls[0];
      const status = 'error' in first ? first.status : 404;
      const error = 'error' in first ? first.error : 'Offerwall not found';
      return res.status(status).json({ error });
    }
    const ip = clientIp(req);
    const country = (await countryForIp(ip)) || countryHint;
    const userId = String(req.user!.id);
    const perWall = await Promise.all(
      loaded.map(async (l) => {
        const sets = await Promise.all([
          l.config.offerwallme ? fetchFeed(l.config.offerwallme, userId, ip, country) : [],
          l.config.bitcotasks ? fetchBitcoTasksFeed(l.config.bitcotasks, userId, ip) : [],
        ]);
        return sets.flat().map((c) => ({ ...c, wall_id: l.config.wallId }));
      })
    );
    const seen = new Set<string>();
    const campaigns = perWall
      .flat()
      .filter((c) => c.reward_cents > 0)
      .filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)))
      .sort((a, b) => b.reward_cents - a.reward_cents);
    res.json({ country, campaigns });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load offers' });
  }
});

router.post('/:id/start', requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid offerwall id' });
  }
  const { campaignKey, campaignType, campaignTitle, expectedCents } = (req.body ?? {}) as {
    campaignKey?: unknown;
    campaignType?: unknown;
    campaignTitle?: unknown;
    expectedCents?: unknown;
  };
  const key = String(campaignKey ?? '');
  const type = String(campaignType ?? '');
  if (!key || !['offer', 'ptc', 'shortlink', 'task'].includes(type)) {
    return res.status(400).json({ error: 'Invalid campaign' });
  }
  const reward = Number(expectedCents);
  try {
    const wall = await pool.query<{ slug: string }>(
      `SELECT slug FROM offerwalls WHERE id = $1 AND is_active = TRUE AND mode = 'live'`,
      [id]
    );
    if (!wall.rowCount) {
      return res.status(404).json({ error: 'Offerwall not found' });
    }
    const result = await pool.query<{ id: string }>(
      `INSERT INTO offer_sessions
         (user_id, offerwall_id, offerwall_slug, campaign_key, campaign_type, campaign_title, expected_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        req.user!.id,
        id,
        wall.rows[0].slug,
        key,
        type,
        String(campaignTitle ?? 'Offer').slice(0, 500),
        Number.isFinite(reward) && reward > 0 ? Math.round(reward) : 0,
      ]
    );
    res.status(201).json({ sessionId: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to start offer' });
  }
});

const SESSION_STALE_MS = 30 * 60_000;

router.get('/sessions', requireAuth, async (req: Request, res: Response) => {
  try {
    await pool.query(
      `UPDATE offer_sessions
          SET status = 'expired', updated_at = NOW()
        WHERE user_id = $1 AND status = 'pending' AND created_at < NOW() - INTERVAL '30 minutes'`,
      [req.user!.id]
    );
    const result = await pool.query(
      `SELECT id, campaign_key, campaign_type, campaign_title, expected_cents,
              status, credited_cents, txn_id, created_at, updated_at
         FROM offer_sessions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [req.user!.id]
    );
    res.json({ sessions: result.rows, staleAfterMs: SESSION_STALE_MS });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load offer history' });
  }
});

router.get('/sessions/:sessionId', requireAuth, async (req: Request, res: Response) => {
  const sessionId = String(req.params.sessionId || '');
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid session id' });
  }
  try {
    const result = await pool.query(
      `SELECT id, campaign_key, campaign_type, campaign_title, expected_cents,
              status, credited_cents, txn_id, created_at, updated_at
         FROM offer_sessions
        WHERE id = $1 AND user_id = $2`,
      [sessionId, req.user!.id]
    );
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const row = result.rows[0];
    const ageMs = Date.now() - new Date(row.created_at as string).getTime();
    if (row.status === 'pending' && ageMs > SESSION_STALE_MS) {
      const updated = await pool.query(
        `UPDATE offer_sessions SET status = 'expired', updated_at = NOW()
          WHERE id = $1 AND status = 'pending' RETURNING status`,
        [sessionId]
      );
      if (updated.rowCount) row.status = updated.rows[0].status;
    }
    res.json({ session: row });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load session' });
  }
});

router.post('/:id/tasks/:taskId/submit', requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const taskId = String(req.params.taskId || '');
  if (!Number.isInteger(id) || !taskId) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  const { proof, image } = (req.body ?? {}) as { proof?: unknown; image?: unknown };
  let imageInput: { base64: string; mime: string } | undefined;
  if (image && typeof image === 'object') {
    const candidate = image as { base64?: unknown; mime?: unknown };
    const mime = String(candidate.mime || '').toLowerCase();
    if (['image/jpeg', 'image/png', 'image/webp'].includes(mime) && typeof candidate.base64 === 'string') {
      if (Buffer.byteLength(candidate.base64, 'base64') > 5 * 1024 * 1024) {
        return res.status(400).json({ error: 'Image must be 5 MB or smaller' });
      }
      imageInput = { base64: candidate.base64, mime };
    }
  }
  if (typeof proof !== 'string' && !imageInput) {
    return res.status(400).json({ error: 'Proof is required' });
  }
  try {
    const loaded = await loadFeedWall(id);
    if ('error' in loaded) {
      return res.status(loaded.status).json({ error: loaded.error });
    }
    if (!loaded.config.offerwallme) {
      return res.status(400).json({ error: 'Task submission is not supported for this offerwall' });
    }
    const result = await submitTask({
      ...loaded.config.offerwallme,
      userId: String(req.user!.id),
      ip: clientIp(req),
      country:
        (await countryForIp(clientIp(req))) || requestCountry(req.query.country),
      taskId,
      proof: typeof proof === 'string' ? proof : undefined,
      image: imageInput,
    });
    if (!result.ok) {
      return res.status(400).json({ error: result.error || 'Task submission failed' });
    }
    res.json({ status: result.status || 'Pending' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit task' });
  }
});

router.post('/offers/:id/complete', requireAuth, async (req: Request, res: Response) => {
  const offerId = Number(req.params.id);
  if (!Number.isInteger(offerId)) {
    return res.status(400).json({ error: 'Invalid offer id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const offer = await client.query('SELECT id, title, reward_cents FROM offers WHERE id = $1', [
      offerId,
    ]);
    if (!offer.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Offer not found' });
    }

    const already = await client.query(
      `SELECT 1 FROM transactions
       WHERE user_id = $1 AND description = $2 AND type = 'earn'
       LIMIT 1`,
      [req.user!.id, `Completed: ${offer.rows[0].title}`]
    );
    if (already.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'You already completed this offer' });
    }

    const reward: number = offer.rows[0].reward_cents;
    await client.query('UPDATE users SET balance_cents = balance_cents + $1, total_earned_cents = total_earned_cents + $1 WHERE id = $2', [
      reward,
      req.user!.id,
    ]);
    const tx = await client.query(
      `INSERT INTO transactions (user_id, type, amount_cents, description) VALUES ($1, 'earn', $2, $3) RETURNING *`,
      [req.user!.id, reward, `Completed: ${offer.rows[0].title}`]
    );
    await awardReferralBonus(client, req.user!.id, reward, 'offer completion');
    await client.query('COMMIT');

    const user = await pool.query('SELECT balance_cents, total_earned_cents FROM users WHERE id = $1', [
      req.user!.id,
    ]);
    res.status(201).json({ transaction: tx.rows[0], ...user.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to credit offer' });
  } finally {
    client.release();
  }
});

export default router;
