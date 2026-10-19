const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 2000;
const cache = new Map<string, { at: number; country: string | null }>();

function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  if (ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (ip.startsWith('169.254.') || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) return true;
  const second = ip.match(/^172\.(\d+)\./);
  if (second && Number(second[1]) >= 16 && Number(second[1]) <= 31) return true;
  return false;
}

const ISO2 = /^[A-Z]{2}$/;

async function lookup(url: string, pick: (json: unknown) => string | undefined): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return undefined;
    const code = pick(await res.json());
    return code && ISO2.test(code.toUpperCase()) ? code.toUpperCase() : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export async function countryForIp(ip: string): Promise<string | null> {
  if (isPrivateIp(ip)) return null;
  const hit = cache.get(ip);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.country;

  const encoded = encodeURIComponent(ip);
  let country =
    (await lookup(`https://ipwho.is/${encoded}`, (j) => {
      const o = j as { success?: boolean; country_code?: string };
      return o.success === false ? undefined : o.country_code;
    })) ?? null;

  if (!country) {
    country =
      (await lookup(`http://ip-api.com/json/${encoded}?fields=countryCode`, (j) => {
        const o = j as { countryCode?: string };
        return o.countryCode;
      })) ?? null;
  }

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(ip, { at: Date.now(), country });
  return country;
}
