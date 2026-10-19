import crypto from 'crypto';
import { PoolClient } from 'pg';
import { pool } from './db';
import { config } from './config';

export function generateReferralCode(): string {
  return crypto.randomBytes(4).toString('hex');
}

export async function awardReferralBonus(
  client: PoolClient,
  earnerId: number,
  baseCents: number,
  context: string
): Promise<void> {
  if (baseCents <= 0 || config.referralRate <= 0) return;
  const bonus = Math.floor(baseCents * config.referralRate);
  if (bonus <= 0) return;

  const ref = await client.query('SELECT referred_by FROM users WHERE id = $1', [earnerId]);
  const referrerId = ref.rows[0]?.referred_by;
  if (!referrerId || referrerId === earnerId) return;

  await client.query('UPDATE users SET balance_cents = balance_cents + $1 WHERE id = $2', [
    bonus,
    referrerId,
  ]);
  await client.query(
    `INSERT INTO transactions (user_id, type, amount_cents, description) VALUES ($1, 'referral', $2, $3)`,
    [referrerId, bonus, `Referral bonus (${context})`]
  );
}

export async function awardRefereeSignupBonus(
  refereeId: number,
  refereeUsername: string
): Promise<void> {
  if (config.referralSignupBonusCents <= 0) return;

  const ref = await pool.query('SELECT referred_by FROM users WHERE id = $1', [refereeId]);
  const referrerId = ref.rows[0]?.referred_by;
  if (!referrerId || referrerId === refereeId) return;

  const description = `Referral signup bonus (@${refereeUsername} verified)`;
  const existing = await pool.query(
    `SELECT 1 FROM transactions WHERE user_id = $1 AND type = 'referral' AND description = $2 LIMIT 1`,
    [referrerId, description]
  );
  if (existing.rowCount) return;

  await pool.query('UPDATE users SET balance_cents = balance_cents + $1 WHERE id = $2', [
    config.referralSignupBonusCents,
    referrerId,
  ]);
  await pool.query(
    `INSERT INTO transactions (user_id, type, amount_cents, description) VALUES ($1, 'referral', $2, $3)`,
    [referrerId, config.referralSignupBonusCents, description]
  );
}
