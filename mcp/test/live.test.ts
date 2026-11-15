import { describe, expect, it } from "vitest";
import { ADDRESSES, CHAIN_ID, loadEnv } from "../src/config.js";
import {
  createContext,
  handleBalance,
  handleGovernorStatus,
  handlePreviewDraw,
  handleX402Quote,
  readSpendWallet,
} from "../src/tools.js";

/**
 * Live tests (plan §2.1): every tool returns a REAL on-chain read from the
 * 0.9 deployment on Mezo testnet (31611). Nothing is mocked.
 * Run: npm run test:live   (gated on STERNPOST_LIVE_TESTS=1)
 * Outputs are recorded in mcp/LIVE_EVIDENCE.md.
 */
const LIVE = process.env.STERNPOST_LIVE_TESTS === "1";
const describeLive = LIVE ? describe : describe.skip;

// Known live actors from shared/deployments/testnet.json (0.9 redeploy).
const BORROWER = "0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3";
const APP = "0x0508F05fD26811139cf0C3e139FD692Ae7612D1E";
const PAYEE = ADDRESSES.spendWallet;

const textOf = (res: { content: { type: string; text: string }[] }) => res.content[0].text;

describeLive("live testnet reads (chain 31611)", () => {
  const ctx = createContext(loadEnv());

  it("balance: borrower MUSD + BTC balances are real reads", async () => {
    const res = await handleBalance(ctx, { address: BORROWER });
    const p = JSON.parse(textOf(res));
    expect(p.ok).toBe(true);
    expect(p.chainId).toBe(CHAIN_ID);
    expect(p.address.toLowerCase()).toBe(BORROWER.toLowerCase());
    expect(p.musd.symbol).toBe("MUSD");
    expect(BigInt(p.musd.balanceWei)).toBeGreaterThanOrEqual(0n);
    expect(BigInt(p.btc.balanceWei)).toBeGreaterThan(0n);
  });

  it("governor_status: live floor/defend/buffer/standby/ICR", async () => {
    const res = await handleGovernorStatus(ctx, {});
    const p = JSON.parse(textOf(res));
    expect(p.ok).toBe(true);
    expect(p.governor.toLowerCase()).toBe(ADDRESSES.governor.toLowerCase());
    expect(p.factoryRecognised).toBe(true);
    expect(p.floorICR).toBe("2.5");
    expect(p.defendICR).toBe("1.6");
    expect(p.frozen).toBe(false);
    expect(parseFloat(p.icr)).toBeGreaterThan(0);
    expect(p.borrower.toLowerCase()).toBe(BORROWER.toLowerCase());
    expect(p.feeBps).toBe(10);
  });

  it("preview_draw: 10 MUSD verdict is a real previewDraw result (allowed iff reason empty)", async () => {
    const res = await handlePreviewDraw(ctx, { app: APP, amountMusd: "10", payee: PAYEE });
    const p = JSON.parse(textOf(res));
    expect(p.ok).toBe(true);
    expect(typeof p.allowed).toBe("boolean");
    expect(typeof p.reason).toBe("string");
    expect(p.allowed).toBe(p.reason === "");
    expect(parseFloat(p.icrAfter)).toBeGreaterThan(0);
    expect(parseFloat(p.floorICR)).toBe(2.5);
  });

  it("preview_draw: an oversized draw is refused with a real reason code", async () => {
    const res = await handlePreviewDraw(ctx, { app: APP, amountMusd: "1000000", payee: PAYEE });
    const p = JSON.parse(textOf(res));
    expect(p.ok).toBe(true);
    expect(p.allowed).toBe(false);
    expect(typeof p.reason).toBe("string");
    expect(p.reason.length).toBeGreaterThan(0);
    expect(p.explanation).toBeTruthy();
  });

  it("x402_quote: 402 challenge + live payable preview", async () => {
    const res = await handleX402Quote(ctx, { route: "radar", app: APP, payee: PAYEE });
    const p = JSON.parse(textOf(res));
    expect(p.ok).toBe(true);
    expect(p.challenge.error).toBe("payment_required");
    expect(p.challenge.accepts[0].network).toBe("eip155:31611");
    expect(p.challenge.accepts[0].asset.toLowerCase()).toBe(ADDRESSES.musd.toLowerCase());
    expect(p.payable).not.toBeNull();
    expect(typeof p.payable.allowed).toBe("boolean");
    expect(typeof p.payable.reason).toBe("string");
  });

  it("spend wallet: agent + expiry + owner are real reads", async () => {
    const w = await readSpendWallet(ctx, ADDRESSES.spendWallet as `0x${string}`);
    expect(w.owner.toLowerCase()).toBe(BORROWER.toLowerCase());
    expect(w.agent).toBe("0x62a4773191747994c0368664cA68BC476897c1d9");
    expect(w.agentExpiry).toBe(1797330675);
  });

  it("sandbox=false is refused by every tool without touching the chain", async () => {
    for (const res of [
      await handleBalance(ctx, { address: BORROWER, sandbox: false }),
      await handleGovernorStatus(ctx, { sandbox: false }),
      await handlePreviewDraw(ctx, { app: APP, amountMusd: "1", payee: PAYEE, sandbox: false }),
      await handleX402Quote(ctx, { route: "radar", sandbox: false }),
    ]) {
      const p = JSON.parse(textOf(res));
      expect(p.refused).toBe(true);
      expect(p.reason).toBe("SANDBOX_REQUIRED");
    }
  });
});
