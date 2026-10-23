import type { MiddlewareHandler } from "hono";

/** Fixed-window in-memory limiter keyed by client IP. Good enough for a single free-tier instance. */
export function rateLimit(limit: number, windowMs = 60_000, now = () => Date.now()): MiddlewareHandler {
  const hits = new Map<string, { count: number; reset: number }>();
  return async (c, next) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const t = now();
    let e = hits.get(ip);
    if (!e || e.reset <= t) {
      e = { count: 0, reset: t + windowMs };
      hits.set(ip, e);
    }
    e.count++;
    c.header("RateLimit-Limit", String(limit));
    c.header("RateLimit-Remaining", String(Math.max(0, limit - e.count)));
    if (e.count > limit) {
      c.header("Retry-After", String(Math.ceil((e.reset - t) / 1000)));
      return c.json({ error: "rate_limited" }, 429);
    }
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
    await next();
  };
}
