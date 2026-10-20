import type { FeedCampaign } from './offerwallme';

const BASE = 'https://bitcotasks.com';

export interface BitcoTasksConfig {
  apiKey: string;
  secret: string;
  bearer: string;
}

export function isBitcoTasksFeed(cfg: Record<string, unknown> | null): boolean {
  if (!cfg) return false;
  return (
    cfg.signing === 'bitcotasks' &&
    typeof cfg.api_key === 'string' &&
    cfg.api_key.length > 0
  );
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function rewardCents(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount);
}

function imageOf(row: Record<string, unknown>): string | undefined {
  const img = str(row.image) || str(row.icon) || str(row.cover);
  return img.startsWith('https://') ? img : undefined;
}

function goalsText(row: Record<string, unknown>): string {
  const goals = Array.isArray(row.goals) ? row.goals : [];
  return goals
    .map((g) => stripHtml(str((g as Record<string, unknown>).name)))
    .filter((t) => t.length > 0)
    .join(' · ');
}

// Offer API: CPA offers with goals + earn_up_to.
function mapOffers(rows: unknown[]): FeedCampaign[] {
  return rows.map((raw, i) => {
    const row = raw as Record<string, unknown>;
    const id = str(row.id) || String(i);
    const description =
      str(row.description) || stripHtml(str(row.requirements)) || goalsText(row);
    return {
      key: `offer:${id}`,
      type: 'offer' as const,
      id,
      title: str(row.title) || 'Offer',
      description,
      image: imageOf(row),
      reward_cents: rewardCents(row.reward),
      countries: [],
      url: str(row.link) || undefined,
    };
  });
}

// Survey API: same shape as offers, cpa_type survey.
function mapSurveys(rows: unknown[]): FeedCampaign[] {
  return mapOffers(rows);
}

// PTC API: path-segment URL, items carry `hash`, `duration`, `url`, `ad_type`.
function mapPtc(rows: unknown[]): FeedCampaign[] {
  return rows.map((raw, i) => {
    const row = raw as Record<string, unknown>;
    const id = str(row.id) || str(row.hash) || String(i);
    return {
      key: `ptc:${id}`,
      type: 'ptc' as const,
      id,
      title: str(row.title) || 'Watch ad',
      description: str(row.description),
      image: imageOf(row),
      reward_cents: rewardCents(row.reward),
      countries: [],
      url: str(row.url) || undefined,
      duration: Number(row.duration) || undefined,
    };
  });
}

// Shortlink API: items carry `available`/`limit` + `url`.
function mapShortlinks(rows: unknown[]): FeedCampaign[] {
  return rows.map((raw, i) => {
    const row = raw as Record<string, unknown>;
    const id = str(row.id) || String(i);
    return {
      key: `shortlink:${id}`,
      type: 'shortlink' as const,
      id,
      title: str(row.title) || 'Shortlink',
      description: '',
      reward_cents: rewardCents(row.reward),
      countries: [],
      url: str(row.url) || undefined,
      remaining: Number(row.available) || undefined,
    };
  });
}

// Task API (SDK category 'tasks'): items carry `instructions` + `requirement`.
function mapTasks(rows: unknown[]): FeedCampaign[] {
  return rows.map((raw, i) => {
    const row = raw as Record<string, unknown>;
    const id = str(row.id) || String(i);
    return {
      key: `task:${id}`,
      type: 'task' as const,
      id,
      title: str(row.title) || 'Task',
      description: stripHtml(str(row.instructions)),
      instructions: stripHtml(str(row.instructions)),
      reward_cents: rewardCents(row.reward),
      countries: [],
      proof_type: str(row.requirement) || undefined,
    };
  });
}

interface Source {
  type: FeedCampaign['type'];
  url: (cfg: BitcoTasksConfig, userId: string, ip: string) => string;
  map: (rows: unknown[]) => FeedCampaign[];
}

const SOURCES: Source[] = [
  {
    type: 'offer',
    url: (cfg, u, ip) =>
      `${BASE}/offer-api.php?${new URLSearchParams({ key: cfg.apiKey, sub_id: u, ip })}`,
    map: mapOffers,
  },
  {
    type: 'offer',
    url: (cfg, u, ip) =>
      `${BASE}/survey-api.php?${new URLSearchParams({ key: cfg.apiKey, sub_id: u, ip })}`,
    map: mapSurveys,
  },
  { type: 'ptc', url: (cfg, u, ip) => `${BASE}/api/${cfg.apiKey}/${u}/${ip}`, map: mapPtc },
  { type: 'shortlink', url: (cfg, u, ip) => `${BASE}/sl-api/${cfg.apiKey}/${u}/${ip}`, map: mapShortlinks },
];

async function fetchSource(
  source: Source,
  cfg: BitcoTasksConfig,
  userId: string,
  ip: string
): Promise<FeedCampaign[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(source.url(cfg, userId, ip), {
      headers: { Authorization: `Bearer ${cfg.bearer}` },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { status?: unknown; data?: unknown };
    if (String(json?.status) !== '200' || !Array.isArray(json.data)) return [];
    return source.map(json.data);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; campaigns: FeedCampaign[] }>();

export async function fetchBitcoTasksFeed(
  cfg: BitcoTasksConfig,
  userId: string,
  ip: string
): Promise<FeedCampaign[]> {
  const cacheKey = `${cfg.apiKey}:${userId}:${ip}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.campaigns;

  const results = await Promise.all(SOURCES.map((s) => fetchSource(s, cfg, userId, ip)));
  const campaigns = results.flat();

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(cacheKey, { at: Date.now(), campaigns });
  return campaigns;
}
