import bcrypt from 'bcryptjs';
import { pool } from './db';

const OFFERWALLS = [
  {
    name: 'BitLabs',
    slug: 'bitlabs',
    description: 'Fun branded surveys with instant rewards and a loyalty program.',
    color: '#f59e0b',
    offers: [
      { title: 'Quick Consumer Survey', description: 'Share your shopping habits (8 questions).', reward_cents: 45, device: 'any' },
      { title: 'Streaming Habits Study', description: 'Tell us what you watch online.', reward_cents: 80, device: 'any' },
      { title: 'Mobile Gaming Poll', description: 'Answer questions about mobile games.', reward_cents: 120, device: 'mobile' },
    ],
  },
  {
    name: 'AdGate Media',
    slug: 'adgate',
    description: 'Trusted offerwall with app trials, signups, and video offers.',
    color: '#6366f1',
    offers: [
      { title: 'Watch a 30s Video', description: 'Play a sponsored video to the end.', reward_cents: 10, device: 'any' },
      { title: 'Try a Free App Trial', description: 'Install and open a featured app.', reward_cents: 350, device: 'mobile' },
      { title: 'Sign Up for a Newsletter', description: 'Confirm your email subscription.', reward_cents: 60, device: 'any' },
    ],
  },
  {
    name: 'OfferToro',
    slug: 'offertoro',
    description: 'High-paying deals ranging from purchases to account creations.',
    color: '#10b981',
    offers: [
      { title: 'Create a Free Account', description: 'Register on a partner website.', reward_cents: 200, device: 'any' },
      { title: 'Complete Your Profile', description: 'Finish a partner onboarding flow.', reward_cents: 150, device: 'any' },
      { title: 'Play a Browser Game', description: 'Reach level 3 in a featured game.', reward_cents: 500, device: 'pc' },
    ],
  },
  {
    name: 'CPX Research',
    slug: 'cpx',
    description: 'Mobile-optimized survey network with high completion rates.',
    color: '#ec4899',
    offers: [
      { title: 'Travel Preferences Survey', description: 'Tell us about your ideal vacation.', reward_cents: 70, device: 'any' },
      { title: 'Food & Drink Questionnaire', description: 'Rate some popular snacks.', reward_cents: 90, device: 'any' },
      { title: 'Finance Habits Interview', description: 'A longer, higher-paying study.', reward_cents: 250, device: 'pc' },
    ],
  },
];

export async function seed(): Promise<void> {
  const adminExists = await pool.query('SELECT 1 FROM users WHERE is_admin = TRUE LIMIT 1');
  if (!adminExists.rowCount) {
    const hash = await bcrypt.hash('admin12345', 10);
    await pool.query(
      "INSERT INTO users (username, email, password_hash, is_admin, email_verified_at) VALUES ('admin', 'admin@gptsite.test', $1, TRUE, NOW()) ON CONFLICT DO NOTHING",
      [hash]
    );
    console.log('[seed] admin user created (username: admin, password: admin12345)');
  } else {
    await pool.query(
      'UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE is_admin = TRUE'
    );
  }

  const wallCount = await pool.query('SELECT COUNT(*)::int AS c FROM offerwalls');
  if (wallCount.rows[0].c === 0) {
    for (const wall of OFFERWALLS) {
      const inserted = await pool.query(
        'INSERT INTO offerwalls (name, slug, description, color) VALUES ($1, $2, $3, $4) RETURNING id',
        [wall.name, wall.slug, wall.description, wall.color]
      );
      for (const offer of wall.offers) {
        await pool.query(
          'INSERT INTO offers (offerwall_id, title, description, reward_cents, device) VALUES ($1, $2, $3, $4, $5)',
          [inserted.rows[0].id, offer.title, offer.description, offer.reward_cents, offer.device]
        );
      }
    }
    console.log('[seed] offerwalls created');
  }

  await pool.query(
    `UPDATE offerwalls SET postback_secret = 'secret_' || slug WHERE postback_secret IS NULL`
  );
  await pool.query(
    `UPDATE offerwalls SET postback_config = CASE slug
        WHEN 'adgate' THEN '{"adapter":"adgate"}'::jsonb
        WHEN 'bitlabs' THEN '{"adapter":"bitlabs"}'::jsonb
        WHEN 'cpx' THEN '{"adapter":"cpx"}'::jsonb
        ELSE '{"adapter":"generic"}'::jsonb
      END
     WHERE postback_config IS NULL`
  );
}
