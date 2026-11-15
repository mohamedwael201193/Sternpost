import { ADDRESSES, X402_NETWORK, x402PayTo, x402Price, type McpEnv } from "./config.js";

/**
 * The exact x402 v2 402 challenge shape the backend returns
 * (backend/src/x402/paywall.ts `requirements()`), reproduced here so an MCP
 * client can quote a payment without ever settling one. This tool only
 * QUOTES: it never verifies, settles, or sends anything.
 */
export interface X402Requirements {
  scheme: "exact";
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string; assetTransferMethod: string };
}

export function x402Requirements(env: McpEnv): X402Requirements {
  return {
    scheme: "exact",
    network: X402_NETWORK,
    asset: ADDRESSES.musd,
    amount: x402Price(env),
    payTo: x402PayTo(env),
    maxTimeoutSeconds: 300,
    extra: { name: "Mezo USD", version: "1", assetTransferMethod: "permit2" },
  };
}

export function x402Challenge(env: McpEnv, resourceUrl: string, description: string) {
  return {
    x402Version: 2,
    error: "payment_required",
    resource: { url: resourceUrl, description, mimeType: "application/json" },
    accepts: [x402Requirements(env)],
  };
}

/** Priced routes. Amounts mirror the backend default (X402_PRICE, 0.01 MUSD) until task 2.3 sets per-route prices. */
export const X402_ROUTES = {
  radar: { resource: "/v1/radar", description: "Sternpost radar snapshot: trove rank, frontier, system health" },
  brief: { resource: "/paid/brief", description: "Sternpost demo: Mezo testnet desk brief" },
  muster: { resource: "/v1/muster", description: "Sternpost muster roll: proof accounts and team tags" },
} as const;

export type X402Route = keyof typeof X402_ROUTES;
