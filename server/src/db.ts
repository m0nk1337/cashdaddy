import crypto from 'crypto';
import { Pool } from 'pg';
import { config } from './config';

export const pool = new Pool(config.db);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(30) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  total_earned_cents INTEGER NOT NULL DEFAULT 0,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS offerwalls (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  description TEXT NOT NULL,
  color VARCHAR(20) NOT NULL DEFAULT '#6366f1',
  cpe_cents INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS offers (
  id SERIAL PRIMARY KEY,
  offerwall_id INTEGER NOT NULL REFERENCES offerwalls(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  reward_cents INTEGER NOT NULL,
  device VARCHAR(10) NOT NULL DEFAULT 'any'
);

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('earn', 'withdrawal', 'adjustment', 'referral')),
  amount_cents INTEGER NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  method VARCHAR(30) NOT NULL,
  destination VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS postbacks (
  id SERIAL PRIMARY KEY,
  offerwall_slug TEXT NOT NULL,
  txn_id TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  reward_cents INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'credited' CHECK (status IN ('credited', 'reversed')),
  raw JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (offerwall_slug, txn_id)
);

CREATE TABLE IF NOT EXISTS offer_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id),
  offerwall_id INTEGER NOT NULL REFERENCES offerwalls(id),
  offerwall_slug TEXT NOT NULL,
  campaign_key TEXT NOT NULL,
  campaign_type VARCHAR(20) NOT NULL,
  campaign_title TEXT NOT NULL,
  expected_cents INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'credited', 'expired', 'failed')),
  credited_cents INTEGER NOT NULL DEFAULT 0,
  txn_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT Now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT Now()
);

CREATE INDEX IF NOT EXISTS idx_offer_sessions_user ON offer_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offer_sessions_pending ON offer_sessions(status, created_at DESC);

CREATE TABLE IF NOT EXISTS postback_attempts (
  id SERIAL PRIMARY KEY,
  offerwall_slug TEXT NOT NULL,
  txn_id TEXT,
  sub_id TEXT,
  reward_cents INTEGER,
  outcome TEXT NOT NULL,
  ip TEXT,
  raw JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_postback_attempts_received ON postback_attempts(received_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offers_wall ON offers(offerwall_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token_expires TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS register_ip VARCHAR(45);
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;
ALTER TABLE offerwalls ADD COLUMN IF NOT EXISTS postback_secret TEXT;
ALTER TABLE offerwalls ADD COLUMN IF NOT EXISTS postback_config JSONB;
ALTER TABLE offerwalls ADD COLUMN IF NOT EXISTS mode VARCHAR(10) NOT NULL DEFAULT 'demo';
ALTER TABLE offerwalls ADD COLUMN IF NOT EXISTS wall_url TEXT;
ALTER TABLE offerwalls ADD COLUMN IF NOT EXISTS display_name VARCHAR(100);
UPDATE offerwalls SET display_name = CASE slug
  WHEN 'bitlabs' THEN 'Surveys'
  WHEN 'adgate' THEN 'Quick Tasks'
  WHEN 'offertoro' THEN 'Deals & Trials'
  WHEN 'cpx' THEN 'Study Panels'
  ELSE 'Offers'
END WHERE display_name IS NULL;
INSERT INTO offerwalls (name, slug, description, display_name, color, mode, wall_url, postback_config)
SELECT 'Offerwall.me', 'offerwall-me',
       'Watch videos, open shortlinks, and finish micro-tasks for quick rewards.',
       'Micro Tasks', '#0ea5e9', 'demo',
       'https://offerwall.me/offerwall/{publicKey}/{userId}',
       '{"adapter":"offerwallme","signing":"offerwallme"}'::jsonb
ON CONFLICT (slug) DO NOTHING;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INTEGER REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(12) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_bonus_date DATE;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check CHECK (type IN ('earn', 'withdrawal', 'adjustment', 'referral', 'bonus'));
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);
CREATE INDEX IF NOT EXISTS idx_transactions_earned_recent ON transactions(created_at DESC) WHERE type = 'earn';

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ach_key VARCHAR(40) NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, ach_key)
);

CREATE TABLE IF NOT EXISTS challenge_claims (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_date DATE NOT NULL,
  PRIMARY KEY (user_id, challenge_date)
);

CREATE TABLE IF NOT EXISTS promo_codes (
  code VARCHAR(30) PRIMARY KEY,
  bonus_cents INTEGER NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 100,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS promo_redemptions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code VARCHAR(30) NOT NULL REFERENCES promo_codes(code) ON DELETE CASCADE,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, code)
);
`;

export async function initSchema(): Promise<void> {
  await pool.query(SCHEMA);
  await backfillReferralCodes();
}

async function backfillReferralCodes(): Promise<void> {
  const missing = await pool.query('SELECT id FROM users WHERE referral_code IS NULL');
  for (const row of missing.rows) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = crypto.randomBytes(4).toString('hex');
      try {
        await pool.query('UPDATE users SET referral_code = $1 WHERE id = $2', [code, row.id]);
        break;
      } catch {
        // unique collision, regenerate
      }
    }
  }
}
