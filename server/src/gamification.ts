import { Pool, PoolClient } from 'pg';

export const LEVELS = [
  { key: 'bronze', name: 'Bronze', min: 0 },
  { key: 'silver', name: 'Silver', min: 1000 },
  { key: 'gold', name: 'Gold', min: 5000 },
  { key: 'platinum', name: 'Platinum', min: 20000 },
  { key: 'diamond', name: 'Diamond', min: 100000 },
] as const;

export const STREAK_BONUS_CENTS = [1, 2, 3, 5, 8, 12, 20];

export const CHALLENGE = {
  key: 'earn_3',
  title: 'Complete 3 offers today',
  needed: 3,
  bonus_cents: 15,
};

export function levelFor(totalEarnedCents: number) {
  let index = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (totalEarnedCents >= LEVELS[i].min) index = i;
  }
  const current = LEVELS[index];
  const next = index < LEVELS.length - 1 ? LEVELS[index + 1] : null;
  const progress = next
    ? Math.min(100, Math.round(((totalEarnedCents - current.min) / (next.min - current.min)) * 100))
    : 100;
  return { current, next, progress };
}

export function streakBonusFor(streakCount: number): number {
  return STREAK_BONUS_CENTS[Math.min(streakCount, STREAK_BONUS_CENTS.length) - 1] || 0;
}

export interface AchievementStats {
  verified: boolean;
  earnTxCount: number;
  totalEarnedCents: number;
  referralCount: number;
  cashoutCount: number;
  streakCount: number;
}

interface AchievementDef {
  key: string;
  title: string;
  description: string;
  check: (s: AchievementStats) => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { key: 'verified', title: 'Verified Member', description: 'Confirm your email address', check: (s) => s.verified },
  { key: 'first_offer', title: 'First Earnings', description: 'Complete your first offer', check: (s) => s.earnTxCount >= 1 },
  { key: 'ten_offers', title: 'Offer Veteran', description: 'Complete 10 offers', check: (s) => s.earnTxCount >= 10 },
  { key: 'earn_10', title: 'Pocket Money', description: 'Earn $10 in total', check: (s) => s.totalEarnedCents >= 1000 },
  { key: 'earn_50', title: 'Halfway Hero', description: 'Earn $50 in total', check: (s) => s.totalEarnedCents >= 5000 },
  { key: 'earn_200', title: 'Big Earner', description: 'Earn $200 in total', check: (s) => s.totalEarnedCents >= 20000 },
  { key: 'first_cashout', title: 'Cashout!', description: 'Get your first withdrawal approved', check: (s) => s.cashoutCount >= 1 },
  { key: 'streak_7', title: 'Week Warrior', description: 'Reach a 7-day login streak', check: (s) => s.streakCount >= 7 },
  { key: 'five_referrals', title: 'Connector', description: 'Invite 5 friends', check: (s) => s.referralCount >= 5 },
];

export async function loadStats(pool: Pool, userId: number): Promise<AchievementStats | null> {
  const result = await pool.query(
    `SELECT u.email_verified_at, u.streak_count, u.total_earned_cents,
            (SELECT COUNT(*)::int FROM transactions t WHERE t.user_id = u.id AND t.type = 'earn') AS earn_tx,
            (SELECT COUNT(*)::int FROM users r WHERE r.referred_by = u.id) AS referrals,
            (SELECT COUNT(*)::int FROM withdrawals w WHERE w.user_id = u.id AND w.status = 'approved') AS cashouts
     FROM users u WHERE u.id = $1`,
    [userId]
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return {
    verified: Boolean(row.email_verified_at),
    earnTxCount: row.earn_tx,
    totalEarnedCents: row.total_earned_cents,
    referralCount: row.referrals,
    cashoutCount: row.cashouts,
    streakCount: row.streak_count,
  };
}

export async function checkAchievements(
  pool: Pool,
  userId: number
): Promise<{
  all: Array<{ key: string; title: string; description: string; unlocked_at: string | null }>;
  newly: string[];
} | null> {
  const stats = await loadStats(pool, userId);
  if (!stats) return null;

  const unlockedRows = await pool.query(
    'SELECT ach_key, unlocked_at FROM user_achievements WHERE user_id = $1',
    [userId]
  );
  const unlocked = new Map<string, string>(
    unlockedRows.rows.map((r) => [r.ach_key, r.unlocked_at])
  );

  const newly: string[] = [];
  for (const def of ACHIEVEMENTS) {
    if (!def.check(stats)) continue;
    if (unlocked.has(def.key)) continue;
    const inserted = await pool.query(
      'INSERT INTO user_achievements (user_id, ach_key) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING unlocked_at',
      [userId, def.key]
    );
    if (inserted.rowCount) {
      unlocked.set(def.key, inserted.rows[0].unlocked_at);
      newly.push(def.title);
    }
  }

  return {
    all: ACHIEVEMENTS.map((def) => ({
      key: def.key,
      title: def.title,
      description: def.description,
      unlocked_at: unlocked.get(def.key) ?? null,
    })),
    newly,
  };
}

export async function claimDailyStreak(
  client: PoolClient,
  userId: number
): Promise<{ ok: true; streak: number; bonus_cents: number } | { ok: false; error: string; status: number }> {
  const row = await client.query(
    `SELECT streak_count,
            COALESCE(last_bonus_date = CURRENT_DATE, FALSE) AS claimed_today,
            COALESCE(last_bonus_date = CURRENT_DATE - 1, FALSE) AS consecutive
     FROM users WHERE id = $1 FOR UPDATE`,
    [userId]
  );
  if (!row.rowCount) return { ok: false, error: 'User not found', status: 404 };
  const { streak_count, claimed_today, consecutive } = row.rows[0];

  if (claimed_today) {
    return { ok: false, error: 'Daily bonus already claimed today', status: 409 };
  }

  const streak = consecutive ? streak_count + 1 : 1;
  const bonus = streakBonusFor(streak);

  await client.query('UPDATE users SET streak_count = $1, last_bonus_date = CURRENT_DATE WHERE id = $2', [
    streak,
    userId,
  ]);
  await client.query(
    `INSERT INTO transactions (user_id, type, amount_cents, description) VALUES ($1, 'bonus', $2, $3)`,
    [userId, bonus, `Daily streak bonus - Day ${streak}`]
  );
  await client.query('UPDATE users SET balance_cents = balance_cents + $1 WHERE id = $2', [
    bonus,
    userId,
  ]);
  return { ok: true, streak, bonus_cents: bonus };
}

export async function challengeProgress(pool: Pool | PoolClient, userId: number): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS c FROM transactions
     WHERE user_id = $1 AND type = 'earn' AND created_at >= date_trunc('day', NOW())`,
    [userId]
  );
  return result.rows[0].c;
}
