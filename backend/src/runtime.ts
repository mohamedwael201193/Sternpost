import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Config } from "./config.js";
import { createPool } from "./db/pool.js";
import { migrate } from "./db/migrate.js";
import { createApp } from "./app.js";
import { Indexer } from "./indexer/indexer.js";
import { createFactoryChecker } from "./relayer/factory.js";
import { liveRelayerClients, type RelayerDeps } from "./relayer/relayer.js";
import { telegramApi } from "./telegram/api.js";
import { viemChain, type Hex } from "./telegram/chain.js";
import { createBot } from "./telegram/bot.js";

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
    indexer = new Indexer(db, client as any, {
      factory: cfg.FACTORY_ADDRESS as `0x${string}`,
      startBlock: start,
      accountFactory: cfg.ACCOUNT_FACTORY_ADDRESS as `0x${string}` | undefined,
    });
    await indexer.loadTracked();
  }
  let telegram;
  if (cfg.TELEGRAM_BOT_TOKEN && cfg.TELEGRAM_WEBHOOK_SECRET && cfg.FACTORY_ADDRESS) {
    const bot = createBot({
      db,
      tg: telegramApi(cfg.TELEGRAM_BOT_TOKEN),
      chain: viemChain(client as any, { factory: cfg.FACTORY_ADDRESS as Hex, musd: cfg.MUSD_ADDRESS as Hex, mezo: cfg.MEZO_ADDRESS as Hex }),
      appUrl: cfg.APP_URL,
      apiUrl: cfg.PUBLIC_API_URL,
      alertMarginBps: cfg.TELEGRAM_ALERT_MARGIN_BPS,
    });
    telegram = { bot, webhookSecret: cfg.TELEGRAM_WEBHOOK_SECRET, cronSecret: cfg.CRON_SECRET };
  }
  const app = createApp({
    db,
    indexer,
    telegram,
    relayer: buildRelayer(cfg, client),
    muster: { team: cfg.TEAM_ADDRESSES.split(",").map((s) => s.trim()).filter(Boolean) },
    sessionRequests: {
      sandboxAccount: (cfg.SANDBOX_ACCOUNT_ADDRESS ?? null) as `0x${string}` | null,
      dailyCapMusd: cfg.SANDBOX_DAILY_CAP_MUSD,
      maxDays: cfg.SANDBOX_MAX_DAYS,
      appUrl: cfg.APP_URL,
      isAccount: cfg.ACCOUNT_FACTORY_ADDRESS
        ? createFactoryChecker(client, cfg.ACCOUNT_FACTORY_ADDRESS as `0x${string}`)
        : undefined,
    },
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

/**
 * Relayer deps (task 2.4). The factory checker is built only when an account
 * factory is configured; without it the relay fails closed. The wallet client
 * exists only when RELAYER_PRIVATE_KEY is set — the key value is never logged.
 * Mainnet is refused inside relayDraw regardless of configuration.
 */
function buildRelayer(cfg: Config, client: ReturnType<typeof createPublicClient>): RelayerDeps {
  const wallet = cfg.RELAYER_PRIVATE_KEY
    ? createWalletClient({
        account: privateKeyToAccount(cfg.RELAYER_PRIVATE_KEY as `0x${string}`),
        chain: defineChain({
          id: cfg.CHAIN_ID,
          name: "Mezo",
          nativeCurrency: { name: "BTC", symbol: "BTC", decimals: 18 },
          rpcUrls: { default: { http: [cfg.RPC_URL] } },
        }),
        transport: http(cfg.RPC_URL),
      })
    : null;
  const live = liveRelayerClients(client as any, wallet as any);
  return {
    factory: (cfg.ACCOUNT_FACTORY_ADDRESS ?? null) as `0x${string}` | null,
    isAccount: cfg.ACCOUNT_FACTORY_ADDRESS
      ? createFactoryChecker(client as any, cfg.ACCOUNT_FACTORY_ADDRESS as `0x${string}`)
      : async () => false,
    relayerAddress: live.relayerAddress,
    simulate: live.simulate,
    send: live.send,
  };
}
