import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import { config } from '../config';

const router = Router();

router.use(requireAuth);

router.get('/transactions', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, type, amount_cents, description, created_at FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.user!.id]
    );
    res.json({ transactions: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load transactions' });
  }
});

router.get('/withdrawals', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, amount_cents, method, destination, status, created_at, processed_at FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user!.id]
    );
    res.json({ withdrawals: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load withdrawals' });
  }
});

router.get('/referral', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT u.referral_code,
              (SELECT COUNT(*)::int FROM users r WHERE r.referred_by = u.id) AS referral_count,
              (SELECT COALESCE(SUM(amount_cents), 0)::int FROM transactions t
               WHERE t.user_id = u.id AND t.type = 'referral') AS total_bonus_cents
       FROM users u WHERE u.id = $1`,
      [req.user!.id]
    );
    if (!result.rowCount) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ referral: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load referral info' });
  }
});

router.post('/withdraw', async (req: Request, res: Response) => {
  const verified = await pool.query('SELECT email_verified_at FROM users WHERE id = $1', [
    req.user!.id,
  ]);
  if (!verified.rows[0]?.email_verified_at) {
    return res.status(403).json({ error: 'Verify your email before withdrawing' });
  }
  const { amountCents, method, destination } = req.body ?? {};
  if (!Number.isInteger(amountCents) || amountCents < config.minWithdrawCents) {
    return res.status(400).json({ error: `Minimum withdrawal is $${(config.minWithdrawCents / 100).toFixed(2)}` });
  }
  if (typeof method !== 'string' || !['paypal', 'gift_card', 'crypto'].includes(method)) {
    return res.status(400).json({ error: 'Choose a valid payout method' });
  }
  if (typeof destination !== 'string' || destination.trim().length < 3) {
    return res.status(400).json({ error: 'Payout destination is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user = await client.query('SELECT balance_cents FROM users WHERE id = $1 FOR UPDATE', [
      req.user!.id,
    ]);
    if (user.rows[0].balance_cents < amountCents) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    await client.query('UPDATE users SET balance_cents = balance_cents - $1 WHERE id = $2', [
      amountCents,
      req.user!.id,
    ]);
    const wd = await client.query(
      `INSERT INTO withdrawals (user_id, amount_cents, method, destination) VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user!.id, amountCents, method, destination.trim()]
    );
    await client.query(
      `INSERT INTO transactions (user_id, type, amount_cents, description) VALUES ($1, 'withdrawal', $2, $3)`,
      [req.user!.id, -amountCents, `Withdrawal request via ${method}`]
    );
    await client.query('COMMIT');

    const updated = await client.query('SELECT balance_cents FROM users WHERE id = $1', [req.user!.id]);
    res.status(201).json({ withdrawal: wd.rows[0], balance_cents: updated.rows[0].balance_cents });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Withdrawal failed' });
  } finally {
    client.release();
  }
});

export default router;
