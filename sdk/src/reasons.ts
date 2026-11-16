import { keccak256, toBytes, type Hex } from "viem";
import { troveAccountAbi } from "./abi.js";

/** Human explanations for the governor's previewDraw() reason codes. */
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
  // TroveAccount (plan §5.2): the draw/session/shield refusal codes.
  SESSION_INACTIVE: "This agent has no live session on this account.",
  OVER_PER_TX: "More than this session may draw in one transaction.",
  OVER_DAILY: "More than this session's daily limit.",
  TROVE_NOT_ACTIVE: "This trove is not active (not opened, or closed/redeemed/liquidated).",
  BELOW_MIN_DEBT: "The remaining debt would fall below Mezo's minimum net debt (1800 MUSD).",
  REDEMPTION_EXPOSED: "Too much redeemable debt sits ahead of this trove; opening here would be redemption-exposed.",
  NEED_MUSD: "The account does not hold enough MUSD for this step.",
  NOT_STRESSED: "Nothing to shield: the trove is not below its shield line.",
  COOLDOWN: "The shield is in its cooldown window; only the owner may shield inside it.",
  OVER_MAX: "The payment asks for more MUSD than the caller's ceiling.",
  NETWORK_MISMATCH: "The payment request is for a different chain than this account lives on.",
  ASSET_MISMATCH: "The payment request asks for a different asset than MUSD.",
  UNKNOWN: "The call reverted with an unrecognised error.",
};

export const explain = (code: string) => reasonText[code] ?? code;

/**
 * TroveAccount refusal codes (plan §5.2, §3.3). The union covers the
 * previewDraw() reasonCode table, the contract's custom errors (via
 * reasonFromRevert), and the x402 refusal codes payByBorrow can return.
 */
export type ReasonCode =
  | "OK"
  | "SESSION_INACTIVE"
  | "PAYEE_NOT_ALLOWED"
  | "OVER_PER_TX"
  | "OVER_BUDGET"
  | "OVER_DAILY"
  | "BELOW_FLOOR"
  | "RECOVERY_MODE"
  | "TROVE_NOT_ACTIVE"
  | "ZERO_AMOUNT"
  | "BELOW_MIN_DEBT"
  | "REDEMPTION_EXPOSED"
  | "NEED_MUSD"
  | "NOT_STRESSED"
  | "COOLDOWN"
  | "OVER_MAX"
  | "NETWORK_MISMATCH"
  | "ASSET_MISMATCH"
  | "UNKNOWN";

/**
 * TroveAccount.previewDraw() reasonCode table (TroveAccount.sol §previewDraw):
 * 0 OK, 1 SESSION_INACTIVE, 2 PAYEE_NOT_ALLOWED, 3 OVER_PER_TX, 4 OVER_BUDGET,
 * 5 OVER_DAILY, 6 BELOW_FLOOR, 7 RECOVERY_MODE, 8 TROVE_NOT_ACTIVE, 9 ZERO_AMOUNT.
 */
export const PREVIEW_REASON_CODES: readonly ReasonCode[] = [
  "OK",
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

export function reasonFromCode(code: number): ReasonCode {
  return PREVIEW_REASON_CODES[code] ?? "UNKNOWN";
}

function pascalToScreaming(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

/**
 * 4-byte error selector -> ReasonCode, derived from the TroveAccount ABI so
 * the table cannot drift from the deployed contract: every `error` entry in
 * troveAccountAbi contributes keccak256("Name(type,...)")[0:4] -> NAME.
 * Unknown selectors (including Error(string) 0x08c379a0 and Panic 0x4e487b71)
 * map to "UNKNOWN".
 */
const selectorToReason: Map<string, ReasonCode> = new Map(
  (troveAccountAbi as readonly { type?: string; name?: string; inputs?: readonly { type: string }[] }[])
    .filter((e) => e.type === "error" && e.name)
    .map((e) => {
      const sig = `${e.name}(${(e.inputs ?? []).map((i) => i.type).join(",")})`;
      const selector = keccak256(toBytes(sig)).slice(0, 10);
      return [selector, pascalToScreaming(e.name!)] as [string, ReasonCode];
    }),
);

export function reasonFromRevert(data: Hex): ReasonCode {
  if (!data || data.length < 10) return "UNKNOWN";
  return selectorToReason.get(data.slice(0, 10).toLowerCase()) ?? "UNKNOWN";
}
