import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

// C8 (plan §3.14): X402_PAY_TO is REQUIRED — there is no default payee.
// src/index.ts and src/serverless.ts call loadConfig() at startup, so a
// missing value aborts boot instead of silently sending revenue nowhere.
const PAY_TO = "0x1111111111111111111111111111111111111111" as const; // test-only placeholder, not a real payee

describe("config: X402_PAY_TO required (C8)", () => {
  it("fails to load when X402_PAY_TO is unset", () => {
    expect(() => loadConfig({})).toThrow(/X402_PAY_TO/);
  });

  it("fails to load when X402_PAY_TO is empty", () => {
    expect(() => loadConfig({ X402_PAY_TO: "" })).toThrow(/X402_PAY_TO/);
  });

  it("fails to load when X402_PAY_TO is not an address", () => {
    expect(() => loadConfig({ X402_PAY_TO: "0x1" })).toThrow(/X402_PAY_TO/);
  });

  it("rejects the zero address", () => {
    expect(() => loadConfig({ X402_PAY_TO: "0x0000000000000000000000000000000000000000" })).toThrow(/X402_PAY_TO/);
  });

  it("rejects the burn address in any casing", () => {
    expect(() => loadConfig({ X402_PAY_TO: "0x000000000000000000000000000000000000dEaD" })).toThrow(/X402_PAY_TO/);
    expect(() => loadConfig({ X402_PAY_TO: "0x000000000000000000000000000000000000dead" })).toThrow(/X402_PAY_TO/);
  });

  it("loads when X402_PAY_TO is a valid address and keeps other defaults", () => {
    const c = loadConfig({ X402_PAY_TO: PAY_TO });
    expect(c.X402_PAY_TO).toBe(PAY_TO);
    expect(c.CHAIN_ID).toBe(31611);
  });
});

describe("config: P3 backend vars (tasks 2.4, 2.6, 5.2)", () => {
  it("rejects a malformed account factory address", () => {
    expect(() => loadConfig({ X402_PAY_TO: PAY_TO, ACCOUNT_FACTORY_ADDRESS: "0x1" })).toThrow(/ACCOUNT_FACTORY_ADDRESS/);
  });

  it("rejects a malformed relayer key", () => {
    expect(() => loadConfig({ X402_PAY_TO: PAY_TO, RELAYER_PRIVATE_KEY: "0x1234" })).toThrow(/RELAYER_PRIVATE_KEY/);
  });

  it("keeps P3 defaults: no factory/sandbox/relayer until configured, 5 MUSD/day sandbox cap", () => {
    const c = loadConfig({ X402_PAY_TO: PAY_TO });
    expect(c.ACCOUNT_FACTORY_ADDRESS).toBeUndefined();
    expect(c.RELAYER_PRIVATE_KEY).toBeUndefined();
    expect(c.SANDBOX_ACCOUNT_ADDRESS).toBeUndefined();
    expect(c.SANDBOX_DAILY_CAP_MUSD).toBe("5");
    expect(c.SANDBOX_MAX_DAYS).toBe(7);
    expect(c.TEAM_ADDRESSES).toContain("0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3");
  });
});
