import { describe, it, expect, vi } from "vitest";
import { readAccount, type AccountSnapshot } from "../src/account.js";
import { MULTICALL3_ADDRESS } from "../src/chain.js";
import { testnetAddresses } from "../src/chain.js";
import type { ReadClient } from "../src/read-client.js";
import type { Address } from "viem";

const ACCOUNT = "0x5A1166eC096e12C0C6187695F82B7F4b285389Df" as Address;
const OWNER = "0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3" as Address;

// Live snapshot of the lab demo account read from Mezo testnet @ block 16810643
// (rpc.test.mezo.org, read 2026-11-16 with viem readContract + blockNumber):
// coll 0.05 BTC, principal 2016156232562500000000, interest 52322888132253551,
// price 64608796300000000000000, status 1, MUSD 2433090442561969120, sMUSD
// 61554608535561276641, owner 0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3,
// v2 policy floor/shield/target 1.2/1.5/1.6, bounty 1.0e18, v2 needed()
// [1602234950480101128, 0, 0]. The v3 slots below (policy tuple, status,
// 4-value needed, pendingYield) are SYNTHETIC — logic-test values only, NOT
// live reads: no v3 account exists on testnet at this block (zero
// AccountCreated logs on either factory through 16810643, and the lab
// account's policy()/status()/pendingYield() calls revert at this block), so
// the v3 test exercises the parse branch with invented numbers. Never cite
// them as a live snapshot.

const ok = <T>(result: T) => ({ status: "success", result }) as const;
const fail = { status: "failure", error: new Error("revert") } as const;

/** 15 multicall slots in readAccount order: tm, status, price, musd, smusd, owner, policy, status, neededV3, yield, floorV2, shieldV2, targetV2, bountyV2, neededV2. */
function mockClient(slots: unknown[], btc = 0n): ReadClient {
  return {
    multicall: vi.fn().mockResolvedValue(slots),
    getBalance: vi.fn().mockResolvedValue(btc),
  };
}

const TROVE: readonly [bigint, bigint, bigint, bigint, bigint, bigint] = [
  50_000_000_000_000_000n, // coll 0.05 BTC
  2_016_156_232_562_500_000_000n, // principal
  52_322_888_132_253_551n, // interest @16810643 (live read)
  0n, 0n, 0n, // pending (already folded in by Mezo — must NOT be added again)
];
const PRICE = 64_608_796_300_000_000_000_000n; // $64,608.7963 @16810643 (live read)

function base(): unknown[] {
  return [
    ok(TROVE), ok(1), ok(PRICE),
    ok(2_433_090_442_561_969_120n), // MUSD balance
    ok(61_554_608_535_561_276_641n), // sMUSD balance
    ok(OWNER),
    fail, fail, fail, fail, // v3: policy, status, needed, pendingYield
    fail, fail, fail, fail, fail, // v2: floor, shield, target, bounty, needed
  ];
}

describe("readAccount (Multicall3 batch)", () => {
  it("uses the canonical Multicall3 address", async () => {
    const client = mockClient(base());
    await readAccount(client, ACCOUNT);
    expect(client.multicall).toHaveBeenCalledWith(
      expect.objectContaining({ multicallAddress: MULTICALL3_ADDRESS, allowFailure: true }),
    );
    expect(MULTICALL3_ADDRESS).toBe("0xcA11bde05977b3631167028862bE2a173976CA11");
  });

  it("reads a v3 production account: policy tuple wins, 4-value needed, debt = principal + interest only (SYNTHETIC v3 slots — no v3 account exists on testnet @16810643; branch coverage only, see header)", async () => {
    const slots = base();
    slots[6] = ok([2_500_000_000_000_000_000n, 1_600_000_000_000_000_000n, 2_000_000_000_000_000_000n, 1_000_000_000_000_000_000n, 0n, 20]); // policy (SYNTHETIC)
    slots[7] = ok(1); // status (SYNTHETIC)
    slots[8] = ok([1_562_000_000_000_000_000n, 0n, 0n, 0]); // needed v3 (SYNTHETIC)
    slots[9] = ok(5_000_000_000_000_000n); // pendingYield (SYNTHETIC)
    const snap: AccountSnapshot = await readAccount(mockClient(slots), ACCOUNT);
    expect(snap.version).toBe("v3");
    expect(snap.owner).toBe(OWNER);
    expect(snap.coll).toBe(50_000_000_000_000_000n);
    expect(snap.debt).toBe(2_016_156_232_562_500_000_000n + 52_322_888_132_253_551n);
    expect(snap.price).toBe(PRICE);
    expect(snap.icr).toBe((snap.coll * PRICE) / snap.debt);
    expect(snap.troveStatus).toBe(1);
    expect(snap.floorICR).toBe(2_500_000_000_000_000_000n);
    expect(snap.shieldICR).toBe(1_600_000_000_000_000_000n);
    expect(snap.targetICR).toBe(2_000_000_000_000_000_000n);
    expect(snap.bounty).toBe(1_000_000_000_000_000_000n);
    expect(snap.minDebtAhead).toBe(0n);
    expect(snap.cooldownBlocks).toBe(20);
    expect(snap.needed).toEqual({ icr: 1_562_000_000_000_000_000n, repayWanted: 0n, collWanted: 0n, reason: 0 });
    expect(snap.pendingYield).toBe(5_000_000_000_000_000n);
    expect(snap.balances.musd).toBe(2_433_090_442_561_969_120n);
    expect(snap.balances.smusd).toBe(61_554_608_535_561_276_641n);
  });

  it("reads the lab v2 account: separate policy getters, 3-value needed, reason null", async () => {
    const slots = base();
    slots[10] = ok(1_200_000_000_000_000_000n); // floorICR
    slots[11] = ok(1_500_000_000_000_000_000n); // shieldICR
    slots[12] = ok(1_600_000_000_000_000_000n); // targetICR
    slots[13] = ok(1_000_000_000_000_000_000n); // bounty
    slots[14] = ok([1_602_234_950_480_101_128n, 0n, 0n]); // needed v2 @16810643 (live read)
    const snap = await readAccount(mockClient(slots), ACCOUNT);
    expect(snap.version).toBe("v2");
    expect(snap.floorICR).toBe(1_200_000_000_000_000_000n);
    expect(snap.shieldICR).toBe(1_500_000_000_000_000_000n);
    expect(snap.targetICR).toBe(1_600_000_000_000_000_000n);
    expect(snap.bounty).toBe(1_000_000_000_000_000_000n);
    expect(snap.minDebtAhead).toBeNull();
    expect(snap.needed).toEqual({ icr: 1_602_234_950_480_101_128n, repayWanted: 0n, collWanted: 0n, reason: null });
    expect(snap.pendingYield).toBeNull();
  });

  it("reads a plain trove (not an account contract): version null, trove numbers still present", async () => {
    const slots = base();
    slots[5] = fail; // owner reverts: not a contract / not an account
    const snap = await readAccount(mockClient(slots), OWNER);
    expect(snap.version).toBeNull();
    expect(snap.owner).toBeNull();
    expect(snap.coll).toBe(50_000_000_000_000_000n);
    expect(snap.debt).toBeGreaterThan(0n);
  });

  it("throws when the core TroveManager read fails: a dead RPC must surface as an error, never as an empty trove (coll 0 / debt 0 / ICR 2**255 renders as '999%' / 'No debt')", async () => {
    const slots = base();
    slots[0] = fail; // getEntireDebtAndColl fails: the whole batch is dead (viem returns failure slots for every contract when the transport fails)
    await expect(readAccount(mockClient(slots), ACCOUNT)).rejects.toThrow("TroveManager read failed");
  });

  it("throws when the price feed read fails", async () => {
    const slots = base();
    slots[2] = fail; // fetchPrice fails
    await expect(readAccount(mockClient(slots), ACCOUNT)).rejects.toThrow("PriceFeed read failed");
  });

  it("a failed BTC balance read is null (unreadable), never a silent 0", async () => {
    const client = mockClient(base());
    (client.getBalance as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("transport died between calls"));
    const snap = await readAccount(client, ACCOUNT);
    expect(snap.balances.btc).toBeNull();
  });

  it("reads against the deployed Mezo addresses by default", async () => {
    const client = mockClient(base());
    await readAccount(client, ACCOUNT);
    const contracts = (client.multicall as ReturnType<typeof vi.fn>).mock.calls[0][0].contracts as { address: string }[];
    expect(contracts[0].address.toLowerCase()).toBe(testnetAddresses.troveManager.toLowerCase());
    expect(contracts[2].address.toLowerCase()).toBe(testnetAddresses.priceFeed.toLowerCase());
    expect(contracts[3].address.toLowerCase()).toBe(testnetAddresses.musd.toLowerCase());
  });
});
