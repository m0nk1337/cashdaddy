import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { pool } from '../db';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { awardReferralBonus } from '../referrals';

const router = Router();

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
      `SELECT id, display_name, description, color, mode, wall_url
       FROM offerwalls
       WHERE is_active = TRUE ${isAdmin ? '' : "AND mode = 'live'"}
       ORDER BY id`
    );
    const offers = await pool.query(
      'SELECT id, offerwall_id, title, description, reward_cents, device FROM offers ORDER BY reward_cents DESC'
    );
    res.json({
      offerwalls: walls.rows.map((w) => ({
        ...w,
        offers: offers.rows.filter((o) => o.offerwall_id === w.id),
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load offerwalls' });
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
