import { serve } from "@hono/node-server";
import { createPublicClient, http, defineChain } from "viem";
import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { migrate } from "./db/migrate.js";
import { createApp } from "./app.js";
import { Indexer } from "./indexer/indexer.js";
import { logger } from "./logger.js";

const cfg = loadConfig();
if (!cfg.DATABASE_URL) throw new Error("DATABASE_URL is required");
const chain = defineChain({ id: cfg.CHAIN_ID, name: "Mezo", nativeCurrency: { name: "BTC", symbol: "BTC", decimals: 18 }, rpcUrls: { default: { http: [cfg.RPC_URL] } } });
const client = createPublicClient({ chain, transport: http(cfg.RPC_URL) });
const db = createPool(cfg.DATABASE_URL);
await migrate(db);

const app = createApp({
  db,
  corsOrigins: cfg.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
  rateLimitPerMin: cfg.RATE_LIMIT_PER_MIN,
  version: process.env.RENDER_GIT_COMMIT?.slice(0, 7),
  snapshot: async () => ({ blockNumber: await client.getBlockNumber() }),
  pay: {
    facilitatorUrl: cfg.X402_FACILITATOR_URL,
    network: `eip155:${cfg.CHAIN_ID}`,
    asset: cfg.MUSD_ADDRESS as `0x${string}`,
    payTo: cfg.X402_PAY_TO as `0x${string}`,
    amount: cfg.X402_PRICE,
    confirmTx: async (hash) => (await client.waitForTransactionReceipt({ hash, timeout: 30_000 })).status === "success",
  },
});

if (cfg.FACTORY_ADDRESS && cfg.INDEXER_ENABLED === "true") {
  const head = await client.getBlockNumber();
  const ix = new Indexer(db, client as any, { factory: cfg.FACTORY_ADDRESS as `0x${string}`, startBlock: cfg.INDEXER_START_BLOCK ?? head - 5000n });
  await ix.loadTracked();
  ix.start(cfg.INDEXER_INTERVAL_MS);
  logger.info({ factory: cfg.FACTORY_ADDRESS }, "indexer started");
}

serve({ fetch: app.fetch, port: cfg.PORT }, (i) => logger.info({ port: i.port }, "sternpost-api listening"));
