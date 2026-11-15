import { describe, it, expect } from "vitest";
import { viemChain, ZERO, RADAR_MAX_STEPS } from "../src/telegram/chain.js";

const A = {
  factory: "0x0632a9fea303c0db4544bf642a8ad0467c6c6980",
  musd: "0x118917a40faf1cd7a13db0ef56c86de7973ac503",
  mezo: "0x7b7c000000000000000000000000000000000001",
  troveManager: "0xe47c80e8c23f6b4a1ae41c34837a0599d5d16bb0",
  priceFeed: "0x86bcf0841622a5dac14a313a15f96a95421b9366",
  sortedTroves: "0x722e4d24fd6ff8b0ac679450f3d91294607268fa",
} as const;
const G = "0x9EEA9762ED3C1DE2308C800687558064DFF0B832";
const T1 = "0x2222222222222222222222222222222222222222";
const T2 = "0x3333333333333333333333333333333333333333";
const BORROWER = "0x4444444444444444444444444444444444444444";
const W1 = "0x5555555555555555555555555555555555555555";
const AGENT = "0x6666666666666666666666666666666666666666";
const E18 = 10n ** 18n;

function client(over: Record<string, unknown> = {}) {
  const calls: any[] = [];
  const prev: Record<string, string> = { [T1.toLowerCase()]: T2, [T2.toLowerCase()]: BORROWER, [BORROWER.toLowerCase()]: ZERO };
  const icr: Record<string, bigint> = { [T1.toLowerCase()]: (12n * E18) / 10n, [T2.toLowerCase()]: (13n * E18) / 10n, [BORROWER.toLowerCase()]: (24n * E18) / 10n };
  const debt: Record<string, bigint> = { [T1.toLowerCase()]: 100n * E18, [T2.toLowerCase()]: 50n * E18, [BORROWER.toLowerCase()]: 10n * E18 };
  const values: Record<string, unknown> = {
    governorOf: G,
    icr: 3n, floorICR: 2n, defendICR: 1n, frozen: false, buffer: 9n, standby: [5n, 999n, 0n, true],
    appPolicy: [10n, 4n, 5n, 77n, ZERO],
    fetchPrice: 65000n * E18, getTCR: (23n * E18) / 10n, checkRecoveryMode: false, getSize: 279n,
    getLast: T1,
    getPrev: (p: any) => prev[(p.args[0] as string).toLowerCase()] ?? ZERO,
    getCurrentICR: (p: any) => icr[(p.args[0] as string).toLowerCase()] ?? 0n,
    getEntireDebtAndColl: (p: any) => [E18, debt[(p.args[0] as string).toLowerCase()] ?? 0n, 0n, 0n, 0n, 0n],
    getTroveStatus: 1,
    walletsOf: [W1],
    agent: AGENT, agentExpiry: 1_900_000_000n,
    ...over,
  };
  return {
    calls,
    c: {
      readContract: async (p: any) => {
        calls.push(p);
        if (p.functionName === "balanceOf") return p.address === A.musd ? 11n : 22n;
        const v = values[p.functionName];
        return typeof v === "function" ? (v as (p: any) => unknown)(p) : v;
      },
      getBlock: async () => ({ timestamp: 123n }),
    } as any,
  };
}

describe("viem chain reader", () => {
  it("resolves the governor (lowercased) or null", async () => {
    expect(await viemChain(client().c, A).governorOf(A.musd)).toBe(G.toLowerCase());
    expect(await viemChain(client({ governorOf: ZERO }).c, A).governorOf(A.musd)).toBeNull();
  });
  it("reads status, allowance, balances and time", async () => {
    const { c, calls } = client();
    const r = viemChain(c, A);
    expect(await r.status(G)).toEqual({ icr: 3n, floor: 2n, defend: 1n, frozen: false, buffer: 9n, standbyLive: true, standbyDeadline: 999n });
    expect(await r.allowance(G, A.musd)).toEqual({ remaining: 6n, perDrawMax: 5n, expiry: 77n });
    expect(await r.balances(A.factory)).toEqual({ musd: 11n, mezo: 22n });
    expect(await r.now()).toBe(123n);
    expect(calls.find((x) => x.functionName === "governorOf")).toBeUndefined();
  });
  it("radar: system health, frontier, and the borrower's rank + debt ahead", async () => {
    const r = await viemChain(client().c, A).radar(BORROWER);
    expect(r.price).toBe(65000n * E18);
    expect(r.tcr).toBe((23n * E18) / 10n);
    expect(r.recoveryMode).toBe(false);
    expect(r.troveCount).toBe(279n);
    expect(r.frontier).toEqual({ trove: T1.toLowerCase(), icr: (12n * E18) / 10n, debt: 100n * E18 });
    expect(r.mine).toEqual({ status: 1, icr: (24n * E18) / 10n, debt: 10n * E18, coll: E18 });
    expect(r.rank).toBe(3);
    expect(r.debtAhead).toBe(150n * E18);
    expect(r.steps).toBe(3);
    expect(r.found).toBe(true);
    expect(r.complete).toBe(true);
    expect(r.exhausted).toBe(false);
  });
  it("radar: a trove below the 1.10 floor is found but not ranked", async () => {
    const c = client({ getCurrentICR: (p: any) => ((p.args[0] as string).toLowerCase() === BORROWER.toLowerCase() ? E18 : (12n * E18) / 10n) });
    const r = await viemChain(c.c, A).radar(BORROWER);
    expect(r.found).toBe(true);
    expect(r.rank).toBe(0);
    expect(r.complete).toBe(true);
  });
  it("radar: borrower outside the walked window is an honest lower bound, not a rank", async () => {
    // getPrev loops on T2, so the walk fills the whole window without finding the borrower.
    const c = client({ getPrev: (p: any) => ((p.args[0] as string).toLowerCase() === T1.toLowerCase() ? T2 : T2) });
    const r = await viemChain(c.c, A).radar(BORROWER);
    expect(r.found).toBe(false);
    expect(r.complete).toBe(false);
    expect(r.exhausted).toBe(false);
    expect(r.rank).toBe(0);
    expect(r.steps).toBe(RADAR_MAX_STEPS);
    expect(r.debtAhead).toBe((100n + 19n * 50n) * E18); // T1 once + T2 nineteen times: a lower bound only
  });
  it("radar: a borrower with no trove in the list reports exhausted, not ranked", async () => {
    const c = client({ getPrev: () => ZERO });
    const r = await viemChain(c.c, A).radar(BORROWER);
    expect(r.found).toBe(false);
    expect(r.exhausted).toBe(true);
    expect(r.complete).toBe(true);
    expect(r.rank).toBe(0);
  });
  it("crew: governor + status + spend wallets with agent, expiry and MUSD", async () => {
    const r = await viemChain(client().c, A).crew(BORROWER);
    expect(r.governor).toBe(G.toLowerCase());
    expect(r.govStatus).toEqual({ icr: 3n, floor: 2n, defend: 1n, frozen: false, buffer: 9n, standbyLive: true, standbyDeadline: 999n });
    expect(r.wallets).toEqual([{ address: W1.toLowerCase(), agent: AGENT.toLowerCase(), agentExpiry: 1_900_000_000n, musd: 11n }]); // mock balanceOf on the MUSD contract returns 11n
  });
  it("crew: no governor and no wallets is empty, not an error", async () => {
    const c = client({ governorOf: ZERO, walletsOf: [] });
    const r = await viemChain(c.c, A).crew(BORROWER);
    expect(r).toEqual({ governor: null, govStatus: null, wallets: [] });
  });
});
