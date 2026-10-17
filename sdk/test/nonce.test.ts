import { describe, it, expect } from "vitest";
import { NonceCoordinator, describeStandby } from "../src/nonce.js";
import { explain, reasonText } from "../src/reasons.js";

describe("NonceCoordinator", () => {
  it("serialises signers and re-reads the nonce each time", async () => {
    let chain = 0n; const seen: bigint[] = [];
    const c = new NonceCoordinator(async () => chain);
    await Promise.all([1, 2, 3].map(() => c.run(async (n) => { seen.push(n); await new Promise((r) => setTimeout(r, 5)); chain = n + 1n; })));
    expect(seen).toEqual([0n, 1n, 2n]);
  });
  it("keeps going after a failed job", async () => {
    const c = new NonceCoordinator(async () => 4n);
    await expect(c.run(async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(await c.run(async (n) => n)).toBe(4n);
  });
  it("detects a stale nonce", async () => {
    let chain = 5n; const c = new NonceCoordinator(async () => chain);
    expect(await c.isFresh(5n)).toBe(true); chain = 6n; expect(await c.isFresh(5n)).toBe(false);
  });
});

describe("plain-language states", () => {
  it("standby", () => {
    expect(describeStandby({ amount: 0n, deadline: 0n, nonce: 0n, live: false })).toMatch(/No safety/);
    expect(describeStandby({ amount: 1n, deadline: 9n, nonce: 0n, live: true })).toMatch(/armed and valid/);
    expect(describeStandby({ amount: 1n, deadline: 1n, nonce: 0n, live: false }, 5n)).toMatch(/expired/);
    expect(describeStandby({ amount: 1n, deadline: 9n, nonce: 0n, live: false }, 5n)).toMatch(/nonce/);
  });
  it("every contract reason code has text", () => {
    for (const c of ["FROZEN", "ZERO_AMOUNT", "APP_NOT_AUTHORIZED", "APP_EXPIRED", "OVER_PER_DRAW", "OVER_BUDGET", "PAYEE_NOT_ALLOWED", "BELOW_FLOOR"])
      expect(reasonText[c]).toBeTruthy();
    expect(explain("")).toMatch(/Safe/);
  });
});
