import { createPublicClient, http, defineChain } from "viem";
import type { Config } from "./config.js";
import { createPool } from "./db/pool.js";
import { migrate } from "./db/migrate.js";
import { createApp } from "./app.js";
import { Indexer } from "./indexer/indexer.js";

/** Builds the full runtime (db, chain client, app, optional indexer) from config. Shared by server and serverless entries. */
export async function buildRuntime(cfg: Config, opts: { poolMax?: number } = {}) {
  if (!cfg.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const chain = defineChain({ id: cfg.CHAIN_ID, name: "Mezo", nativeCurrency: { name: "BTC", symbol: "BTC", decimals: 18 }, rpcUrls: { default: { http: [cfg.RPC_URL] } } });
  const client = createPublicClient({ chain, transport: http(cfg.RPC_URL) });
  const db = createPool(cfg.DATABASE_URL, opts.poolMax);
  await migrate(db);
  let indexer: Indexer | undefined;
  if (cfg.FACTORY_ADDRESS && cfg.INDEXER_ENABLED === "true") {
    const start = cfg.INDEXER_START_BLOCK ?? (await client.getBlockNumber()) - 5000n;
    indexer = new Indexer(db, client as any, { factory: cfg.FACTORY_ADDRESS as `0x${string}`, startBlock: start });
    await indexer.loadTracked();
  }
  const app = createApp({
    db,
    indexer,
    corsOrigins: cfg.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    rateLimitPerMin: cfg.RATE_LIMIT_PER_MIN,
    version: (process.env.RENDER_GIT_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA)?.slice(0, 7),
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
  return { app, db, indexer };
}
