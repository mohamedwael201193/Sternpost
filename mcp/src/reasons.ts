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

/**
 * TroveAccount.previewDraw() numeric reason codes (contracts/src/account/TroveAccount.sol):
 * 0 OK, 1 SESSION_INACTIVE, 2 PAYEE_NOT_ALLOWED, 3 OVER_PER_TX,
 * 4 OVER_BUDGET, 5 OVER_DAILY, 6 BELOW_FLOOR, 7 RECOVERY_MODE,
 * 8 TROVE_NOT_ACTIVE, 9 ZERO_AMOUNT.
 * `pay` maps these onto the plan §5.1 reason strings; OVER_DAILY and
 * ZERO_AMOUNT have no §5.1 equivalent and are returned verbatim (documented
 * in the README as extensions).
 */
export const TROVE_PREVIEW_REASONS = [
  "",
  "SESSION_INACTIVE",
  "PAYEE_NOT_ALLOWED",
  "OVER_PER_TX",
  "OVER_BUDGET",
  "OVER_DAILY",
  "BELOW_FLOOR",
  "RECOVERY_MODE",
  "TROVE_NOT_ACTIVE",
  "ZERO_AMOUNT",
] as const;

export const trovePreviewReasonText: Record<string, string> = {
  "": "Safe. This draw keeps the collateral ratio above the floor.",
  SESSION_INACTIVE: "No live session for this agent on this account (missing, expired, revoked, or never approved).",
  PAYEE_NOT_ALLOWED: "This agent may only pay its approved payees.",
  OVER_PER_TX: "More than this session may draw in one payment.",
  OVER_BUDGET: "More than this session's remaining budget.",
  OVER_DAILY: "More than this session's remaining daily limit.",
  BELOW_FLOOR: "Unsafe. This would push the collateral ratio below the floor.",
  RECOVERY_MODE: "Mezo is in Recovery Mode (system health below 150%). Draws are paused until it recovers.",
  TROVE_NOT_ACTIVE: "The trove behind this account is not active.",
  ZERO_AMOUNT: "Enter an amount above zero.",
};

export const explainTrovePreview = (code: number): { reason: string; explanation: string } => {
  const reason = TROVE_PREVIEW_REASONS[code] ?? `UNKNOWN_${code}`;
  return { reason, explanation: trovePreviewReasonText[reason] ?? reason };
};

/** Refusal reasons this server itself returns (never a chain revert). */
export const REFUSALS = {
  MAINNET_REFUSED:
    "refused: mainnet is never served unless STERNPOST_MAINNET_OK=1 and the account is recorded in shared/deployments/mainnet.json.",
  ACCOUNT_NOT_SET:
    "no account: set STERNPOST_ACCOUNT or pass an account address (request_session creates the session request for an account).",
  ACCOUNT_NOT_DEPLOYED:
    "no TroveAccount is deployed at that address (no code, or the address does not implement the TroveAccount interface).",
  NO_AGENT_KEY:
    "no agent key: run request_session first — it generates the local agent key (STERNPOST_AGENT_KEY_FILE).",
} as const;
