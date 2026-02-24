import type { Context, Next, MiddlewareHandler } from "hono";

interface BucketEntry {
  tokens: number;
  lastRefill: number;
}

interface RateLimitOptions {
  /** Max requests in the window */
  limit: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Key extractor — defaults to IP-based. Return null to skip limiting. */
  keyFn?: (c: Context) => string | null;
}

/**
 * Simple in-memory token bucket rate limiter for Hono.
 * Returns 429 Too Many Requests when limit exceeded.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const buckets = new Map<string, BucketEntry>();
  const { limit, windowMs, keyFn } = opts;

  // Periodically prune stale entries to prevent memory leak
  const PRUNE_INTERVAL = 5 * 60_000; // 5 minutes
  let lastPrune = Date.now();

  function prune(now: number) {
    if (now - lastPrune < PRUNE_INTERVAL) return;
    lastPrune = now;
    for (const [key, entry] of buckets) {
      if (now - entry.lastRefill > windowMs * 2) {
        buckets.delete(key);
      }
    }
  }

  return async (c: Context, next: Next) => {
    const key = keyFn ? keyFn(c) : getClientIp(c);
    if (key === null) {
      await next();
      return;
    }

    const now = Date.now();
    prune(now);

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: limit, lastRefill: now };
      buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    const refill = Math.floor((elapsed / windowMs) * limit);
    if (refill > 0) {
      bucket.tokens = Math.min(limit, bucket.tokens + refill);
      bucket.lastRefill = now;
    }

    if (bucket.tokens <= 0) {
      c.header("Retry-After", String(Math.ceil(windowMs / 1000)));
      return c.json({ error: "Too many requests" }, 429);
    }

    bucket.tokens -= 1;
    await next();
  };
}

function getClientIp(c: Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown"
  );
}
