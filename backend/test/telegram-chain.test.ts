import { describe, it, expect } from "vitest";
import { viemChain, ZERO } from "../src/telegram/chain.js";

const A = { factory: "0x0632a9fea303c0db4544bf642a8ad0467c6c6980", musd: "0x118917a40faf1cd7a13db0ef56c86de7973ac503", mezo: "0x7b7c000000000000000000000000000000000001" } as const;
const G = "0x9EEA9762ED3C1DE2308C800687558064DFF0B832";

function client(over: Record<string, unknown> = {}) {
  const calls: any[] = [];
  const values: Record<string, unknown> = { governorOf: G, icr: 3n, floorICR: 2n, defendICR: 1n, frozen: false, buffer: 9n, appPolicy: [10n, 4n, 5n, 77n, ZERO], ...over };
  return {
    calls,
    c: {
      readContract: async (p: any) => { calls.push(p); return p.functionName === "balanceOf" ? (p.address === A.musd ? 11n : 22n) : values[p.functionName]; },
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
    expect(await r.status(G)).toEqual({ icr: 3n, floor: 2n, defend: 1n, frozen: false, buffer: 9n });
    expect(await r.allowance(G, A.musd)).toEqual({ remaining: 6n, perDrawMax: 5n, expiry: 77n });
    expect(await r.balances(A.factory)).toEqual({ musd: 11n, mezo: 22n });
    expect(await r.now()).toBe(123n);
    expect(calls.find((x) => x.functionName === "governorOf")).toBeUndefined();
  });
});
