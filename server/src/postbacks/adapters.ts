import crypto from 'crypto';

export interface ParsedPostback {
  userId: string;
  txnId: string;
  rewardCents: number;
  action: 'credit' | 'reverse' | 'ignore';
  title?: string;
}

export type ParseResult = { ok: true; value: ParsedPostback } | { ok: false; error: string };

export interface AdapterContext {
  params: Record<string, string>;
  rawUrl: string;
  secret: string | null;
  wallConfig: Record<string, string>;
  clientIp: string;
  allowedIps: string[];
}

export interface PostbackAdapter {
  validate(ctx: AdapterContext): { valid: boolean; reason?: string };
  parse(ctx: AdapterContext): ParseResult;
}

export type PostbackParams = Record<string, string>;

export function normalizeParams(input: Record<string, unknown>): PostbackParams {
  const out: PostbackParams = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') out[key] = value;
    else if (Array.isArray(value) && typeof value[0] === 'string') out[key] = value[0];
  }
  return out;
}

function pick(ctx: AdapterContext, ...names: string[]): string | undefined {
  for (const name of names) {
    if (ctx.params[name] !== undefined && ctx.params[name] !== '') return ctx.params[name];
  }
  return undefined;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function usdToCents(value: string | undefined): number | null {
  if (value === undefined) return null;
  const usd = Number(value);
  if (!Number.isFinite(usd) || usd < 0) return null;
  return Math.round(usd * 100);
}

function toCents(value: string | undefined): number | null {
  if (value === undefined) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount);
}

// AdGate Media: no request signature; security = IP whitelist + optional static secret param.
const adgate: PostbackAdapter = {
  validate(ctx) {
    if (ctx.allowedIps.length > 0 && !ctx.allowedIps.includes(ctx.clientIp)) {
      return { valid: false, reason: `IP ${ctx.clientIp} not in AdGate whitelist` };
    }
    if (ctx.secret) {
      const provided = pick(ctx, 'secret', ctx.wallConfig.secretParam || 'secret');
      if (!provided || !safeEqual(provided, ctx.secret)) {
        return { valid: false, reason: 'missing or invalid secret param' };
      }
    }
    return { valid: true };
  },
  parse(ctx) {
    const userId = pick(ctx, ctx.wallConfig.userParam || 'user_id', 's1');
    const txnId = pick(ctx, ctx.wallConfig.txnParam || 'conversion_id', 'tx_id');
    if (!userId || !txnId) return { ok: false, error: 'missing user_id or conversion_id' };

    const state = (
      pick(ctx, ctx.wallConfig.stateParam || 'state', 'status') ||
      'approved'
    ).toLowerCase();
    if (state === 'pending') return { ok: true, value: { userId, txnId, rewardCents: 0, action: 'ignore' } };
    if (state === 'rejected' || state === '0') {
      const original = toCents(pick(ctx, ctx.wallConfig.pointsParam || 'point_value', 'points'));
      return {
        ok: true,
        value: { userId, txnId, rewardCents: original ?? 0, action: 'reverse' },
      };
    }

    const rewardCents =
      toCents(pick(ctx, ctx.wallConfig.pointsParam || 'point_value', 'points')) ??
      usdToCents(pick(ctx, ctx.wallConfig.usdParam || 'usd_value', 'payout')) ??
      0;
    return {
      ok: true,
      value: {
        userId,
        txnId,
        rewardCents,
        action: 'credit',
        title: pick(ctx, 'offer_title', 'vc_title', 'offer_name'),
      },
    };
  },
};

// CPX Research: hash = md5(trans_id + secure_hash) or md5(user_id + secure_hash).
const cpx: PostbackAdapter = {
  validate(ctx) {
    if (!ctx.secret) return { valid: false, reason: 'postback secret not configured' };
    const provided = pick(ctx, ctx.wallConfig.hashParam || 'hash', 'secure_hash');
    const txnId = pick(ctx, ctx.wallConfig.txnParam || 'trans_id');
    const userId = pick(ctx, ctx.wallConfig.userParam || 'user_id');
    if (!provided) return { valid: false, reason: 'missing hash' };
    const candidates = [txnId, userId].filter(Boolean).map((v) => crypto.createHash('md5').update(v! + ctx.secret).digest('hex'));
    if (!candidates.some((c) => safeEqual(c, provided))) {
      return { valid: false, reason: 'hash mismatch' };
    }
    return { valid: true };
  },
  parse(ctx) {
    const userId = pick(ctx, ctx.wallConfig.userParam || 'user_id');
    const txnId = pick(ctx, ctx.wallConfig.txnParam || 'trans_id');
    if (!userId || !txnId) return { ok: false, error: 'missing user_id or trans_id' };

    const status = pick(ctx, ctx.wallConfig.statusParam || 'status') ?? '1';
    const amount =
      toCents(pick(ctx, ctx.wallConfig.amountParam || 'amount_local')) ??
      usdToCents(pick(ctx, ctx.wallConfig.usdParam || 'amount_usd')) ??
      0;

    if (status === '2') {
      return { ok: true, value: { userId, txnId, rewardCents: amount, action: 'reverse' } };
    }
    if (status !== '1') {
      return { ok: true, value: { userId, txnId, rewardCents: 0, action: 'ignore' } };
    }
    return { ok: true, value: { userId, txnId, rewardCents: amount, action: 'credit' } };
  },
};

// BitLabs: &hash= HMAC-SHA1 hex over the full callback URL (without the hash part), keyed with app secret.
const bitlabs: PostbackAdapter = {
  validate(ctx) {
    if (!ctx.secret) return { valid: false, reason: 'postback secret not configured' };
    const marker = '&hash=';
    const idx = ctx.rawUrl.lastIndexOf(marker);
    if (idx === -1) return { valid: false, reason: 'missing hash' };
    const provided = ctx.rawUrl.slice(idx + marker.length);
    const base = ctx.rawUrl.slice(0, idx);
    const expected = crypto.createHmac('sha1', ctx.secret).update(base).digest('hex');
    if (!safeEqual(expected, provided)) return { valid: false, reason: 'hash mismatch' };
    return { valid: true };
  },
  parse(ctx) {
    const userId = pick(ctx, ctx.wallConfig.userParam || 'uid', 'user_id');
    const txnId = pick(ctx, ctx.wallConfig.txnParam || 'tx', 'transaction_id');
    if (!userId || !txnId) return { ok: false, error: 'missing uid or tx' };

    const type = (pick(ctx, 'type', 'offer_state') || '').toUpperCase();
    if (type === 'RECONCILIATION' || type === 'RECONCILED') {
      const amount = toCents(pick(ctx, ctx.wallConfig.amountParam || 'val')) ?? 0;
      return { ok: true, value: { userId, txnId, rewardCents: amount, action: 'reverse' } };
    }
    if (type === 'SCREENOUT') {
      return { ok: true, value: { userId, txnId, rewardCents: 0, action: 'ignore' } };
    }

    const amount =
      toCents(pick(ctx, ctx.wallConfig.amountParam || 'val', 'value')) ??
      usdToCents(pick(ctx, ctx.wallConfig.usdParam || 'raw', 'value_usd')) ??
      0;
    return { ok: true, value: { userId, txnId, rewardCents: amount, action: 'credit' } };
  },
};

// Generic: sig = HMAC-SHA256 hex over `${user}:${tx}:${amount}:${action}` keyed with wall secret.
const generic: PostbackAdapter = {
  validate(ctx) {
    if (!ctx.secret) return { valid: false, reason: 'postback secret not configured' };
    const provided = pick(ctx, 'sig', 'signature');
    if (!provided) return { valid: false, reason: 'missing sig' };
    const user = pick(ctx, ctx.wallConfig.userParam || 'user') || '';
    const tx = pick(ctx, ctx.wallConfig.txnParam || 'tx') || '';
    const amount = pick(ctx, ctx.wallConfig.amountParam || 'amount') || '0';
    const action = pick(ctx, ctx.wallConfig.actionParam || 'action') || 'credit';
    const expected = crypto
      .createHmac('sha256', ctx.secret)
      .update(`${user}:${tx}:${amount}:${action}`)
      .digest('hex');
    if (!safeEqual(expected, provided)) return { valid: false, reason: 'sig mismatch' };
    return { valid: true };
  },
  parse(ctx) {
    const userId = pick(ctx, ctx.wallConfig.userParam || 'user');
    const txnId = pick(ctx, ctx.wallConfig.txnParam || 'tx');
    if (!userId || !txnId) return { ok: false, error: 'missing user or tx' };
    const amount = toCents(pick(ctx, ctx.wallConfig.amountParam || 'amount')) ?? 0;
    const actionRaw = (pick(ctx, ctx.wallConfig.actionParam || 'action') || 'credit').toLowerCase();
    const action = actionRaw === 'reverse' ? 'reverse' : 'credit';
    return { ok: true, value: { userId, txnId, rewardCents: amount, action } };
  },
};

// Offerwall.me: signature = md5(subId + transId + reward + secret) over the raw params.
// reward is in publisher currency units (configure placement to 100 units = $1.00 USD = 100 cents).
const offerwallme: PostbackAdapter = {
  validate(ctx) {
    if (!ctx.secret) return { valid: false, reason: 'postback secret not configured' };
    const provided = pick(ctx, 'signature');
    if (!provided) return { valid: false, reason: 'missing signature' };
    const subId = pick(ctx, 'subId') || '';
    const transId = pick(ctx, 'transId') || '';
    const reward = pick(ctx, 'reward') || '';
    const expected = crypto.createHash('md5').update(subId + transId + reward + ctx.secret).digest('hex');
    if (!safeEqual(expected, provided)) return { valid: false, reason: 'signature mismatch' };
    return { valid: true };
  },
  parse(ctx) {
    const userId = pick(ctx, 'subId');
    const txnId = pick(ctx, 'transId');
    if (!userId || !txnId) return { ok: false, error: 'missing subId or transId' };

    const amount = toCents(pick(ctx, 'reward')) ?? 0;
    const status = pick(ctx, 'status') ?? '1';
    const title = pick(ctx, 'offer_name');

    if (status === '2') {
      return { ok: true, value: { userId, txnId, rewardCents: amount, action: 'reverse', title } };
    }
    if (status !== '1') {
      return { ok: true, value: { userId, txnId, rewardCents: 0, action: 'ignore', title } };
    }
    return { ok: true, value: { userId, txnId, rewardCents: amount, action: 'credit', title } };
  },
};

export const adapters: Record<string, PostbackAdapter> = {
  adgate,
  cpx,
  bitlabs,
  offerwallme,
  generic,
};

export function getAdapter(slug: string, wallConfig: Record<string, string>): PostbackAdapter {
  const name = wallConfig.adapter && adapters[wallConfig.adapter] ? wallConfig.adapter : slug;
  return adapters[name] ?? generic;
}
