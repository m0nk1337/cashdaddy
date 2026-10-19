import dotenv from 'dotenv';

dotenv.config();

function list(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Supports a single DATABASE_URL (e.g. Neon, Supabase) which overrides DB_* vars.
function fromDatabaseUrl(url: string | undefined) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : 5432,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ''),
    };
  } catch {
    return null;
  }
}

const dbUrl = fromDatabaseUrl(process.env.DATABASE_URL);
// Managed Postgres (Neon etc.) requires TLS; opt out with DB_SSL=false for local URL use.
const dbSsl =
  process.env.DB_SSL === 'false'
    ? undefined
    : process.env.DB_SSL === 'true' || Boolean(process.env.DATABASE_URL)
      ? { rejectUnauthorized: false }
      : undefined;

export const config = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: '7d',
  db: {
    host: dbUrl?.host || process.env.DB_HOST || 'localhost',
    port: dbUrl?.port || Number(process.env.DB_PORT) || 5432,
    user: dbUrl?.user || process.env.DB_USER || 'gpt',
    password: dbUrl?.password || process.env.DB_PASSWORD || 'gpt_secret',
    database: dbUrl?.database || process.env.DB_NAME || 'gptsite',
    ssl: dbSsl,
  },
  minWithdrawCents: 500,
  maxPostbackCents: Number(process.env.MAX_POSTBACK_CENTS) || 10000,
  maxAccountsPerIp: Number(process.env.MAX_ACCOUNTS_PER_IP) || 3,
  authRateLimit: Number(process.env.AUTH_RATE_LIMIT) || 30,
  referralRate: Number(process.env.REFERRAL_RATE) || 0.1,
  referralSignupBonusCents: Number(process.env.REFERRAL_SIGNUP_BONUS_CENTS) || 25,
  trustProxy: process.env.TRUST_PROXY === 'true',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
  email: {
    mode: process.env.EMAIL_MODE || 'log',
    from: process.env.EMAIL_FROM || 'CashDash <no-reply@cashdash.test>',
    smtp: {
      host: process.env.SMTP_HOST || '',
      port: Number(process.env.SMTP_PORT) || 587,
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  },
  adgateIps: list(process.env.ADGATE_IPS),
};
