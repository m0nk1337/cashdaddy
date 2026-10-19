import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { sendWithdrawalStatusEmail } from '../email';

const router = Router();

router.use(requireAuth, requireAdmin);

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [users, earnings, pending, paid] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM users'),
      pool.query("SELECT COALESCE(SUM(amount_cents), 0)::int AS total FROM transactions WHERE type = 'earn'"),
      pool.query("SELECT COALESCE(SUM(amount_cents), 0)::int AS total, COUNT(*)::int AS count FROM withdrawals WHERE status = 'pending'"),
      pool.query("SELECT COALESCE(SUM(amount_cents), 0)::int AS total FROM withdrawals WHERE status = 'approved'"),
    ]);
    res.json({
      totalUsers: users.rows[0].count,
      totalEarningsCents: earnings.rows[0].total,
      pendingWithdrawals: pending.rows[0],
      paidOutCents: paid.rows[0].total,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

router.get('/postbacks', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.offerwall_slug, p.txn_id, p.reward_cents, p.status, p.received_at, u.username
       FROM postbacks p LEFT JOIN users u ON u.id = p.user_id
       ORDER BY p.received_at DESC LIMIT 200`
    );
    res.json({ postbacks: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load postbacks' });
  }
});

router.get('/offerwalls', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT w.id, w.name, w.slug, w.display_name, w.mode, w.wall_url, w.postback_secret,
              w.postback_config,
              (SELECT COUNT(*)::int FROM offers o WHERE o.offerwall_id = w.id) AS offer_count
       FROM offerwalls w ORDER BY w.id`
    );
    res.json({ offerwalls: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load offerwalls' });
  }
});

router.patch('/offerwalls/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid offerwall id' });
  }
  const { mode, wall_url, postback_secret, display_name, public_key, bearer_token } = req.body ?? {};
  if (mode !== undefined && !['demo', 'live'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be demo or live' });
  }
  if (display_name !== undefined) {
    if (typeof display_name !== 'string' || display_name.trim().length < 1 || display_name.length > 100) {
      return res.status(400).json({ error: 'display_name must be 1-100 characters' });
    }
  }
  if (wall_url !== undefined) {
    if (typeof wall_url !== 'string' || (wall_url !== '' && !wall_url.startsWith('https://'))) {
      return res.status(400).json({ error: 'wall_url must be an https URL' });
    }
  }
  if (postback_secret !== undefined && typeof postback_secret !== 'string') {
    return res.status(400).json({ error: 'postback_secret must be a string' });
  }
  if (public_key !== undefined && public_key !== null && typeof public_key !== 'string') {
    return res.status(400).json({ error: 'public_key must be a string' });
  }
  if (typeof public_key === 'string' && public_key.length > 300) {
    return res.status(400).json({ error: 'public_key must be at most 300 characters' });
  }
  if (bearer_token !== undefined && bearer_token !== null && typeof bearer_token !== 'string') {
    return res.status(400).json({ error: 'bearer_token must be a string' });
  }
  if (typeof bearer_token === 'string' && bearer_token.length > 300) {
    return res.status(400).json({ error: 'bearer_token must be at most 300 characters' });
  }
  try {
    const existing = await pool.query('SELECT postback_config FROM offerwalls WHERE id = $1', [id]);
    if (!existing.rowCount) {
      return res.status(404).json({ error: 'Offerwall not found' });
    }
    const config = { ...((existing.rows[0].postback_config || {}) as Record<string, unknown>) };
    let configChanged = false;
    for (const [field, value] of [
      ['public_key', public_key],
      ['bearer_token', bearer_token],
    ] as const) {
      if (value === undefined || value === null) continue;
      const next = String(value).trim();
      if (next === '') {
        if (field in config) {
          delete config[field];
          configChanged = true;
        }
      } else if (config[field] !== next) {
        config[field] = next;
        configChanged = true;
      }
    }
    const result = await pool.query(
      `UPDATE offerwalls
       SET mode = COALESCE($1, mode),
           wall_url = CASE WHEN $2::text = '' THEN NULL WHEN $2::text IS NULL THEN wall_url ELSE $2::text END,
           postback_secret = CASE WHEN $3::text = '' THEN NULL WHEN $3::text IS NULL THEN postback_secret ELSE $3::text END,
           display_name = COALESCE($5, display_name),
           postback_config = $6::jsonb
       WHERE id = $4
       RETURNING id, name, slug, display_name, mode, wall_url, postback_secret, postback_config`,
      [
        mode ?? null,
        wall_url === undefined ? null : wall_url,
        postback_secret ?? null,
        id,
        display_name === undefined ? null : String(display_name).trim(),
        configChanged ? JSON.stringify(config) : existing.rows[0].postback_config,
      ]
    );
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Offerwall not found' });
    }
    res.json({ offerwall: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update offerwall' });
  }
});

router.get('/users', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, username, email, balance_cents, total_earned_cents, is_admin, register_ip, created_at
       FROM users ORDER BY created_at DESC LIMIT 100`
    );
    res.json({ users: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

router.get('/withdrawals', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT w.id, w.amount_cents, w.method, w.destination, w.status, w.created_at, w.processed_at,
              u.username
       FROM withdrawals w JOIN users u ON u.id = w.user_id
       ORDER BY w.created_at DESC LIMIT 200`
    );
    res.json({ withdrawals: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load withdrawals' });
  }
});

router.post('/withdrawals/:id/:action', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const action = String(req.params.action);
  if (!Number.isInteger(id) || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wd = await client.query('SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE', [id]);
    if (!wd.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Withdrawal not found' });
    }
    if (wd.rows[0].status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Withdrawal already processed' });
    }

    if (action === 'reject') {
      await client.query('UPDATE users SET balance_cents = balance_cents + $1 WHERE id = $2', [
        wd.rows[0].amount_cents,
        wd.rows[0].user_id,
      ]);
      await client.query(
        `INSERT INTO transactions (user_id, type, amount_cents, description) VALUES ($1, 'adjustment', $2, $3)`,
        [wd.rows[0].user_id, wd.rows[0].amount_cents, 'Withdrawal rejected - refund']
      );
    }

    const updated = await client.query(
      `UPDATE withdrawals SET status = $1, processed_at = NOW() WHERE id = $2 RETURNING *`,
      [action === 'approve' ? 'approved' : 'rejected', id]
    );
    await client.query('COMMIT');

    const userInfo = await pool.query('SELECT email, username FROM users WHERE id = $1', [
      wd.rows[0].user_id,
    ]);
    if (userInfo.rowCount) {
      sendWithdrawalStatusEmail(
        userInfo.rows[0].email,
        userInfo.rows[0].username,
        action === 'approve' ? 'approved' : 'rejected',
        wd.rows[0].amount_cents,
        wd.rows[0].method
      ).catch((err) => console.error('[email] failed to send withdrawal status:', err));
    }

    res.json({ withdrawal: updated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to process withdrawal' });
  } finally {
    client.release();
  }
});

router.get('/promo-codes', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT code, bonus_cents, max_uses, used_count, expires_at, created_at
       FROM promo_codes ORDER BY created_at DESC LIMIT 100`
    );
    res.json({ promoCodes: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load promo codes' });
  }
});

router.post('/promo-codes', async (req: Request, res: Response) => {
  const { code, bonus_cents, max_uses, expires_in_days } = req.body ?? {};
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{3,30}$/.test(code)) {
    return res.status(400).json({ error: 'Code must be 3-30 chars (letters, numbers, -)' });
  }
  if (!Number.isInteger(bonus_cents) || bonus_cents < 1 || bonus_cents > 10000) {
    return res.status(400).json({ error: 'bonus_cents must be 1-10000' });
  }
  if (max_uses !== undefined && (!Number.isInteger(max_uses) || max_uses < 1)) {
    return res.status(400).json({ error: 'max_uses must be a positive integer' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO promo_codes (code, bonus_cents, max_uses, expires_at)
       VALUES ($1, $2, $3, CASE WHEN $4::int IS NULL THEN NULL ELSE NOW() + ($4::int || ' days')::interval END)
       ON CONFLICT (code) DO NOTHING
       RETURNING code, bonus_cents, max_uses, used_count, expires_at`,
      [
        code.toUpperCase(),
        bonus_cents,
        max_uses ?? 100,
        Number.isInteger(expires_in_days) ? expires_in_days : null,
      ]
    );
    if (!result.rowCount) {
      return res.status(409).json({ error: 'That code already exists' });
    }
    res.status(201).json({ promoCode: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create promo code' });
  }
});

export default router;
