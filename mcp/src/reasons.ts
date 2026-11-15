/**
 * Human explanations for the governor's previewDraw() reason codes.
 * Source of truth: sdk/src/reasons.ts — keep in sync; this copy exists so
 * the MCP package stays standalone (no cross-package import).
 */
export const reasonText: Record<string, string> = {
  "": "Safe. This draw keeps your collateral ratio above your floor.",
  FROZEN: "Draws are frozen. You revoked access; unfreeze to allow draws again.",
  ZERO_AMOUNT: "Enter an amount above zero.",
  APP_NOT_AUTHORIZED: "This app has no credit line from you.",
  APP_EXPIRED: "This app's access has expired.",
  OVER_PER_DRAW: "More than this app may draw at once.",
  OVER_BUDGET: "More than this app's remaining budget.",
  PAYEE_NOT_ALLOWED: "This app may only pay its approved address.",
  BELOW_FLOOR: "Unsafe. This would push your collateral ratio below your floor.",
  TROVE_CLOSED: "This trove is closed (redeemed, liquidated, or closed by the owner). Draws are blocked.",
  RECOVERY_MODE: "Mezo is in Recovery Mode (system health below 150%). Draws are paused until it recovers.",
};

export const explain = (code: string): string => reasonText[code] ?? code;

/** Refusal reasons this server itself returns (never a chain revert). */
export const REFUSALS = {
  SANDBOX_REQUIRED:
    "sandbox=false is refused: this server only serves the Mezo testnet sandbox (chain 31611). There is no mainnet mode.",
  MAINNET_REFUSED:
    "refused: mainnet is never served by this server (read-only testnet 31611 only).",
} as const;
