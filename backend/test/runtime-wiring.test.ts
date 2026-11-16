import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";
import { buildRelayer } from "../src/runtime.js";
import { relayDraw, RELAY_RATE_LIMIT_PER_HOUR } from "../src/relayer/relayer.js";

/**
 * Wiring tests through the REAL runtime deps (buildRelayer), not stubDeps:
 * the round-1 suite could not see the wiring gap because runtime.ts built a
 * fresh limiter per call and was excluded from coverage.
 *
 * `send` is stubbed on the returned deps object only: a real send would
 * broadcast a drawBySig on testnet. Everything else — the factory checker
 * (stub RPC client), the simulator (stub RPC client) and the rate limiter —
 * is exactly what buildRelayer built.
 */
const PAY_TO = "0x1111111111111111111111111111111111111111" as const;
const FACTORY = "0x46442898c022e1fAa2BD05a23600C1Ec89DcA200" as const;
const ACCOUNT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const AGENT = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const OTHER_AGENT = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
const PAYEE = "0xcccccccccccccccccccccccccccccccccccccccc" as const;
const SIG = ("0x" + "11".repeat(65)) as `0x${string}`;
const TX = "0x9999999999999999999999999999999999999999999999999999999999999999" as const;
// Test-only dummy key (never funded, testnet only): lets buildRelayer build
// a real wallet client so relayerAddress is set. Never a real key.
const DUMMY_KEY = ("0x" + "11".repeat(32)) as `0x${string}`;

const base = (over: Partial<any> = {}) => ({
  chainId: 31611,
  account: ACCOUNT,
  agent: AGENT,
  payee: PAYEE,
  amount: 10n ** 18n,
  deadline: Math.floor(Date.now() / 1000) + 600,
  sig: SIG,
  ...over,
});

/** Minimal fake RPC client: factory reads true, simulation never reverts. */
const fakeClient = {
  readContract: async () => true,
  call: async () => {},
} as any;

describe("buildRelayer wiring", () => {
  it("shares ONE rate limiter across sequential requests: the 21st in an hour gets 429", async () => {
    const cfg = loadConfig({ X402_PAY_TO: PAY_TO, ACCOUNT_FACTORY_ADDRESS: FACTORY, RELAYER_PRIVATE_KEY: DUMMY_KEY });
    const deps = buildRelayer(cfg, fakeClient);
    expect(deps.rateLimit).toBeDefined();
    let sends = 0;
    const wired = { ...deps, send: async () => { sends++; return TX; } };
    for (let i = 0; i < RELAY_RATE_LIMIT_PER_HOUR; i++) {
      expect((await relayDraw(wired, base())).ok).toBe(true);
    }
    expect(sends).toBe(RELAY_RATE_LIMIT_PER_HOUR);
    // The 21st request shares the same limiter instance: quota exhausted.
    expect(wired.rateLimit).toBe(deps.rateLimit);
    expect(await relayDraw(wired, base())).toEqual({ ok: false, error: "relay_rate_limited", status: 429 });
    expect(sends).toBe(RELAY_RATE_LIMIT_PER_HOUR); // the refused request never sent
    // LIMITATION (documented): the key is the unauthenticated body-supplied
    // `agent` address, so a different agent still has its own quota.
    expect((await relayDraw(wired, base({ agent: OTHER_AGENT })))).toMatchObject({ ok: true });
  });

  it("refuses CHAIN_ID=31612 at startup: loadConfig and buildRelayer both throw", async () => {
    expect(() => loadConfig({ X402_PAY_TO: PAY_TO, CHAIN_ID: 31612 })).toThrow(/CHAIN_ID/);
    const cfg = loadConfig({ X402_PAY_TO: PAY_TO });
    expect(() => buildRelayer({ ...cfg, CHAIN_ID: 31612 }, fakeClient)).toThrow(/must be 31611/);
  });
});
