import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBitcoTasksFeed, isBitcoTasksFeed } from '../src/bitcotasks';

const CFG = { apiKey: 'KEY123', secret: 'SECRET456', bearer: 'BEARER789' };

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
});

describe('isBitcoTasksFeed', () => {
  it('requires signing flag and an api key', () => {
    expect(isBitcoTasksFeed({ signing: 'bitcotasks', api_key: 'k' })).toBe(true);
    expect(isBitcoTasksFeed({ signing: 'bitcotasks' })).toBe(false);
    expect(isBitcoTasksFeed({ signing: 'offerwallme', api_key: 'k' })).toBe(false);
    expect(isBitcoTasksFeed(null)).toBe(false);
  });
});

describe('fetchBitcoTasksFeed', () => {
  it('aggregates offers, surveys, ptc and shortlinks with correct URLs', async () => {
    const spy = mockFetch((url) => {
      if (url.includes('/offer-api.php')) {
        return {
          body: {
            status: '200',
            data: [
              {
                id: '42fade91',
                title: 'Download and try this app',
                description: 'Install, open, and use for 3 minutes.',
                image: 'https://bitcotasks.com/uploads/offerwall/2201.jpeg',
                reward: '150.00',
                link: 'https://bitcotasks.com/track/abc',
                cpa_type: 'offer',
                earn_up_to: 300,
              },
            ],
          },
        };
      }
      if (url.includes('/survey-api.php')) {
        return {
          body: {
            status: '200',
            data: [
              {
                id: 's1',
                title: 'Share your shopping habits',
                reward: '220.00',
                link: 'https://bitcotasks.com/track/survey',
                cpa_type: 'survey',
              },
            ],
          },
        };
      }
      if (url.includes('/sl-api/')) {
        return {
          body: {
            status: '200',
            data: [
              { id: '88', title: 'earnow.online', reward: '600.00', available: '2', url: 'https://bitcotasks.com/start/sl' },
            ],
          },
        };
      }
      if (url.includes('/api/')) {
        return {
          body: {
            status: '200',
            data: [
              {
                id: '8098',
                title: 'Free spin',
                reward: '600.00',
                duration: '30',
                url: 'https://bitcotasks.com/view/ptc',
                ad_type: 'Iframe',
              },
            ],
          },
        };
      }
      return { body: { status: '404', data: [] } };
    });

    const campaigns = await fetchBitcoTasksFeed(CFG, '7', '8.8.8.8');
    const byKey = Object.fromEntries(campaigns.map((c) => [c.key, c]));

    expect(byKey['offer:42fade91']).toMatchObject({
      type: 'offer',
      title: 'Download and try this app',
      reward_cents: 150,
      url: 'https://bitcotasks.com/track/abc',
      image: 'https://bitcotasks.com/uploads/offerwall/2201.jpeg',
    });
    expect(byKey['offer:s1']).toMatchObject({ type: 'offer', reward_cents: 220 });
    expect(byKey['shortlink:88']).toMatchObject({ type: 'shortlink', reward_cents: 600 });
    expect(byKey['ptc:8098']).toMatchObject({
      type: 'ptc',
      reward_cents: 600,
      duration: 30,
      url: 'https://bitcotasks.com/view/ptc',
    });

    const urls = spy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.startsWith('https://bitcotasks.com/offer-api.php?key=KEY123&sub_id=7&ip=8.8.8.8'))).toBe(true);
    expect(urls.some((u) => u === 'https://bitcotasks.com/api/KEY123/7/8.8.8.8')).toBe(true);
    expect(urls.some((u) => u === 'https://bitcotasks.com/sl-api/KEY123/7/8.8.8.8')).toBe(true);
  });

  it('sends the bearer token header and ignores non-200 status', async () => {
    const spy = mockFetch(() => ({ body: { status: '403', message: 'Offerwall is not valid or not active' } }));
    const campaigns = await fetchBitcoTasksFeed(CFG, '1', '1.1.1.1');
    expect(campaigns).toEqual([]);
    const init = spy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer BEARER789');
  });

  it('survives a thrown network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );
    await expect(fetchBitcoTasksFeed(CFG, '1', '1.1.1.1')).resolves.toEqual([]);
  });
});
