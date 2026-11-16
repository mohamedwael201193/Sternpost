import { describe, it, expect, vi } from "vitest";
import { readRadar, readMainnetHealth, mainnetAddresses } from "../src/radar.js";
import { MULTICALL3_ADDRESS } from "../src/chain.js";
import type { ReadClient } from "../src/read-client.js";
import type { Address } from "viem";

const RADAR = "0xfe74C8e67f0499e4426DD71D6bdf48A9A557DC6C" as Address;
const ACCOUNT = "0x5A1166eC096e12C0C6187695F82B7F4b285389Df" as Address;
const FRONTIER = "0x5eaA8bdc315608E8Cf873CFAbA05e42826f68C4d" as Address;

// Live snapshot of the testnet Radar read from Mezo testnet during the 3.2
// authoring session (2026-11-16). The exact block was not recorded in the
// commit, so none is claimed here — the price/TCR pair was not re-found in a
// 543-block systemHealth scan around block 16810643.

const ok = <T>(result: T) => ({ status: "success", result }) as const;
const fail = { status: "failure", error: new Error("revert") } as const;

/** One entry per expected multicall, in call order. */
function mockClient(calls: unknown[][]): ReadClient {
  const multicall = vi.fn();
  for (const c of calls) multicall.mockResolvedValueOnce(c);
  return { multicall, getBalance: vi.fn().mockResolvedValue(0n) };
}

describe("readRadar (testnet Radar contract)", () => {
  it("maps systemHealth + frontier + a resolved rank", async () => {
    const client = mockClient([[
      ok([64_593_848_810_000_000_000_000n, 2_319_880_582_609_420_980n, false, 277n]),
      ok([FRONTIER, 1_261_105_063_730_040_375n, 426_007_699_704_189_288_250_721_624n]),
      ok([181n, 426_411_601_919_614_124_589_313_600n, 181n, true]),
    ]]);
    const snap = await readRadar(client, RADAR, ACCOUNT);
    expect(snap.network).toBe("testnet");
    expect(snap.price).toBe(64_593_848_810_000_000_000_000n);
    expect(snap.tcr).toBe(2_319_880_582_609_420_980n);
    expect(snap.recoveryMode).toBe(false);
    expect(snap.troveCount).toBe(277n);
    expect(snap.frontier).toEqual({ trove: FRONTIER, icr: 1_261_105_063_730_040_375n, debt: 426_007_699_704_189_288_250_721_624n });
    expect(snap.rank).toEqual({ rank: 181n, debtAhead: 426_411_601_919_614_124_589_313_600n, steps: 181n, complete: true });
    expect(client.multicall).toHaveBeenCalledWith(
      expect.objectContaining({ multicallAddress: MULTICALL3_ADDRESS, allowFailure: true }),
    );
  });

  it("reports an unresolved rank as complete:false instead of a fake rank", async () => {
    const client = mockClient([[
      ok([64_593_848_810_000_000_000_000n, 2_319_880_582_609_420_980n, false, 277n]),
      ok([FRONTIER, 1_261_105_063_730_040_375n, 426_007_699_704_189_288_250_721_624n]),
      ok([0n, 426_237_112_372_279_921_076_576_233n, 100n, false]),
    ]]);
    const snap = await readRadar(client, RADAR, ACCOUNT, 100n);
    expect(snap.rank?.rank).toBe(0n);
    expect(snap.rank?.complete).toBe(false);
  });

  it("without an account, skips the rank call and returns rank null", async () => {
    const client = mockClient([[
      ok([64_593_848_810_000_000_000_000n, 2_319_880_582_609_420_980n, false, 277n]),
      ok([FRONTIER, 1_261_105_063_730_040_375n, 426_007_699_704_189_288_250_721_624n]),
    ]]);
    const snap = await readRadar(client, RADAR);
    expect(snap.rank).toBeNull();
    expect((client.multicall as ReturnType<typeof vi.fn>).mock.calls[0][0].contracts).toHaveLength(2);
  });

  it("throws when systemHealth itself fails (hook surfaces the RPC error state)", async () => {
    const client = mockClient([[fail, fail]]);
    await expect(readRadar(client, RADAR)).rejects.toThrow("Radar systemHealth read failed");
  });
});

describe("readMainnetHealth (direct Mezo mainnet reads, no Radar deployed)", () => {
  it("reads the price first, then TCR / Recovery Mode / trove count in one batch", async () => {
    const price = 64_624_438_400_000_000_000_000n;
    const client = mockClient([
      [ok(price)],
      [ok(35_789_167_013_571_154_692n), ok(false), ok(4n)],
    ]);
    const snap = await readMainnetHealth(client);
    expect(snap.network).toBe("mainnet");
    expect(snap.price).toBe(price);
    expect(snap.tcr).toBe(35_789_167_013_571_154_692n);
    expect(snap.recoveryMode).toBe(false);
    expect(snap.troveCount).toBe(4n);
    expect(snap.frontier).toBeNull();
    expect(snap.rank).toBeNull();
    expect(client.multicall).toHaveBeenCalledTimes(2);
    const firstCall = (client.multicall as ReturnType<typeof vi.fn>).mock.calls[0][0] as { contracts: { address: Address; functionName: string }[] };
    expect(firstCall.contracts[0].address).toBe(mainnetAddresses.priceFeed);
    expect(firstCall.contracts[0].functionName).toBe("fetchPrice");
    const secondCall = (client.multicall as ReturnType<typeof vi.fn>).mock.calls[1][0] as { contracts: { functionName: string }[]; allowFailure: boolean };
    expect(secondCall.contracts.map((c) => c.functionName)).toEqual(["getTCR", "checkRecoveryMode", "getSize"]);
    // allowFailure must be true: with false, viem returns raw values, not {status,result} slots.
    expect(secondCall.allowFailure).toBe(true);
  });

  it("throws when the price read fails", async () => {
    const client = mockClient([[fail]]);
    await expect(readMainnetHealth(client)).rejects.toThrow("Mainnet PriceFeed read failed");
  });

  it("throws when the system batch fails", async () => {
    const client = mockClient([[ok(64_624_438_400_000_000_000_000n)], [fail, fail, fail]]);
    await expect(readMainnetHealth(client)).rejects.toThrow("Mainnet system read failed");
  });
});
