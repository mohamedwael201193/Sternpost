import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().optional(),
  RPC_URL: z.string().url().default("https://rpc.test.mezo.org"),
  CHAIN_ID: z.coerce.number().int().default(31611),
  MUSD_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).default("0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503"),
  FACTORY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  /** TroveAccountFactory (Wave 2 accounts) on the configured chain. Not deployed on testnet yet: when unset the relayer fails closed and the indexer only tracks Classic contracts. */
  ACCOUNT_FACTORY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  /** Gas-sponsoring EOA for POST /v1/relay/draw. Never logged. When unset the relay endpoint returns 503 (refusals still apply). */
  RELAYER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  /** Comma-separated team addresses for the Muster roll (deployer, team agents, relayer, keeper, fee recipient). */
  TEAM_ADDRESSES: z.string().default(
    "0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3,0xEf647815DF216c60c061a5C7b6c07e3e45D77Ae8,0x77fa3345c7952E5979AA5f5f2495a158a78023d9",
  ),
  /** Team sandbox TroveAccount (Lane B). Not deployed yet: when unset, sandbox auto-approve returns 503. Testnet only. */
  SANDBOX_ACCOUNT_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  /** Sandbox auto-approve cap, MUSD per agent per day (plan 5.2). */
  SANDBOX_DAILY_CAP_MUSD: z.string().regex(/^\d+$/).default("5"),
  /** Sandbox auto-approve cap, maximum session length in days. */
  SANDBOX_MAX_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  INDEXER_START_BLOCK: z.coerce.bigint().optional(),
  INDEXER_INTERVAL_MS: z.coerce.number().int().min(1000).default(15000),
  INDEXER_ENABLED: z.enum(["true", "false"]).default("true"),
  X402_FACILITATOR_URL: z.string().url().default("https://facilitator.vativ.io"),
  X402_PAY_TO: z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine(
    (v) => {
      const a = v.toLowerCase();
      return a !== "0x0000000000000000000000000000000000000000" &&
        a !== "0x000000000000000000000000000000000000dead";
    },
    { message: "X402_PAY_TO must not be the zero address or the burn address" },
  ),
  X402_PRICE: z.string().regex(/^\d+$/).default("10000000000000000"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(120),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{16,256}$/).optional(),
  CRON_SECRET: z.string().min(16).optional(),
  MEZO_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).default("0x7B7c000000000000000000000000000000000001"),
  APP_URL: z.string().url().default("https://sternpost-pink.vercel.app"),
  PUBLIC_API_URL: z.string().url().default("https://sternpost-api.vercel.app"),
  TELEGRAM_ALERT_MARGIN_BPS: z.coerce.number().int().min(0).max(10000).default(1000),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = z.infer<typeof schema>;
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => schema.parse(env);
