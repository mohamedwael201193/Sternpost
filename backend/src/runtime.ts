import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Config } from "./config.js";
import { deploymentFileAddresses } from "./deployments.js";
import { createPool } from "./db/pool.js";
import { migrate } from "./db/migrate.js";
import { createApp } from "./app.js";
import { Indexer } from "./indexer/indexer.js";
import { createFactoryChecker } from "./relayer/factory.js";
import { assertTestnetChain, liveRelayerClients, RelayRateLimiter, type RelayerDeps } from "./relayer/relayer.js";
import { telegramApi } from "./telegram/api.js";
import { viemChain, type Hex } from "./telegram/chain.js";
import { createBot } from "./telegram/bot.js";

/** Builds the full runtime (db, chain client, app, optional indexer) from config. Shared by server and serverless entries. */
export async function buildRuntime(cfg: Config, opts: { poolMax?: number } = {}) {
  // Fail fast at startup: no env (CHAIN_ID=31612 + mainnet RPC) may ever
  // enable a mainnet relay or a mainnet sandbox grant.
  assertTestnetChain(cfg.CHAIN_ID);
  if (!cfg.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const chain = defineChain({ id: cfg.CHAIN_ID, name: "Mezo", nativeCurrency: { name: "BTC", symbol: "BTC", decimals: 18 }, rpcUrls: { default: { http: [cfg.RPC_URL] } } });
  // The public testnet RPC answers slowly (~2-5s per eth_call) and supports
  // JSON-RPC batching (verified live 2026-11-15): batch the bot's parallel
  // reads into fewer HTTP requests and allow 30s per request instead of
  // viem's 10s default, or /radar times out mid-walk. Read-only either way.
  const client = createPublicClient({ chain, transport: http(cfg.RPC_URL, { batch: true, timeout: 30_000 }) });
  const db = createPool(cfg.DATABASE_URL, opts.poolMax);
  await migrate(db);
  // Factory: explicit env wins; otherwise the 0.9 address from shared/deployments/testnet.json.
  const factory = cfg.FACTORY_ADDRESS ?? deploymentFileAddresses().factory;
  let indexer: Indexer | undefined;
  if (factory && cfg.INDEXER_ENABLED === "true") {
    const start = cfg.INDEXER_START_BLOCK ?? (await client.getBlockNumber()) - 5000n;
    indexer = new Indexer(db, client as any, {
      factory: factory as `0x${string}`,
      startBlock: start,
      accountFactory: cfg.ACCOUNT_FACTORY_ADDRESS as `0x${string}` | undefined,
    });
    await indexer.loadTracked();
  }
  let telegram;
  if (cfg.TELEGRAM_BOT_TOKEN && cfg.TELEGRAM_WEBHOOK_SECRET && factory) {
    const bot = createBot({
      db,
      tg: telegramApi(cfg.TELEGRAM_BOT_TOKEN),
      chain: viemChain(client as any, {
        factory: factory as Hex,
        musd: cfg.MUSD_ADDRESS as Hex,
        mezo: cfg.MEZO_ADDRESS as Hex,
        troveManager: cfg.TROVE_MANAGER_ADDRESS as Hex,
        priceFeed: cfg.PRICE_FEED_ADDRESS as Hex,
        sortedTroves: cfg.SORTED_TROVES_ADDRESS as Hex,
      }),
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
      chainId: cfg.CHAIN_ID,
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
 * Exactly ONE RelayRateLimiter is constructed here and shared by every
 * request the runtime serves; a per-call limiter could never fill, so the
 * 429 could never fire. Mainnet is refused at startup (assertTestnetChain)
 * and again per request inside relayDraw.
 */
export function buildRelayer(cfg: Config, client: ReturnType<typeof createPublicClient>): RelayerDeps {
  assertTestnetChain(cfg.CHAIN_ID);
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
    rateLimit: new RelayRateLimiter(),
  };
}
