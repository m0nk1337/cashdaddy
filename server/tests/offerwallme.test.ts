import crypto from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  signUserIdentity,
  buildFeedQuery,
  fetchFeed,
  submitTask,
  isOfferwallMeFeed,
} from '../src/offerwallme';

const PUB = 'PUBKEY123';
const SECRET = 'SECRET456';
const BEARER = 'BEARER789';

function mockFetch(handler: (url: string) => { status?: number; body: unknown }) {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const { status = 200, body } = handler(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('signUserIdentity', () => {
  it('produces the documented HMAC-SHA256 signature over the exact message', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
    const now = Math.floor(Date.now() / 1000);

    const { expires, signature } = signUserIdentity(PUB, SECRET, '42', 3600);
    expect(expires).toBe(String(now + 3600));

    const expected = crypto
      .createHmac('sha256', SECRET)
      .update(`offerwall-user-v1\n${PUB}\n42\n${expires}`)
      .digest('hex');
    expect(signature).toBe(expected);
    expect(signature).toHaveLength(64);
  });
});

describe('buildFeedQuery', () => {
  it('includes credentials, country and signed identity', () => {
    const query = new URLSearchParams(
      buildFeedQuery({ publicKey: PUB, secret: SECRET, bearer: BEARER }, '7', '8.8.8.8', 'GB')
    );
    expect(query.get('api')).toBe(PUB);
    expect(query.get('id')).toBe('7');
    expect(query.get('ip')).toBe('8.8.8.8');
    expect(query.get('token')).toBe(BEARER);
    expect(query.get('country')).toBe('GB');
    expect(query.get('identityExpires')).toMatch(/^\d+$/);
    expect(query.get('identitySignature')).toHaveLength(64);
  });
});

describe('fetchFeed', () => {
  it('aggregates and normalizes each module, converting reward to cents', async () => {
    mockFetch((url) => {
      if (url.includes('/offerapi.php')) {
        return {
          body: {
            status: 200,
            data: [
              {
                id: 'of1',
                title: 'Install and register',
                description: 'Register to earn',
                reward: '120',
                payout: '1.200000',
                countries: ['US'],
                devices: ['Android'],
                url: 'https://offerwall.me/offerstart.php?x=1',
              },
            ],
          },
        };
      }
      if (url.includes('/api.php')) {
        return { body: { status: 200, data: [{ title: 'Watch a video', reward: '3', duration: 15, url: 'https://offerwall.me/si.php' }] } };
      }
      if (url.includes('/slapi.php')) {
        return { body: { status: 200, data: [{ id: 'sl1', name: 'earnow', shortlink: 'earnow.online', reward: '1', remaining_views: 5, url: 'https://offerwall.me/start.php' }] } };
      }
      if (url.includes('/taskapi.php')) {
        return { body: { status: 200, data: [{ id: 'tk1', title: 'Join community', description: 'Join us', instructions: '<b>Click</b>', proof_type: 'Text', reward: '44', countries: ['ALL'] }] } };
      }
      return { body: { status: 200, data: [] } };
    });

    const feed = await fetchFeed({ publicKey: PUB, secret: SECRET, bearer: BEARER }, 'u1', '1.1.1.1', 'US');
    expect(feed).toHaveLength(4);
    const offer = feed.find((c) => c.type === 'offer');
    expect(offer?.reward_cents).toBe(120);
    expect(offer?.url).toBe('https://offerwall.me/offerstart.php?x=1');
    const task = feed.find((c) => c.type === 'task');
    expect(task?.key).toBe('task:tk1');
    expect(task?.reward_cents).toBe(44);
    expect(task?.proof_type).toBe('Text');
    expect(feed.find((c) => c.type === 'ptc')?.key).toBe('ptc:0');
    expect(feed.find((c) => c.type === 'shortlink')?.remaining).toBe(5);
  });

  it('treats a failing module as empty and still returns others', async () => {
    mockFetch((url) =>
      url.includes('/api.php') ? { status: 500, body: {} } : { body: { status: 200, data: [] } }
    );
    const feed = await fetchFeed({ publicKey: PUB, secret: SECRET, bearer: BEARER }, 'u2', '1.1.1.2', 'US');
    expect(feed).toEqual([]);
  });

  it('caches by user, country and ip', async () => {
    const spy = mockFetch(() => ({ body: { status: 200, data: [] } }));
    await fetchFeed({ publicKey: PUB, secret: SECRET, bearer: BEARER }, 'u3', '1.1.1.3', 'US');
    const callsAfterFirst = spy.mock.calls.length;
    await fetchFeed({ publicKey: PUB, secret: SECRET, bearer: BEARER }, 'u3', '1.1.1.3', 'US');
    expect(spy.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe('submitTask', () => {
  it('POSTs JSON proof and returns the review status', async () => {
    const spy = mockFetch(() => ({ body: { status: 200, data: { status: 'Approved' } } }));
    const result = await submitTask({
      publicKey: PUB,
      secret: SECRET,
      bearer: BEARER,
      userId: '9',
      ip: '2.2.2.2',
      country: 'US',
      taskId: 'tk9',
      proof: 'my proof',
    });
    expect(result).toEqual({ ok: true, status: 'Approved' });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://offerwall.me/tasksubmit.php');
    expect(init.method).toBe('POST');
    const payload = JSON.parse(String(init.body));
    expect(payload.task_id).toBe('tk9');
    expect(payload.proof).toBe('my proof');
    expect(payload.identitySignature).toHaveLength(64);
  });

  it('surfaces API errors', async () => {
    mockFetch(() => ({ status: 200, body: { status: 403, message: 'Invalid signature' } }));
    const result = await submitTask({
      publicKey: PUB,
      secret: SECRET,
      bearer: BEARER,
      userId: '9',
      ip: '2.2.2.2',
      country: 'US',
      taskId: 'tk9',
      proof: 'x',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid signature');
  });
});

describe('isOfferwallMeFeed', () => {
  it('requires a signed offerwall.me config with a public key', () => {
    expect(isOfferwallMeFeed({ signing: 'offerwallme', public_key: 'abc' })).toBe(true);
    expect(isOfferwallMeFeed({ signing: 'offerwallme' })).toBe(false);
    expect(isOfferwallMeFeed({ signing: 'other', public_key: 'abc' })).toBe(false);
    expect(isOfferwallMeFeed(null)).toBe(false);
  });
});
