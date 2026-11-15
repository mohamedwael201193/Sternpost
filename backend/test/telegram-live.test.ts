import { describe, it, expect } from "vitest";
import { createPublicClient, http, defineChain } from "viem";
import { viemChain, type Hex } from "../src/telegram/chain.js";
import { deploymentFileAddresses, SORTED_TROVES_TESTNET } from "../src/deployments.js";

/**
 * Live smoke check against testnet 31611 (read-only calls only).
 * Skipped unless LIVE_RPC=1, so CI never depends on the public RPC.
 * Run: LIVE_RPC=1 npx vitest run test/telegram-live.test.ts
 */
const LIVE = process.env.LIVE_RPC === "1";
const maybe = LIVE ? describe : describe.skip;

maybe("telegram chain: live testnet smoke (LIVE_RPC=1)", () => {
  it("radar + crew read live from the 0.9 deployment on 31611", async () => {
    const a = deploymentFileAddresses();
    expect(a.factory, "testnet.json must supply the 0.9 Factory").toBe("0x39779A8678424CF78c841F9AfEa1EAFF3Cf7F6d8");
    expect(a.governor, "testnet.json must supply the 0.9 Governor").toBe("0x1bF45cFE654a397F4FF3B33bC1b157c88Ee71F38");
    const chain = defineChain({
      id: 31611,
      name: "Mezo Testnet",
      nativeCurrency: { name: "BTC", symbol: "BTC", decimals: 18 },
      rpcUrls: { default: { http: ["https://rpc.test.mezo.org"] } },
    });
    const client = createPublicClient({ chain, transport: http("https://rpc.test.mezo.org", { batch: true, timeout: 30_000 }) });
    const reader = viemChain(client as any, {
      factory: a.factory as Hex,
      musd: a.musd as Hex,
      mezo: "0x7B7c000000000000000000000000000000000001",
      troveManager: a.troveManager as Hex,
      priceFeed: a.priceFeed as Hex,
      sortedTroves: SORTED_TROVES_TESTNET as Hex,
    });
    const borrower = a.borrower as Hex; // demo borrower 0xf76e…71a3
    const r = await reader.radar(borrower);
    expect(r.price).toBeGreaterThan(0n);
    expect(r.tcr).toBeGreaterThan(0n);
    expect(r.troveCount).toBeGreaterThan(0n);
    expect(r.frontier).not.toBeNull();
    expect(r.mine.status).toBe(1); // the demo borrower's trove is active
    expect(r.mine.debt).toBeGreaterThan(0n);
    expect(r.steps).toBeLessThanOrEqual(20);
    const k = await reader.crew(borrower);
    expect(k.governor?.toLowerCase()).toBe(a.governor!.toLowerCase());
    expect(k.govStatus).not.toBeNull();
    expect(k.govStatus!.floor).toBeGreaterThan(0n);
    expect(k.wallets.map((w) => w.address.toLowerCase())).toContain(a.spendWallet!.toLowerCase());
  }, 180_000);
});
