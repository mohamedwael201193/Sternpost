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
