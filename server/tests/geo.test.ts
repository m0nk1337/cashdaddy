import { afterEach, describe, expect, it, vi } from 'vitest';
import { countryForIp } from '../src/geo';

function stubFetch(handler: (url: string) => { status?: number; body: unknown }) {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const { status = 200, body } = handler(String(input));
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe('countryForIp', () => {
  it('does not look up private or loopback addresses', async () => {
    const spy = stubFetch(() => ({ body: {} }));
    expect(await countryForIp('10.0.0.5')).toBeNull();
    expect(await countryForIp('192.168.1.1')).toBeNull();
    expect(await countryForIp('172.20.0.1')).toBeNull();
    expect(await countryForIp('::1')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('resolves a country from ipwho.is', async () => {
    stubFetch(() => ({ body: { success: true, country_code: 'gb' } }));
    expect(await countryForIp('203.0.113.10')).toBe('GB');
  });

  it('falls back to ip-api.com when the first provider fails', async () => {
    stubFetch((url) =>
      url.includes('ipwho.is') ? { status: 500, body: {} } : { body: { countryCode: 'DE' } }
    );
    expect(await countryForIp('203.0.113.11')).toBe('DE');
  });

  it('returns null when every provider fails', async () => {
    stubFetch(() => ({ status: 500, body: {} }));
    expect(await countryForIp('203.0.113.12')).toBeNull();
  });

  it('caches results per address', async () => {
    const spy = stubFetch(() => ({ body: { success: true, country_code: 'FR' } }));
    await countryForIp('203.0.113.13');
    const calls = spy.mock.calls.length;
    await countryForIp('203.0.113.13');
    expect(spy.mock.calls.length).toBe(calls);
  });
});
