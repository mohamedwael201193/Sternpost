import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { buildRuntime } from "./runtime.js";
import { logger } from "./logger.js";

const cfg = loadConfig();
const { app, indexer } = await buildRuntime(cfg);
if (indexer) {
  indexer.start(cfg.INDEXER_INTERVAL_MS);
  logger.info({ factory: cfg.FACTORY_ADDRESS }, "indexer started");
}
serve({ fetch: app.fetch, port: cfg.PORT }, (i) => logger.info({ port: i.port }, "sternpost-api listening"));
