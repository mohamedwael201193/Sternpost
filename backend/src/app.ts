import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import type { Db } from "./db/pool.js";
import { rateLimit } from "./middleware/rateLimit.js";
import { appsRoutes } from "./routes/apps.js";
import { policiesRoutes } from "./routes/policies.js";
import { activityRoutes } from "./routes/activity.js";
import { receiptsRoutes } from "./routes/receipts.js";
import { demoRoutes, type ChainSnapshot } from "./routes/demo.js";
import type { PaywallOpts } from "./x402/paywall.js";
import { logger } from "./logger.js";

export interface AppDeps {
  db: Db;
  corsOrigins: string[];
  rateLimitPerMin: number;
  pay: Omit<PaywallOpts, "description">;
  snapshot: () => Promise<ChainSnapshot>;
  version?: string;
}

const originAllowed = (origin: string, list: string[]) =>
  list.some((o) => (o.startsWith("*.") ? origin.endsWith(o.slice(1)) && origin.startsWith("https://") : o === origin));

export function createApp(d: AppDeps) {
  const app = new Hono();
  app.use("*", secureHeaders());
  app.use("*", cors({
    origin: (origin) => (origin && originAllowed(origin, d.corsOrigins) ? origin : null),
    allowHeaders: ["content-type", "payment-signature", "x-payment"],
    exposeHeaders: ["payment-required", "payment-response"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "OPTIONS"],
  }));
  app.use("*", bodyLimit({ maxSize: 32 * 1024 }));
  app.use("*", async (c, next) => {
    const t = Date.now();
    await next();
    logger.info({ method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - t }, "request");
  });
  app.use("/v1/*", rateLimit(d.rateLimitPerMin));

  app.get("/", (c) => c.json({ name: "sternpost-api", docs: "https://github.com/mohamedwael201193/Sternpost/tree/main/backend" }));
  app.get("/health", async (c) => {
    let db = "ok";
    try { await d.db.query("SELECT 1"); } catch { db = "down"; }
    const s = await d.snapshot().catch(() => null);
    const ok = db === "ok";
    return c.json({ status: ok ? "ok" : "degraded", db, chain: s ? { block: String(s.blockNumber) } : "unreachable", version: d.version ?? "dev" }, ok ? 200 : 503);
  });

  app.route("/v1", appsRoutes(d.db));
  app.route("/v1", policiesRoutes(d.db));
  app.route("/v1", activityRoutes(d.db));
  app.route("/v1", receiptsRoutes(d.db));
  app.route("/v1", demoRoutes(d.db, d.pay, d.snapshot));

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    logger.error({ err: String(err), path: c.req.path }, "unhandled");
    return c.json({ error: "internal_error" }, 500);
  });
  return app;
}
