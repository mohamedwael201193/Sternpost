import { z } from "zod";

/**
 * Pinned deployment: the live 0.9 Classic redeploy on Mezo testnet (31611).
 * Source of truth: shared/deployments/testnet.json (classicRedeploy).
 *
 * Environment (plan §5.1):
 * - STERNPOST_NETWORK: `testnet` (default) or `mainnet`. Mainnet is REFUSED
 *   unless STERNPOST_MAINNET_OK=1 AND the account address is in the mainnet
 *   deployments file (shared/deployments/mainnet.json exists but records no
 *   account (all addresses null), so mainnet is refused outright today even
 *   with the flag set; see requireMainnetGate).
 * - STERNPOST_ACCOUNT: TroveAccount address (optional; balance/pay default
 *   to it, request_session requires an explicit account).
 * - STERNPOST_AGENT_KEY_FILE: default ~/.sternpost/agent.json, chmod 600,
 *   created by `request_session` if absent; the key is NEVER returned in a
 *   tool result or logged.
 * - STERNPOST_API: default https://sternpost-api.vercel.app.
 * - STERNPOST_RPC: RPC URL override (plan name). STERNPOST_RPC_URL is kept
 *   as a legacy alias; STERNPOST_RPC wins when both are set.
 */
export const CHAIN_ID = 31611;
export const RPC_URL = "https://rpc.test.mezo.org";
export const EXPLORER_URL = "https://explorer.test.mezo.org";

/** Classic 0.9 deployment addresses (internal helpers: preview_draw, governor_status, x402_quote). */
export const ADDRESSES = {
  factory: "0x39779A8678424CF78c841F9AfEa1EAFF3Cf7F6d8",
  governor: "0x1bF45cFE654a397F4FF3B33bC1b157c88Ee71F38",
  router: "0xd6833f811e987f06a1e55a435d4be38c6d4188d4",
  spendWallet: "0x4F878203175B1BB6C63Ec02CEEBE1af4A7c9Ee4a",
  musd: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
  /** Interim testnet x402 payee (TASK_BOARD.md): the deployer/fee recipient, until the owner supplies one. */
  x402PayToInterim: "0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3",
} as const;

/** Mezo system contracts on testnet 31611 (sources: contracts/script/fork.sh, sdk/src/chain.ts, Radar.t.sol). */
export const MEZO_TESTNET = {
  chainId: 31611,
  rpc: "https://rpc.test.mezo.org",
  explorer: "https://explorer.test.mezo.org",
  musd: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
  smusd: "0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16",
  borrowerOperations: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5",
  troveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
  priceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
  sortedTroves: "0x722E4D24FD6Ff8b0AC679450F3D91294607268fA",
  hintHelpers: "0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
} as const;

/** Mezo mainnet 31612. Only the values verified in MEZO_RESOURCES.md are
 * pinned here; the remaining system addresses must come from the mainnet
 * deployments file (shared/deployments/mainnet.json) — which exists but
 * records no account (all addresses null), so the mainnet path is refused
 * outright today even with the flag set, before any of them is needed. */
export const MEZO_MAINNET = {
  chainId: 31612,
  rpc: "https://rpc.mezo.org",
  explorer: "https://explorer.mezo.org",
  musd: "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186",
} as const;

export type NetworkName = "testnet" | "mainnet";

export const X402_NETWORK = `eip155:${CHAIN_ID}` as const;
/** Default per-route x402 price, mirroring backend/src/config.ts X402_PRICE (0.01 MUSD). */
export const X402_PRICE_DEFAULT = "10000000000000000";
export const X402_FACILITATOR_URL = "https://facilitator.vativ.io";

export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address");

const envSchema = z.object({
  STERNPOST_NETWORK: z.enum(["testnet", "mainnet"]).optional(),
  STERNPOST_MAINNET_OK: z.string().optional(),
  STERNPOST_ACCOUNT: addressSchema.optional(),
  STERNPOST_AGENT_KEY_FILE: z.string().min(1).optional(),
  STERNPOST_API: z.string().url().optional(),
  STERNPOST_RPC: z.string().url().optional(),
  STERNPOST_RPC_URL: z.string().url().optional(),
  STERNPOST_RADAR: addressSchema.optional(),
  STERNPOST_API_KEY: z.string().optional(),
  /**
   * Per-request RPC timeout in ms (default 30_000). The public testnet RPC
   * stalls under bursts and a 10 s viem default turns slow reads into
   * failures. Fork runs set 300_000: an anvil fork fetches remote state
   * per slot through the public RPC, so one heavy eth_call (the deployed
   * Radar's rank()) can take minutes — with a 30 s client timeout the
   * call is abandoned client-side while anvil keeps executing it
   * server-side, which then poisons the following tests.
   */
  STERNPOST_RPC_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(900_000).optional(),
  /** Optional x402 payee override. Must not be zero/burn; defaults to the interim deployer above. */
  X402_PAY_TO: addressSchema
    .refine(
      (v) => {
        const a = v.toLowerCase();
        return (
          a !== "0x0000000000000000000000000000000000000000" &&
          a !== "0x000000000000000000000000000000000000dead"
        );
      },
      { message: "X402_PAY_TO must not be the zero address or the burn address" },
    )
    .optional(),
  X402_PRICE: z.string().regex(/^\d+$/, "X402_PRICE must be a wei integer").optional(),
});

export type McpEnv = z.infer<typeof envSchema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): McpEnv {
  return envSchema.parse(env);
}

/** Resolved network for this server (plan §5.1: testnet default). */
export function resolveNetwork(env: McpEnv): NetworkName {
  return env.STERNPOST_NETWORK ?? "testnet";
}

export function chainIdFor(network: NetworkName): number {
  return network === "mainnet" ? MEZO_MAINNET.chainId : MEZO_TESTNET.chainId;
}

export function rpcUrl(env: McpEnv, network: NetworkName = resolveNetwork(env)): string {
  const override = env.STERNPOST_RPC ?? env.STERNPOST_RPC_URL;
  if (override) return override;
  return network === "mainnet" ? MEZO_MAINNET.rpc : MEZO_TESTNET.rpc;
}

export function explorerUrl(network: NetworkName): string {
  return network === "mainnet" ? MEZO_MAINNET.explorer : MEZO_TESTNET.explorer;
}

export function musdAddress(network: NetworkName): string {
  return network === "mainnet" ? MEZO_MAINNET.musd : MEZO_TESTNET.musd;
}

export function apiBase(env: McpEnv): string {
  return (env.STERNPOST_API ?? "https://sternpost-api.vercel.app").replace(/\/$/, "");
}

export function x402PayTo(env: McpEnv): `0x${string}` {
  return (env.X402_PAY_TO ?? ADDRESSES.x402PayToInterim) as `0x${string}`;
}

export function x402Price(env: McpEnv): string {
  return env.X402_PRICE ?? X402_PRICE_DEFAULT;
}
