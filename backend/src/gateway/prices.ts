/**
 * Gateway price table (plan §5.3). Prices are MUSD wei (18 decimals).
 * PROPOSED, not market-tested — the plan says so, and the prices endpoint
 * says so too. The 10 bps agent-draw fee is separate (plan §3.11).
 */
export type GatewayRouteId = "radar" | "previewDraw" | "brief" | "riskReport";

export const GATEWAY_PRICES: Record<
  GatewayRouteId,
  { amount: string; musd: string; description: string }
> = {
  radar: {
    amount: "1000000000000000",
    musd: "0.001",
    description: "Redemption Radar snapshot: rank, debt ahead, TCR, Recovery Mode",
  },
  previewDraw: {
    amount: "1000000000000000",
    musd: "0.001",
    description: "previewDraw dry-run: ok, reason code, ICR after, fee",
  },
  brief: {
    amount: "10000000000000000",
    musd: "0.01",
    description: "Mezo testnet desk brief (existing /v1/paid/brief)",
  },
  riskReport: {
    amount: "10000000000000000",
    musd: "0.01",
    description: "Risk report: ICR, rank, shield triggers, recent events",
  },
};

/** `previewDraw` reason codes, verbatim from `TroveAccount.previewDraw`. */
export const PREVIEW_REASON_NAMES: Record<number, string> = {
  0: "OK",
  1: "SESSION_INACTIVE",
  2: "PAYEE_NOT_ALLOWED",
  3: "OVER_PER_TX",
  4: "OVER_BUDGET",
  5: "OVER_DAILY",
  6: "BELOW_FLOOR",
  7: "RECOVERY_MODE",
  8: "TROVE_NOT_ACTIVE",
  9: "ZERO_AMOUNT",
};
