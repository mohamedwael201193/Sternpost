import { describe, it, expect } from "vitest";
import { keccak256, toBytes } from "viem";
import { reasonFromCode, reasonFromRevert, explain, PREVIEW_REASON_CODES } from "../src/reasons.js";

// Selector of a custom error, computed independently of the SDK table.
const sel = (sig: string) => keccak256(toBytes(sig)).slice(0, 10);

describe("reasonFromCode (previewDraw table)", () => {
  it("maps the contract's documented table 0-9", () => {
    expect(PREVIEW_REASON_CODES).toEqual([
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
    ]);
    expect(reasonFromCode(0)).toBe("OK");
    expect(reasonFromCode(6)).toBe("BELOW_FLOOR");
    expect(reasonFromCode(9)).toBe("ZERO_AMOUNT");
  });

  it("returns UNKNOWN out of range", () => {
    expect(reasonFromCode(10)).toBe("UNKNOWN");
    expect(reasonFromCode(255)).toBe("UNKNOWN");
  });
});

describe("reasonFromRevert (4-byte selector -> code)", () => {
  it("maps every TroveAccount custom error in the plan's list", () => {
    const cases: [string, string][] = [
      ["BelowFloor(uint256,uint256)", "BELOW_FLOOR"],
      ["BelowMinDebt(uint256,uint256)", "BELOW_MIN_DEBT"],
      ["Cooldown(uint256)", "COOLDOWN"],
      ["NeedMusd(uint256)", "NEED_MUSD"],
      ["NotStressed(uint256)", "NOT_STRESSED"],
      ["OverBudget(uint256,uint256)", "OVER_BUDGET"],
      ["OverDaily(uint256,uint256)", "OVER_DAILY"],
      ["OverPerTx(uint256,uint256)", "OVER_PER_TX"],
      ["PayeeNotAllowed(address)", "PAYEE_NOT_ALLOWED"],
      ["RecoveryMode(uint256)", "RECOVERY_MODE"],
      ["RedemptionExposed(uint256,uint256)", "REDEMPTION_EXPOSED"],
      ["SessionInactive()", "SESSION_INACTIVE"],
      ["TroveNotActive(uint8)", "TROVE_NOT_ACTIVE"],
      ["ZeroAmount()", "ZERO_AMOUNT"],
      ["BadSig()", "BAD_SIG"],
      ["Expired()", "EXPIRED"],
    ];
    for (const [sig, code] of cases) {
      // Revert data carries the selector plus ABI-encoded args; only the
      // first 4 bytes matter.
      expect(reasonFromRevert(`${sel(sig)}${"00".repeat(64)}` as `0x${string}`)).toBe(code);
    }
  });

  it("returns UNKNOWN for Error(string), Panic, empty and short data", () => {
    expect(reasonFromRevert("0x08c379a0" as `0x${string}`)).toBe("UNKNOWN");
    expect(reasonFromRevert("0x4e487b71" as `0x${string}`)).toBe("UNKNOWN");
    expect(reasonFromRevert("0x" as `0x${string}`)).toBe("UNKNOWN");
    expect(reasonFromRevert("0x1234" as `0x${string}`)).toBe("UNKNOWN");
    expect(reasonFromRevert("0xdeadbeef" as `0x${string}`)).toBe("UNKNOWN");
  });
});

describe("explain (human text)", () => {
  it("covers every ReasonCode in the plan's list", () => {
    for (const code of [
      "SESSION_INACTIVE", "PAYEE_NOT_ALLOWED", "OVER_PER_TX", "OVER_BUDGET", "OVER_DAILY",
      "BELOW_FLOOR", "RECOVERY_MODE", "TROVE_NOT_ACTIVE", "ZERO_AMOUNT", "BELOW_MIN_DEBT",
      "REDEMPTION_EXPOSED", "NEED_MUSD", "NOT_STRESSED", "COOLDOWN",
      "OVER_MAX", "NETWORK_MISMATCH", "ASSET_MISMATCH",
    ]) {
      expect(explain(code)).not.toBe(code);
      expect(explain(code).length).toBeGreaterThan(10);
    }
  });
});
