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
import { relayRoutes } from "./routes/relay.js";
import { musterRoutes, type MusterOpts } from "./routes/muster.js";
import { sessionRequestRoutes, type SessionRequestOpts } from "./routes/requests.js";
import type { RelayerDeps } from "./relayer/relayer.js";
import type { PaywallOpts } from "./x402/paywall.js";
import type { Indexer } from "./indexer/indexer.js";
import { HTTPException } from "hono/http-exception";
import { logger } from "./logger.js";
import { telegramRoutes, type TelegramRouteOpts } from "./routes/telegram.js";

export interface AppDeps {
  db: Db;
  corsOrigins: string[];
  rateLimitPerMin: number;
  pay: Omit<PaywallOpts, "description">;
  snapshot: () => Promise<ChainSnapshot>;
  version?: string;
  indexer?: Pick<Indexer, "tick">;
  telegram?: TelegramRouteOpts;
  /** POST /v1/relay/draw deps (task 2.4). Absent in tests that do not mount the relayer. */
  relayer?: RelayerDeps;
  /** GET /v1/muster opts (task 2.6). */
  muster?: MusterOpts;
  /** POST /v1/session-requests opts (task 5.2). */
  sessionRequests?: SessionRequestOpts;
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

  // Catch-up sync for serverless deployments where no background loop runs. Throttled to one run per 10s.
  let lastSync = 0;
  app.post("/v1/indexer/sync", async (c) => {
    if (!d.indexer) return c.json({ error: "indexer_disabled" }, 404);
    if (Date.now() - lastSync < 10_000) return c.json({ status: "throttled" }, 429);
    lastSync = Date.now();
    let stored = 0;
    for (let i = 0; i < 5; i++) stored += await d.indexer.tick();
    return c.json({ status: "ok", stored });
  });

  app.route("/v1", appsRoutes(d.db, d.telegram?.bot.notifyRequest));
  if (d.telegram) app.route("/", telegramRoutes(d.telegram));
  app.route("/v1", policiesRoutes(d.db));
  app.route("/v1", activityRoutes(d.db));
  app.route("/v1", receiptsRoutes(d.db));
  app.route("/v1", demoRoutes(d.db, d.pay, d.snapshot));
  if (d.relayer) app.route("/v1", relayRoutes(d.relayer));
  if (d.muster) app.route("/v1", musterRoutes(d.db, d.muster));
  if (d.sessionRequests) app.route("/v1", sessionRequestRoutes(d.db, d.sessionRequests));

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.status === 413 ? "payload_too_large" : "http_error" }, err.status);
    logger.error({ err: String(err), path: c.req.path }, "unhandled");
    return c.json({ error: "internal_error" }, 500);
  });
  return app;
}
