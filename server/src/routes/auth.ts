import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../db';
import { signToken, requireAuth } from '../middleware/auth';
import { sendVerificationEmail, sendPasswordResetEmail } from '../email';
import { rateLimit } from '../middleware/rateLimit';
import { config } from '../config';
import { generateReferralCode, awardRefereeSignupBonus } from '../referrals';

const router = Router();

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

router.use(
  rateLimit({ windowMs: 15 * 60 * 1000, max: config.authRateLimit, name: 'auth' })
);

function newVerifyToken(): { token: string; expires: Date } {
  return {
    token: crypto.randomBytes(32).toString('hex'),
    expires: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
  };
}

router.post('/register', async (req: Request, res: Response) => {
  const { username, email, password, ref } = req.body ?? {};
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-30 chars (letters, numbers, _)' });
  }
  if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Please provide a valid email' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const existing = await pool.query('SELECT 1 FROM users WHERE username = $1 OR email = $2', [
      username.toLowerCase(),
      email.toLowerCase(),
    ]);
    if (existing.rowCount) {
      return res.status(409).json({ error: 'Username or email already taken' });
    }

    const registerIp = (req.ip || '').replace('::ffff:', '');
    const ipCount = await pool.query(
      'SELECT COUNT(*)::int AS c FROM users WHERE register_ip = $1',
      [registerIp]
    );
    if (ipCount.rows[0].c >= config.maxAccountsPerIp) {
      return res.status(403).json({ error: 'Too many accounts from this network' });
    }

    let referredBy: number | null = null;
    if (typeof ref === 'string' && ref) {
      const referrer = await pool.query('SELECT id FROM users WHERE referral_code = $1', [
        ref.toLowerCase(),
      ]);
      if (referrer.rowCount) referredBy = referrer.rows[0].id;
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, register_ip, referral_code, referred_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, username, is_admin`,
      [username.toLowerCase(), email.toLowerCase(), hash, registerIp, generateReferralCode(), referredBy]
    );
    const user = result.rows[0];

    const { token, expires } = newVerifyToken();
    await pool.query('UPDATE users SET verify_token = $1, verify_token_expires = $2 WHERE id = $3', [
      token,
      expires,
      user.id,
    ]);
    sendVerificationEmail(email.toLowerCase(), user.username, token).catch((err) =>
      console.error('[email] failed to send verification:', err)
    );

    res.status(201).json({
      token: signToken({ id: user.id, username: user.username, is_admin: user.is_admin }),
      user: { id: user.id, username: user.username, is_admin: user.is_admin },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, username, password_hash, is_admin FROM users WHERE username = $1 OR email = $1',
      [username.toLowerCase()]
    );
    if (!result.rowCount) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.json({
      token: signToken({ id: user.id, username: user.username, is_admin: user.is_admin }),
      user: { id: user.id, username: user.username, is_admin: user.is_admin },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email, balance_cents, total_earned_cents, is_admin, email_verified_at, created_at FROM users WHERE id = $1',
      [req.user!.id]
    );
    if (!result.rowCount) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

router.get('/verify-email', async (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!token) {
    return res.status(400).json({ error: 'Missing verification token' });
  }
  try {
    const result = await pool.query(
      `UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()), verify_token = NULL, verify_token_expires = NULL
       WHERE verify_token = $1 AND verify_token_expires > NOW()
       RETURNING id`,
      [token]
    );
    if (!result.rowCount) {
      return res.status(400).json({ error: 'Invalid or expired verification link' });
    }
    const verified = await pool.query(
      'SELECT id, username, referred_by FROM users WHERE id = $1',
      [result.rows[0].id]
    );
    if (verified.rows[0]?.referred_by) {
      awardRefereeSignupBonus(verified.rows[0].id, verified.rows[0].username).catch((err) =>
        console.error('[referral] signup bonus failed:', err)
      );
    }
    res.json({ verified: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

router.post('/resend-verification', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email, email_verified_at FROM users WHERE id = $1',
      [req.user!.id]
    );
    if (!result.rowCount) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = result.rows[0];
    if (user.email_verified_at) {
      return res.status(409).json({ error: 'Email is already verified' });
    }
    const { token, expires } = newVerifyToken();
    await pool.query('UPDATE users SET verify_token = $1, verify_token_expires = $2 WHERE id = $3', [
      token,
      expires,
      user.id,
    ]);
    await sendVerificationEmail(user.email, user.username, token);
    res.json({ sent: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to resend verification email' });
  }
});

router.post('/forgot-password', async (req: Request, res: Response) => {
  const { email } = req.body ?? {};
  if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Please provide a valid email' });
  }
  try {
    const result = await pool.query('SELECT id, username FROM users WHERE email = $1', [
      email.toLowerCase(),
    ]);
    if (result.rowCount) {
      const user = result.rows[0];
      const token = crypto.randomBytes(32).toString('hex');
      await pool.query(
        'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
        [token, new Date(Date.now() + 60 * 60 * 1000), user.id]
      );
      sendPasswordResetEmail(user.email || email.toLowerCase(), user.username, token).catch(
        (err) => console.error('[email] failed to send reset:', err)
      );
    }
    res.json({ sent: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Request failed' });
  }
});

router.post('/reset-password', async (req: Request, res: Response) => {
  const { token, password } = req.body ?? {};
  if (typeof token !== 'string' || !token) {
    return res.status(400).json({ error: 'Missing reset token' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL
       WHERE reset_token = $2 AND reset_token_expires > NOW()
       RETURNING id`,
      [hash, token]
    );
    if (!result.rowCount) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }
    res.json({ reset: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Reset failed' });
  }
});

export default router;
