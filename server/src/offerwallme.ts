import crypto from 'crypto';

const BASE = 'https://offerwall.me';
const IDENTITY_VERSION = 'offerwall-user-v1';

export interface OfferwallMeConfig {
  publicKey: string;
  secret: string;
  bearer: string;
}

export interface FeedCampaign {
  key: string;
  type: 'offer' | 'ptc' | 'shortlink' | 'task';
  id: string;
  title: string;
  description: string;
  instructions?: string;
  image?: string;
  reward_cents: number;
  payout?: string;
  countries: string[];
  devices?: string[];
  url?: string;
  duration?: number;
  remaining?: number;
  proof_type?: string;
  proof_text?: string;
}

export function signUserIdentity(
  publicKey: string,
  secret: string,
  userId: string,
  ttlSeconds = 3600
): { expires: string; signature: string } {
  const expires = String(Math.floor(Date.now() / 1000) + ttlSeconds);
  const message = `${IDENTITY_VERSION}\n${publicKey}\n${userId}\n${expires}`;
  const signature = crypto.createHmac('sha256', secret).update(message).digest('hex');
  return { expires, signature };
}

function toCents(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => str(v)).filter((v) => v.length > 0);
}

function imageOf(row: Record<string, unknown>): string | undefined {
  const img = str(row.image) || str(row.icon) || str(row.cover);
  return img.startsWith('https://') ? img : undefined;
}

function mapOffers(rows: unknown[]): FeedCampaign[] {
  return rows.map((raw, i) => {
    const row = raw as Record<string, unknown>;
    const steps = Array.isArray(row.steps) ? row.steps : [];
    const firstStep = (steps[0] as Record<string, unknown> | undefined) ?? undefined;
    const label = firstStep ? str(firstStep.label) : '';
    return {
      key: `offer:${str(row.id) || i}`,
      type: 'offer' as const,
      id: str(row.id) || String(i),
      title: str(row.title) || str(row.name),
      description: str(row.description) || label,
      image: imageOf(row),
      reward_cents: toCents(row.reward),
      payout: str(row.payout) || undefined,
      countries: strArray(row.countries),
      devices: strArray(row.devices),
      url: str(row.url) || undefined,
    };
  });
}

function mapPtc(rows: unknown[]): FeedCampaign[] {
  return rows.map((raw, i) => {
    const row = raw as Record<string, unknown>;
    return {
      key: `ptc:${i}`,
      type: 'ptc' as const,
      id: String(i),
      title: str(row.title) || str(row.description) || 'Paid ad',
      description: str(row.description),
      image: imageOf(row),
      reward_cents: toCents(row.reward),
      countries: strArray(row.countries),
      url: str(row.url) || undefined,
      duration: Number.isFinite(Number(row.duration)) ? Number(row.duration) : undefined,
    };
  });
}

function mapShortlinks(rows: unknown[]): FeedCampaign[] {
  return rows.map((raw, i) => {
    const row = raw as Record<string, unknown>;
    const remaining = Number(row.remaining_views);
    return {
      key: `shortlink:${str(row.id) || i}`,
      type: 'shortlink' as const,
      id: str(row.id) || String(i),
      title: str(row.name) || str(row.shortlink),
      description: str(row.shortlink) ? `${str(row.shortlink)} — open and complete the shortlink.` : '',
      reward_cents: toCents(row.reward),
      countries: strArray(row.countries),
      url: str(row.url) || undefined,
      remaining: Number.isFinite(remaining) ? remaining : undefined,
    };
  });
}

function mapTasks(rows: unknown[]): FeedCampaign[] {
  return rows.map((raw, i) => {
    const row = raw as Record<string, unknown>;
    return {
      key: `task:${str(row.id) || i}`,
      type: 'task' as const,
      id: str(row.id) || String(i),
      title: str(row.title),
      description: str(row.description),
      instructions: str(row.instructions) || undefined,
      image: imageOf(row),
      reward_cents: toCents(row.reward),
      countries: strArray(row.countries),
      url: str(row.url) || undefined,
      proof_type: str(row.proof_type) || undefined,
      proof_text: str(row.proof_text) || undefined,
    };
  });
}

const ENDPOINTS: { type: FeedCampaign['type']; path: string; map: (rows: unknown[]) => FeedCampaign[] }[] = [
  { type: 'offer', path: '/offerapi.php', map: mapOffers },
  { type: 'ptc', path: '/api.php', map: mapPtc },
  { type: 'shortlink', path: '/slapi.php', map: mapShortlinks },
  { type: 'task', path: '/taskapi.php', map: mapTasks },
];

export function buildFeedQuery(
  cfg: OfferwallMeConfig,
  userId: string,
  ip: string,
  country: string
): string {
  const { expires, signature } = signUserIdentity(cfg.publicKey, cfg.secret, userId);
  const params = new URLSearchParams({
    api: cfg.publicKey,
    id: userId,
    ip,
    token: cfg.bearer,
    country,
    identityExpires: expires,
    identitySignature: signature,
  });
  return params.toString();
}

const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; campaigns: FeedCampaign[] }>();

async function fetchModule(
  path: string,
  map: (rows: unknown[]) => FeedCampaign[],
  query: string
): Promise<FeedCampaign[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${BASE}${path}?${query}`, { signal: controller.signal });
    if (!res.ok) return [];
    const json = (await res.json()) as { status?: number; data?: unknown };
    if (!json || json.status !== 200 || !Array.isArray(json.data)) return [];
    return map(json.data);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchFeed(
  cfg: OfferwallMeConfig,
  userId: string,
  ip: string,
  country: string
): Promise<FeedCampaign[]> {
  const cacheKey = `${cfg.publicKey}:${userId}:${country}:${ip}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.campaigns;

  const query = buildFeedQuery(cfg, userId, ip, country);
  const groups = await Promise.all(ENDPOINTS.map((e) => fetchModule(e.path, e.map, query)));
  const campaigns = groups.flat();

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(cacheKey, { at: Date.now(), campaigns });
  return campaigns;
}

export interface TaskSubmitInput {
  publicKey: string;
  secret: string;
  bearer: string;
  userId: string;
  ip: string;
  country: string;
  taskId: string;
  proof?: string;
  image?: { base64: string; mime: string };
}

export interface TaskSubmitResult {
  ok: boolean;
  status?: string;
  error?: string;
}

export async function submitTask(input: TaskSubmitInput): Promise<TaskSubmitResult> {
  const { expires, signature } = signUserIdentity(input.publicKey, input.secret, input.userId);
  const common = {
    api: input.publicKey,
    token: input.bearer,
    id: input.userId,
    identityExpires: expires,
    identitySignature: signature,
    country: input.country,
    task_id: input.taskId,
    ip: input.ip,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    let res: globalThis.Response;
    if (input.image) {
      const form = new FormData();
      for (const [k, v] of Object.entries(common)) form.append(k, v);
      if (input.proof !== undefined) form.append('proof', input.proof);
      const bytes = Buffer.from(input.image.base64, 'base64');
      form.append('proofImage', new Blob([bytes], { type: input.image.mime }), 'proof');
      res = await fetch(`${BASE}/tasksubmit.php`, { method: 'POST', body: form, signal: controller.signal });
    } else {
      res = await fetch(`${BASE}/tasksubmit.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...common, proof: input.proof ?? '' }),
        signal: controller.signal,
      });
    }
    const json = (await res.json().catch(() => null)) as
      | { status?: number; message?: string; data?: { status?: string }; error?: string }
      | null;
    if (!json) return { ok: false, error: `Task submit failed (HTTP ${res.status})` };
    if (json.error || (json.status !== undefined && json.status >= 400)) {
      return { ok: false, error: json.error || json.message || 'Task submission rejected' };
    }
    const status = json.data?.status || json.message || 'Pending';
    return { ok: true, status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Task submission failed' };
  } finally {
    clearTimeout(timeout);
  }
}

export function isOfferwallMeFeed(cfg: Record<string, unknown> | null): boolean {
  if (!cfg) return false;
  return cfg.signing === 'offerwallme' && typeof cfg.public_key === 'string' && cfg.public_key.length > 0;
}
