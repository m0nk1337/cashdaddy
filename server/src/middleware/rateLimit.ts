import { Request, Response, NextFunction } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

export function rateLimit(options: {
  windowMs: number;
  max: number;
  name?: string;
}) {
  const buckets = new Map<string, Bucket>();
  const name = options.name || 'default';

  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, options.windowMs).unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = (req.ip || 'unknown').replace('::ffff:', '');
    const key = `${name}:${ip}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > options.max) {
      res.status(429).json({ error: 'Too many requests, slow down' });
      return;
    }
    next();
  };
}
