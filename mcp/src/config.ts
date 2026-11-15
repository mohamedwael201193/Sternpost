import { z } from "zod";

/**
 * Pinned deployment: the live 0.9 Classic redeploy on Mezo testnet (31611).
 * Source of truth: shared/deployments/testnet.json (classicRedeploy).
 * This server is read-only and testnet-only: it never sends a transaction
 * and refuses any chain id other than 31611.
 */
export const CHAIN_ID = 31611;
export const RPC_URL = "https://rpc.test.mezo.org";
export const EXPLORER_URL = "https://explorer.test.mezo.org";

export const ADDRESSES = {
  factory: "0x39779A8678424CF78c841F9AfEa1EAFF3Cf7F6d8",
  governor: "0x1bF45cFE654a397F4FF3B33bC1b157c88Ee71F38",
  router: "0xd6833f811e987f06a1e55a435d4be38c6d4188d4",
  spendWallet: "0x4F878203175B1BB6C63Ec02CEEBE1af4A7c9Ee4a",
  musd: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
  /** Interim testnet x402 payee (TASK_BOARD.md): the deployer/fee recipient, until the owner supplies one. */
  x402PayToInterim: "0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3",
} as const;

export const X402_NETWORK = `eip155:${CHAIN_ID}` as const;
/** Default per-route x402 price, mirroring backend/src/config.ts X402_PRICE (0.01 MUSD). */
export const X402_PRICE_DEFAULT = "10000000000000000";
export const X402_FACILITATOR_URL = "https://facilitator.vativ.io";

export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address");

/**
 * Sandbox flag. Every tool takes `sandbox` (default true). This server only
 * serves the Mezo testnet sandbox: a call with sandbox=false is refused with
 * reason SANDBOX_REQUIRED instead of silently falling back to any other
 * network. There is no mainnet mode.
 */
export const sandboxSchema = z.boolean().default(true);

const envSchema = z.object({
  STERNPOST_RPC_URL: z.string().url().optional(),
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

export function x402PayTo(env: McpEnv): `0x${string}` {
  return (env.X402_PAY_TO ?? ADDRESSES.x402PayToInterim) as `0x${string}`;
}

export function x402Price(env: McpEnv): string {
  return env.X402_PRICE ?? X402_PRICE_DEFAULT;
}

export function rpcUrl(env: McpEnv): string {
  return env.STERNPOST_RPC_URL ?? RPC_URL;
}
