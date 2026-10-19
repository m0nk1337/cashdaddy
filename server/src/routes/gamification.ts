import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import {
  CHALLENGE,
  checkAchievements,
  challengeProgress,
  claimDailyStreak,
  levelFor,
  streakBonusFor,
} from '../gamification';

const router = Router();

router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const user = await pool.query(
      `SELECT streak_count, total_earned_cents,
              COALESCE(last_bonus_date = CURRENT_DATE, FALSE) AS claimed_today
       FROM users WHERE id = $1`,
      [userId]
    );
    if (!user.rowCount) return res.status(404).json({ error: 'User not found' });
    const u = user.rows[0];

    const progress = await challengeProgress(pool, userId);
    const claimed = await pool.query(
      'SELECT 1 FROM challenge_claims WHERE user_id = $1 AND challenge_date = CURRENT_DATE',
      [userId]
    );
    const achievements = await checkAchievements(pool, userId);

    res.json({
      streak: {
        count: u.streak_count,
        claimed_today: u.claimed_today,
        next_bonus_cents: streakBonusFor(u.streak_count + 1),
      },
      level: levelFor(u.total_earned_cents),
      challenge: {
        key: CHALLENGE.key,
        title: CHALLENGE.title,
        progress,
        needed: CHALLENGE.needed,
        bonus_cents: CHALLENGE.bonus_cents,
        claimed_today: Boolean(claimed.rowCount),
      },
      achievements: achievements?.all ?? [],
      newly_unlocked: achievements?.newly ?? [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

router.post('/daily-bonus', requireAuth, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await claimDailyStreak(client, req.user!.id);
    if (!result.ok) {
      await client.query('ROLLBACK');
      return res.status(result.status).json({ error: result.error });
    }
    await client.query('COMMIT');
    res.json({ streak: result.streak, bonus_cents: result.bonus_cents });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to claim daily bonus' });
  } finally {
    client.release();
  }
});

router.post('/challenge/claim', requireAuth, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      'SELECT 1 FROM challenge_claims WHERE user_id = $1 AND challenge_date = CURRENT_DATE',
      [req.user!.id]
    );
    if (claimed.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Challenge already claimed today' });
    }
    const progress = await challengeProgress(client, req.user!.id);
    if (progress < CHALLENGE.needed) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Challenge not complete yet' });
    }
    await client.query('INSERT INTO challenge_claims (user_id, challenge_date) VALUES ($1, CURRENT_DATE)', [
      req.user!.id,
    ]);
    await client.query('UPDATE users SET balance_cents = balance_cents + $1 WHERE id = $2', [
      CHALLENGE.bonus_cents,
      req.user!.id,
    ]);
    await client.query(
      `INSERT INTO transactions (user_id, type, amount_cents, description) VALUES ($1, 'bonus', $2, $3)`,
      [req.user!.id, CHALLENGE.bonus_cents, `Daily challenge reward: ${CHALLENGE.title}`]
    );
    await client.query('COMMIT');
    res.json({ bonus_cents: CHALLENGE.bonus_cents });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to claim challenge reward' });
  } finally {
    client.release();
  }
});

router.get('/leaderboard', requireAuth, async (req: Request, res: Response) => {
  try {
    const top = await pool.query(
      `SELECT u.username, SUM(t.amount_cents)::int AS earned
       FROM transactions t JOIN users u ON u.id = t.user_id
       WHERE t.type = 'earn' AND t.created_at >= date_trunc('week', NOW())
       GROUP BY u.username
       ORDER BY earned DESC
       LIMIT 10`
    );
    const me = await pool.query(
      `WITH weekly AS (
         SELECT user_id, SUM(amount_cents)::int AS earned
         FROM transactions
         WHERE type = 'earn' AND created_at >= date_trunc('week', NOW())
         GROUP BY user_id
       )
       SELECT COALESCE(w.earned, 0)::int AS earned,
              (SELECT COUNT(*)::int FROM weekly WHERE earned > COALESCE(w.earned, 0)) + 1 AS rank
       FROM users u
       LEFT JOIN weekly w ON w.user_id = u.id
       WHERE u.id = $1`,
      [req.user!.id]
    );
    res.json({ top: top.rows, me: me.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

router.post('/redeem', requireAuth, async (req: Request, res: Response) => {
  const { code } = req.body ?? {};
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{3,30}$/.test(code)) {
    return res.status(400).json({ error: 'Enter a valid promo code' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const promo = await client.query('SELECT * FROM promo_codes WHERE code = $1 FOR UPDATE', [
      code.toUpperCase(),
    ]);
    if (!promo.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'That promo code does not exist' });
    }
    const p = promo.rows[0];
    if (p.expires_at && new Date(p.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'That promo code has expired' });
    }
    if (p.used_count >= p.max_uses) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'That promo code is fully redeemed' });
    }
    const redemption = await client.query(
      'INSERT INTO promo_redemptions (user_id, code) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1',
      [req.user!.id, code.toUpperCase()]
    );
    if (!redemption.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'You already redeemed that code' });
    }
    await client.query('UPDATE promo_codes SET used_count = used_count + 1 WHERE code = $1', [
      code.toUpperCase(),
    ]);
    await client.query('UPDATE users SET balance_cents = balance_cents + $1 WHERE id = $2', [
      p.bonus_cents,
      req.user!.id,
    ]);
    await client.query(
      `INSERT INTO transactions (user_id, type, amount_cents, description) VALUES ($1, 'bonus', $2, $3)`,
      [req.user!.id, p.bonus_cents, `Promo code redeemed: ${code.toUpperCase()}`]
    );
    await client.query('COMMIT');
    res.json({ bonus_cents: p.bonus_cents });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to redeem promo code' });
  } finally {
    client.release();
  }
});

router.get('/recent-wins', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT LEFT(u.username, 1) || '***' AS user, t.amount_cents, t.created_at
       FROM transactions t JOIN users u ON u.id = t.user_id
       WHERE t.type = 'earn' AND t.created_at > NOW() - INTERVAL '24 hours'
       ORDER BY t.created_at DESC
       LIMIT 12`
    );
    res.json({ wins: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load recent wins' });
  }
});

export default router;
