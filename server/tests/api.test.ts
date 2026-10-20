import crypto from 'crypto';
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { initSchema, pool } from '../src/db';
import { seed } from '../src/seed';

const app = createApp();

function uniq(): string {
  return crypto.randomBytes(4).toString('hex');
}

async function registerUser(prefix: string, ref?: string) {
  const username = `${prefix}_${uniq()}`;
  const email = `${username}@test.local`;
  const password = 'testpass123';
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, email, password, ...(ref ? { ref } : {}) })
    .expect(201);
  return {
    username,
    email,
    password,
    token: res.body.token as string,
    id: res.body.user.id as number,
  };
}

async function verifyEmail(userId: number): Promise<void> {
  const row = await pool.query('SELECT verify_token FROM users WHERE id = $1', [userId]);
  const token = row.rows[0]?.verify_token;
  if (!token) {
    await pool.query('UPDATE users SET email_verified_at = NOW() WHERE id = $1', [userId]);
    return;
  }
  await request(app).get(`/api/auth/verify-email?token=${token}`).expect(200);
}

async function balanceOf(userId: number): Promise<number> {
  const row = await pool.query('SELECT balance_cents FROM users WHERE id = $1', [userId]);
  return row.rows[0].balance_cents;
}

async function adminToken(): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: 'admin', password: 'admin12345' })
    .expect(200);
  return res.body.token as string;
}

let offerId: number;
let offerReward: number;

beforeAll(async () => {
  await initSchema();
  await seed();
  const offers = await pool.query('SELECT id, reward_cents FROM offers ORDER BY id LIMIT 1');
  offerId = offers.rows[0].id;
  offerReward = offers.rows[0].reward_cents;
});

describe('auth', () => {
  it('registers, logs in, and returns the profile', async () => {
    const user = await registerUser('auth');
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: user.username, password: user.password })
      .expect(200);
    expect(login.body.token).toBeTruthy();

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.token}`)
      .expect(200);
    expect(me.body.user.username).toBe(user.username.toLowerCase());
  });

  it('rejects duplicate usernames and wrong passwords', async () => {
    const user = await registerUser('dup');
    await request(app)
      .post('/api/auth/register')
      .send({ username: user.username, email: `${uniq()}@x.test`, password: 'testpass123' })
      .expect(409);
    await request(app)
      .post('/api/auth/login')
      .send({ username: user.username, password: 'wrong-password' })
      .expect(401);
  });

  it('rejects invalid registration payloads', async () => {
    await request(app).post('/api/auth/register').send({ username: 'x', email: 'a@b.co', password: '12345678' }).expect(400);
    await request(app).post('/api/auth/register').send({ username: 'valid_name', email: 'nope', password: '12345678' }).expect(400);
  });

  it('requires auth on protected routes', async () => {
    await request(app).get('/api/auth/me').expect(401);
    await request(app).get('/api/wallet/transactions').expect(401);
    await request(app).get('/api/admin/stats').expect(401);
  });

  it('completes a full password reset flow', async () => {
    const user = await registerUser('reset');
    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: user.email })
      .expect(200);
    const row = await pool.query('SELECT reset_token FROM users WHERE id = $1', [user.id]);
    const token = row.rows[0].reset_token;
    expect(token).toBeTruthy();

    await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'brandnewpass1' })
      .expect(200);
    await request(app)
      .post('/api/auth/login')
      .send({ username: user.username, password: 'brandnewpass1' })
      .expect(200);
    await request(app)
      .post('/api/auth/login')
      .send({ username: user.username, password: user.password })
      .expect(401);
    await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'anotherpass1' })
      .expect(400);
  });

  it('does not leak whether an email exists on forgot-password', async () => {
    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: `nobody_${uniq()}@missing.test` })
      .expect(200);
    await request(app).post('/api/auth/forgot-password').send({ email: 'not-an-email' }).expect(400);
  });
});

describe('wallet and offers', () => {
  it('credits demo offer completions exactly once', async () => {
    const user = await registerUser('offer');
    const before = await balanceOf(user.id);

    const done = await request(app)
      .post(`/api/offerwalls/offers/${offerId}/complete`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(201);
    expect(done.body.balance_cents).toBe(before + offerReward);
    expect(done.body.total_earned_cents).toBe(offerReward);

    await request(app)
      .post(`/api/offerwalls/offers/${offerId}/complete`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(409);
  });

  it('blocks withdrawals until email is verified, then processes them', async () => {
    const user = await registerUser('wd');
    await pool.query('UPDATE users SET balance_cents = 10000 WHERE id = $1', [user.id]);

    await request(app)
      .post('/api/wallet/withdraw')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ amountCents: 500, method: 'paypal', destination: 'user@example.com' })
      .expect(403);

    await verifyEmail(user.id);

    const tooMuch = await request(app)
      .post('/api/wallet/withdraw')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ amountCents: 99999, method: 'paypal', destination: 'user@example.com' })
      .expect(400);
    expect(tooMuch.body.error).toMatch(/Insufficient/);

    const small = await request(app)
      .post('/api/wallet/withdraw')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ amountCents: 400, method: 'paypal', destination: 'user@example.com' })
      .expect(400);
    expect(small.body.error).toMatch(/Minimum/);

    const wd = await request(app)
      .post('/api/wallet/withdraw')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ amountCents: 500, method: 'paypal', destination: 'user@example.com' })
      .expect(201);
    expect(wd.body.withdrawal.status).toBe('pending');
    expect(wd.body.balance_cents).toBe(9500);

    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin12345' })
      .expect(200);
    const adminToken = adminLogin.body.token as string;

    await request(app)
      .post(`/api/admin/withdrawals/${wd.body.withdrawal.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const list = await request(app)
      .get('/api/wallet/withdrawals')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(list.body.withdrawals[0].status).toBe('approved');

    const wd2 = await request(app)
      .post('/api/wallet/withdraw')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ amountCents: 600, method: 'paypal', destination: 'user@example.com' })
      .expect(201);
    await request(app)
      .post(`/api/admin/withdrawals/${wd2.body.withdrawal.id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(await balanceOf(user.id)).toBe(9500);
    const txs = await request(app)
      .get('/api/wallet/transactions')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    const refund = txs.body.transactions.find((t: { description: string }) =>
      t.description.includes('refund')
    );
    expect(refund.amount_cents).toBe(600);
  });
});

describe('postbacks', () => {
  it('credits, deduplicates, and reverses via the generic adapter', async () => {
    const user = await registerUser('pb');
    const secret = 'secret_offertoro';
    const txn = `txn_${uniq()}`;
    const amount = 175;

    const sig = (tx: string, act = 'credit') =>
      crypto
        .createHmac('sha256', secret)
        .update(`${user.id}:${tx}:${amount}:${act}`)
        .digest('hex');

    const credited = await request(app)
      .get(`/api/postback/offertoro?user=${user.id}&tx=${txn}&amount=${amount}&action=credit&sig=${sig(txn)}`)
      .expect(200);
    expect(credited.body.status).toBe('credited');
    expect(await balanceOf(user.id)).toBe(amount);

    const dup = await request(app)
      .get(`/api/postback/offertoro?user=${user.id}&tx=${txn}&amount=${amount}&action=credit&sig=${sig(txn)}`)
      .expect(200);
    expect(dup.body.status).toBe('duplicate');

    const badSig = await request(app)
      .get(`/api/postback/offertoro?user=${user.id}&tx=txn_bad&amount=${amount}&action=credit&sig=deadbeef`)
      .expect(403);
    expect(badSig.body.error).toBe('validation failed');

    const reversed = await request(app)
      .get(`/api/postback/offertoro?user=${user.id}&tx=${txn}&amount=${amount}&action=reverse&sig=${sig(txn, 'reverse')}`)
      .expect(200);
    expect(reversed.body.status).toBe('reversed');
    expect(await balanceOf(user.id)).toBe(0);
  });

  it('ignores oversized rewards and unknown users', async () => {
    const user = await registerUser('pbcap');
    const secret = 'secret_offertoro';
    const sig = (tx: string, amt: number) =>
      crypto
        .createHmac('sha256', secret)
        .update(`${user.id}:${tx}:${amt}:credit`)
        .digest('hex');
    const bigTx = `txn_big_${uniq()}`;
    const capped = await request(app)
      .get(`/api/postback/offertoro?user=${user.id}&tx=${bigTx}&amount=999999&action=credit&sig=${sig(bigTx, 999999)}`)
      .expect(200);
    expect(capped.body.status).toBe('oversized_reward');

    const unknownTx = `txn_unk_${uniq()}`;
    const unknown = await request(app)
      .get(`/api/postback/offertoro?user=999999999&tx=${unknownTx}&amount=100&action=credit&sig=${crypto.createHmac('sha256', secret).update(`999999999:${unknownTx}:100:credit`).digest('hex')}`)
      .expect(200);
    expect(unknown.body.status).toBe('unknown_user');
  });

  it('validates the CPX hash format', async () => {
    const user = await registerUser('cpx');
    const secret = 'secret_cpx';
    const txn = `cpx_${uniq()}`;
    const hash = crypto.createHash('md5').update(txn + secret).digest('hex');
    const credited = await request(app)
      .get(`/api/postback/cpx?user_id=${user.id}&trans_id=${txn}&status=1&amount_local=200&hash=${hash}`)
      .expect(200);
    expect(credited.body.status).toBe('credited');

    const bad = await request(app)
      .get(`/api/postback/cpx?user_id=${user.id}&trans_id=${txn}_bad&status=1&amount_local=200&hash=0000`)
      .expect(403);
    expect(bad.body.error).toBe('validation failed');
  });
});

describe('admin', () => {
  it('rejects non-admins and manages offerwall mode', async () => {
    const user = await registerUser('notadmin');
    await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${user.token}`).expect(403);

    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin12345' })
      .expect(200);
    const adminToken = adminLogin.body.token as string;

    const walls = await request(app)
      .get('/api/admin/offerwalls')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const bitlabs = walls.body.offerwalls.find((w: { slug: string }) => w.slug === 'bitlabs');

    await request(app)
      .patch(`/api/admin/offerwalls/${bitlabs.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'banana' })
      .expect(400);

    await request(app)
      .patch(`/api/admin/offerwalls/${bitlabs.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'live', wall_url: `https://walls.example.com/bitlabs?user={userId}` })
      .expect(200);

    const publicWalls = await request(app).get('/api/offerwalls').expect(200);
    const publicBitlabs = publicWalls.body.offerwalls.find(
      (w: { id: number }) => w.id === bitlabs.id
    );
    expect(publicBitlabs.mode).toBe('live');
    expect(publicBitlabs.display_name).toBe('Surveys');
    expect(publicBitlabs.wall_url).toContain('{userId}');
    expect(publicBitlabs.postback_secret).toBeUndefined();
    expect(publicBitlabs.name).toBeUndefined();
    expect(publicBitlabs.slug).toBeUndefined();

    const demoWallsHidden = publicWalls.body.offerwalls.filter(
      (w: { mode: string }) => w.mode === 'demo'
    );
    expect(demoWallsHidden.length).toBe(0);

    const demoVisibleToUser = await request(app)
      .get('/api/offerwalls')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(demoVisibleToUser.body.offerwalls.length).toBe(publicWalls.body.offerwalls.length);

    const demoVisibleToAdmin = await request(app)
      .get('/api/offerwalls')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(
      demoVisibleToAdmin.body.offerwalls.filter((w: { mode: string }) => w.mode === 'demo').length
    ).toBeGreaterThan(0);

    await request(app)
      .patch(`/api/admin/offerwalls/${bitlabs.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'demo', wall_url: '' })
      .expect(200);
    const reverted = await request(app).get('/api/offerwalls').expect(200);
    const revertedBitlabs = reverted.body.offerwalls.find(
      (w: { id: number }) => w.id === bitlabs.id
    );
    expect(revertedBitlabs).toBeUndefined();
  });

  it('returns stats', async () => {
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin12345' })
      .expect(200);
    const stats = await request(app)
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${adminLogin.body.token}`)
      .expect(200);
    expect(stats.body.totalUsers).toBeGreaterThan(0);
  });
});

describe('referrals', () => {
  it('pays the referrer on signup bonus and 10% of referee earnings', async () => {
    const referrer = await registerUser('refparent');
    const info = await request(app)
      .get('/api/wallet/referral')
      .set('Authorization', `Bearer ${referrer.token}`)
      .expect(200);
    expect(info.body.referral.referral_code).toMatch(/^[a-f0-9]{8}$/);
    expect(info.body.referral.referral_count).toBe(0);

    const referee = await registerUser('refchild', info.body.referral.referral_code);
    const linkCheck = await pool.query('SELECT referred_by FROM users WHERE id = $1', [referee.id]);
    expect(linkCheck.rows[0].referred_by).toBe(referrer.id);

    await verifyEmail(referee.id);
    await new Promise((r) => setTimeout(r, 300));
    expect(await balanceOf(referrer.id)).toBe(25);

    const beforeRef = await balanceOf(referrer.id);
    const done = await request(app)
      .post(`/api/offerwalls/offers/${offerId}/complete`)
      .set('Authorization', `Bearer ${referee.token}`)
      .expect(201);
    expect(done.body.balance_cents).toBe(offerReward);
    await new Promise((r) => setTimeout(r, 200));
    expect(await balanceOf(referrer.id)).toBe(beforeRef + Math.floor(offerReward * 0.1));

    const stats = await request(app)
      .get('/api/wallet/referral')
      .set('Authorization', `Bearer ${referrer.token}`)
      .expect(200);
    expect(stats.body.referral.referral_count).toBe(1);
    expect(stats.body.referral.total_bonus_cents).toBe(25 + Math.floor(offerReward * 0.1));
  });

  it('ignores unknown referral codes', async () => {
    const user = await registerUser('refbad', 'deadbeef');
    const linkCheck = await pool.query('SELECT referred_by FROM users WHERE id = $1', [user.id]);
    expect(linkCheck.rows[0].referred_by).toBeNull();
  });
});

describe('gamification', () => {
  it('serves profile bundle with streak, level, challenge, achievements', async () => {
    const user = await registerUser('gprofile');
    const res = await request(app)
      .get('/api/gamification')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(res.body.streak.count).toBe(0);
    expect(res.body.streak.claimed_today).toBe(false);
    expect(res.body.level.current.name).toBe('Bronze');
    expect(res.body.challenge.needed).toBe(3);
    expect(res.body.achievements.length).toBeGreaterThan(5);
    expect(res.body.achievements.find((a: { key: string }) => a.key === 'first_offer').unlocked_at).toBeNull();
  });

  it('claims daily streak bonus once per day', async () => {
    const user = await registerUser('gstreak');
    const first = await request(app)
      .post('/api/gamification/daily-bonus')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(first.body.streak).toBe(1);
    expect(first.body.bonus_cents).toBe(1);
    expect(await balanceOf(user.id)).toBe(1);

    await request(app)
      .post('/api/gamification/daily-bonus')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(409);

    const profile = await request(app)
      .get('/api/gamification')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(profile.body.streak.claimed_today).toBe(true);
  });

  it('grants challenge reward after 3 offers and only once', async () => {
    const user = await registerUser('gchal');
    await request(app)
      .post('/api/gamification/challenge/claim')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(400);

    for (let i = 0; i < 3; i++) {
      await pool.query(
        `INSERT INTO transactions (user_id, type, amount_cents, description) VALUES ($1, 'earn', 100, 'test earn')`,
        [user.id]
      );
    }
    const claim = await request(app)
      .post('/api/gamification/challenge/claim')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(claim.body.bonus_cents).toBe(15);
    expect(await balanceOf(user.id)).toBe(15);

    await request(app)
      .post('/api/gamification/challenge/claim')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(409);
  });

  it('unlocks achievements when profile is loaded after earning', async () => {
    const user = await registerUser('gach');
    await request(app)
      .post(`/api/offerwalls/offers/${offerId}/complete`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(201);
    const profile = await request(app)
      .get('/api/gamification')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    const first = profile.body.achievements.find((a: { key: string }) => a.key === 'first_offer');
    expect(first.unlocked_at).not.toBeNull();
    expect(profile.body.newly_unlocked).toContain('First Earnings');

    const again = await request(app)
      .get('/api/gamification')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(again.body.newly_unlocked).toHaveLength(0);
  });

  it('serves the weekly leaderboard with my rank', async () => {
    const user = await registerUser('glb');
    const res = await request(app)
      .get('/api/gamification/leaderboard')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(Array.isArray(res.body.top)).toBe(true);
    expect(res.body.me.rank).toBeGreaterThanOrEqual(1);
    expect(res.body.me.earned).toBeGreaterThanOrEqual(0);
  });

  it('creates and redeems promo codes exactly once per user', async () => {
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin12345' })
      .expect(200);
    const adminToken = adminLogin.body.token as string;
    const code = `TEST${uniq().toUpperCase()}`;

    await request(app)
      .post('/api/admin/promo-codes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, bonus_cents: 50, max_uses: 5 })
      .expect(201);
    await request(app)
      .post('/api/admin/promo-codes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, bonus_cents: 50 })
      .expect(409);

    const user = await registerUser('gpromo');
    await request(app)
      .post('/api/gamification/redeem')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ code: 'NOSUCHCODE' })
      .expect(404);

    const redeemed = await request(app)
      .post('/api/gamification/redeem')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ code: code.toLowerCase() })
      .expect(200);
    expect(redeemed.body.bonus_cents).toBe(50);
    expect(await balanceOf(user.id)).toBe(50);

    await request(app)
      .post('/api/gamification/redeem')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ code })
      .expect(409);
  });

  it('serves a public recent wins feed without leaking usernames', async () => {
    const res = await request(app).get('/api/gamification/recent-wins').expect(200);
    expect(Array.isArray(res.body.wins)).toBe(true);
    for (const w of res.body.wins) {
      expect(w.user).toMatch(/\*\*\*$/);
    }
  });
});

describe('offerwall.me integration', () => {
  async function adminToken(): Promise<string> {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin12345' })
      .expect(200);
    return res.body.token as string;
  }

  it('seeds the wall white-labeled and hidden from users while demo', async () => {
    const token = await adminToken();
    const walls = await request(app)
      .get('/api/admin/offerwalls')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const wall = walls.body.offerwalls.find((w: { slug: string }) => w.slug === 'offerwall-me');
    expect(wall).toBeTruthy();
    expect(wall.display_name).toBe('Micro Tasks');
    expect(wall.postback_config).toMatchObject({ adapter: 'offerwallme', signing: 'offerwallme' });

    const anon = await request(app).get('/api/offerwalls').expect(200);
    expect(anon.body.offerwalls.find((w: { id: number }) => w.id === wall.id)).toBeUndefined();
    const named = anon.body.offerwalls.some(
      (w: { display_name?: string; name?: string }) =>
        w.display_name === 'Micro Tasks' || w.name === 'Offerwall.me'
    );
    expect(named).toBe(false);
  });

  it('serves HMAC-signed embed URLs and settles signed postbacks', async () => {
    const token = await adminToken();
    const walls = await request(app)
      .get('/api/admin/offerwalls')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const wall = walls.body.offerwalls.find((w: { slug: string }) => w.slug === 'offerwall-me');

    await request(app)
      .patch(`/api/admin/offerwalls/${wall.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        mode: 'live',
        wall_url: 'https://offerwall.me/offerwall/{publicKey}/{userId}',
        public_key: 'pk_test_123',
        postback_secret: 'secret_ow_test',
      })
      .expect(200);

    const user = await registerUser('owall');
    await request(app).get('/api/offerwalls/embed-urls').expect(401);

    const embed = await request(app)
      .get('/api/offerwalls/embed-urls')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    const url: string = embed.body.urls[String(wall.id)];
    expect(url).toContain(`https://offerwall.me/offerwall/pk_test_123/${user.id}`);
    const parsed = new URL(url);
    const expires = parsed.searchParams.get('identityExpires');
    const sig = parsed.searchParams.get('identitySignature');
    expect(expires).toBeTruthy();
    const expected = crypto
      .createHmac('sha256', 'secret_ow_test')
      .update(`offerwall-user-v1\npk_test_123\n${user.id}\n${expires}`)
      .digest('hex');
    expect(sig).toBe(expected);

    const reward = '75';
    const txn = `ow_${uniq()}`;
    const sigOf = (s: string) =>
      crypto.createHash('md5').update(String(user.id) + txn + reward + s).digest('hex');

    const credit = await request(app)
      .get(
        `/api/postback/offerwall-me?subId=${user.id}&transId=${txn}&reward=${reward}&status=1&offer_name=Watch+an+ad&signature=${sigOf('secret_ow_test')}`
      )
      .expect(200);
    expect(credit.body.status).toBe('credited');
    expect(await balanceOf(user.id)).toBe(75);

    const dup = await request(app)
      .get(
        `/api/postback/offerwall-me?subId=${user.id}&transId=${txn}&reward=${reward}&status=1&signature=${sigOf('secret_ow_test')}`
      )
      .expect(200);
    expect(dup.body.status).toBe('duplicate');
    expect(await balanceOf(user.id)).toBe(75);

    await request(app)
      .get(
        `/api/postback/offerwall-me?subId=${user.id}&transId=${txn}&reward=${reward}&status=1&signature=${sigOf('wrong_secret')}`
      )
      .expect(403);
    expect(await balanceOf(user.id)).toBe(75);

    const reversal = await request(app)
      .get(
        `/api/postback/offerwall-me?subId=${user.id}&transId=${txn}&reward=${reward}&status=2&signature=${sigOf('secret_ow_test')}`
      )
      .expect(200);
    expect(reversal.body.status).toBe('reversed');
    expect(await balanceOf(user.id)).toBe(0);

    await request(app)
      .patch(`/api/admin/offerwalls/${wall.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: 'demo', wall_url: '', public_key: '' })
      .expect(200);
    const embedAfter = await request(app)
      .get('/api/offerwalls/embed-urls')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(embedAfter.body.urls[String(wall.id)]).toBeUndefined();
  });
});

describe('offer session tracking', () => {
  async function liveWallId(token: string): Promise<number> {
    const walls = await request(app)
      .get('/api/admin/offerwalls')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const wall = walls.body.offerwalls.find((w: { slug: string }) => w.slug === 'offerwall-me');
    await request(app)
      .patch(`/api/admin/offerwalls/${wall.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        mode: 'live',
        wall_url: 'https://offerwall.me/offerwall/{publicKey}/{userId}',
        public_key: 'pk_session_test',
        postback_secret: 'secret_ow_session',
      })
      .expect(200);
    return wall.id as number;
  }

  it('requires auth to start or list sessions', async () => {
    await request(app).post('/api/offerwalls/1/start').send({}).expect(401);
    await request(app).get('/api/offerwalls/sessions').expect(401);
  });

  it('rejects an invalid campaign payload', async () => {
    const token = await adminToken();
    const wallId = await liveWallId(token);
    const user = await registerUser('sess');
    await request(app)
      .post(`/api/offerwalls/${wallId}/start`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ campaignKey: 'ptc:1', campaignType: 'nonsense', campaignTitle: 'x', expectedCents: 5 })
      .expect(400);
  });

  it('creates a pending session and marks it credited when the postback lands', async () => {
    const token = await adminToken();
    const wallId = await liveWallId(token);
    const user = await registerUser('sess');

    const start = await request(app)
      .post(`/api/offerwalls/${wallId}/start`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        campaignKey: 'ptc:3',
        campaignType: 'ptc',
        campaignTitle: 'Watch a video',
        expectedCents: 5,
      })
      .expect(201);
    const sessionId = start.body.sessionId as string;
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/i);

    const pending = await request(app)
      .get(`/api/offerwalls/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(pending.body.session.status).toBe('pending');
    expect(pending.body.session.campaign_title).toBe('Watch a video');

    const reward = '5';
    const txn = `owsess_${uniq()}`;
    const sig = crypto
      .createHash('md5')
      .update(String(user.id) + txn + reward + 'secret_ow_session')
      .digest('hex');
    const credit = await request(app)
      .get(
        `/api/postback/offerwall-me?subId=${user.id}&transId=${txn}&reward=${reward}&status=1&offer_name=Watch+an+ad&offer_type=ptc&signature=${sig}`
      )
      .expect(200);
    expect(credit.body.status).toBe('credited');
    expect(await balanceOf(user.id)).toBe(5);

    const after = await request(app)
      .get(`/api/offerwalls/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(after.body.session.status).toBe('credited');
    expect(after.body.session.credited_cents).toBe(5);
    expect(after.body.session.txn_id).toBe(txn);
  });

  it('still credits money even when no session was opened', async () => {
    await adminToken();
    const user = await registerUser('sessnolan');
    const reward = '9';
    const txn = `owsolo_${uniq()}`;
    const sig = crypto
      .createHash('md5')
      .update(String(user.id) + txn + reward + 'secret_ow_session')
      .digest('hex');
    const credit = await request(app)
      .get(
        `/api/postback/offerwall-me?subId=${user.id}&transId=${txn}&reward=${reward}&status=1&signature=${sig}`
      )
      .expect(200);
    expect(credit.body.status).toBe('credited');
    expect(await balanceOf(user.id)).toBe(9);

    const list = await request(app)
      .get('/api/offerwalls/sessions')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    const rows = list.body.sessions as { status: string; credited_cents: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('credited');
    expect(rows[0].credited_cents).toBe(9);
  });

  it('expires stale pending sessions and flags reversals', async () => {
    const token = await adminToken();
    const wallId = await liveWallId(token);
    const user = await registerUser('sessexp');

    const start = await request(app)
      .post(`/api/offerwalls/${wallId}/start`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ campaignKey: 'ptc:9', campaignType: 'ptc', campaignTitle: 'Stale', expectedCents: 4 })
      .expect(201);
    const sessionId = start.body.sessionId as string;
    await pool.query(
      `UPDATE offer_sessions SET created_at = NOW() - INTERVAL '45 minutes' WHERE id = $1`,
      [sessionId]
    );
    const stale = await request(app)
      .get(`/api/offerwalls/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(stale.body.session.status).toBe('expired');

    const fresh = await request(app)
      .post(`/api/offerwalls/${wallId}/start`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ campaignKey: 'ptc:10', campaignType: 'ptc', campaignTitle: 'Reversed', expectedCents: 8 })
      .expect(201);
    const freshId = fresh.body.sessionId as string;
    const reward = '8';
    const txn = `owrev_${uniq()}`;
    const sig = (s: string) =>
      crypto.createHash('md5').update(String(user.id) + txn + reward + s).digest('hex');
    await request(app)
      .get(
        `/api/postback/offerwall-me?subId=${user.id}&transId=${txn}&reward=${reward}&status=1&signature=${sig('secret_ow_session')}`
      )
      .expect(200);
    await request(app)
      .get(
        `/api/postback/offerwall-me?subId=${user.id}&transId=${txn}&reward=${reward}&status=2&signature=${sig('secret_ow_session')}`
      )
      .expect(200);
    const reversed = await request(app)
      .get(`/api/offerwalls/sessions/${freshId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(reversed.body.session.status).toBe('failed');
    expect(reversed.body.session.credited_cents).toBe(0);
  });

  it('does not leak another user session', async () => {
    const token = await adminToken();
    const wallId = await liveWallId(token);
    const owner = await registerUser('sessown');
    const other = await registerUser('sessoth');
    const start = await request(app)
      .post(`/api/offerwalls/${wallId}/start`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ campaignKey: 'ptc:11', campaignType: 'ptc', campaignTitle: 'Private', expectedCents: 3 })
      .expect(201);
    await request(app)
      .get(`/api/offerwalls/sessions/${start.body.sessionId}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
    const list = await request(app)
      .get('/api/offerwalls/sessions')
      .set('Authorization', `Bearer ${other.token}`)
      .expect(200);
    expect(list.body.sessions).toHaveLength(0);
  });
});
