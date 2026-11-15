import { describe, expect, it } from "vitest";
import { ADDRESSES, CHAIN_ID, loadEnv } from "../src/config.js";
import {
  createContext,
  handleBalance,
  handleGovernorStatus,
  handlePay,
  handlePreviewDraw,
  handleRadar,
  handleX402Quote,
  readSpendWallet,
} from "../src/tools.js";

/**
 * Live tests (plan §5.1): the four spec tools plus the Classic internal
 * helpers return REAL on-chain reads from the 0.9 deployment on Mezo
 * testnet (31611). Nothing is mocked.
 * Run: npm run test:live   (gated on STERNPOST_LIVE_TESTS=1)
 * Outputs are recorded in mcp/LIVE_EVIDENCE.md.
 *
 * Scope note: the Wave 2 system (TroveAccount impl, Factory, Radar,
 * Batcher) IS deployed on live testnet (2026-11-15, task 1.9;
 * `shared/deployments/testnet.json` `accounts`) but NO account has been
 * opened there yet (deploy-19 broadcast: 4 deploy txs, no createAndOpen), so `balance`/`pay` against a live TroveAccount
 * cannot be verified here — their live-testnet assertions are the honest
 * refusal shapes (ACCOUNT_NOT_SET / ACCOUNT_NOT_DEPLOYED / SESSION_INACTIVE),
 * and the full success paths are verified on a testnet fork
 * (test/fork.test.ts, FORK=1). The deployed Radar IS verified live below.
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

  it("balance: no account configured is refused ACCOUNT_NOT_SET (no chain call)", async () => {
    const res = await handleBalance(ctx, {});
    const p = JSON.parse(textOf(res));
    expect(p.refused).toBe(true);
    expect(p.reason).toBe("ACCOUNT_NOT_SET");
  });

  it("balance: a non-TroveAccount address is refused ACCOUNT_NOT_DEPLOYED (real getBytecode read)", async () => {
    const res = await handleBalance(ctx, { account: BORROWER });
    const p = JSON.parse(textOf(res));
    expect(p.refused).toBe(true);
    expect(p.reason).toBe("ACCOUNT_NOT_DEPLOYED");
  });

  it("pay: no account configured is refused ACCOUNT_NOT_SET", async () => {
    const res = await handlePay(ctx, { url: "https://demo.vativ.io/", dryRun: true });
    const p = JSON.parse(textOf(res));
    expect(p.refused).toBe(true);
    expect(p.reason).toBe("ACCOUNT_NOT_SET");
  });

  it("radar: system health + frontier are real reads (no account walk)", async () => {
    const res = await handleRadar(ctx, {});
    const p = JSON.parse(textOf(res));
    expect(p.ok).toBe(true);
    expect(p.network).toBe("testnet");
    expect(p.synthetic).toBe(true);
    expect(p.tcr).toBeGreaterThan(1);
    expect(p.recoveryMode).toBe(false);
    expect(p.troveCount).toBeGreaterThan(0);
    expect(p.of).toBe(p.troveCount);
    expect(p.frontierIcr).toBeGreaterThan(0);
    expect(p.frontierTrove).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it(
    "radar: the Wave-1 wallet ranks in the live list (full walk, real reads)",
    async () => {
      const res = await handleRadar(ctx, { account: BORROWER });
      const p = JSON.parse(textOf(res));
      expect(p.ok).toBe(true);
      expect(p.rank).toBeGreaterThan(0);
      expect(p.rank).toBeLessThanOrEqual(p.of);
      expect(p.complete).toBe(true);
      expect(p.icr).toBeGreaterThan(0);
      expect(Number.parseFloat(p.debtAheadMusd)).toBeGreaterThanOrEqual(0);
    },
    300_000,
  );

  it("radar: the deployed Wave 2 Radar ranks the same wallet (rankSource radar)", async () => {
    // TroveAccountFactory + Radar deployed 2026-11-15 (task 1.9).
    // The Radar's on-chain rank() must work through the tool and agree
    // with the direct walk above (same wallet, same list).
    const radarCtx = createContext({
      ...loadEnv(),
      STERNPOST_RADAR: "0x9Cd95A420e014da798dbFB74833b9D4DEe868be2",
    });
    const res = await handleRadar(radarCtx, { account: BORROWER });
    const p = JSON.parse(textOf(res));
    expect(p.ok).toBe(true);
    expect(p.rankSource).toBe("radar");
    expect(p.rank).toBeGreaterThan(0);
    expect(p.rank).toBeLessThanOrEqual(p.of);
    expect(p.complete).toBe(true);
  });

  it("radar: mainnet is refused without STERNPOST_MAINNET_OK=1", async () => {
    await expect(handleRadar(ctx, { network: "mainnet" })).rejects.toThrow(/mainnet is never served/);
  });

  it("governor_status (internal helper): live floor/defend/buffer/standby/ICR", async () => {
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
    expect(typeof p.standby.deadline).toBe("string");
  });

  it("preview_draw (internal helper): 10 MUSD verdict is a real previewDraw result (allowed iff reason empty)", async () => {
    const res = await handlePreviewDraw(ctx, { app: APP, amountMusd: "10", payee: PAYEE });
    const p = JSON.parse(textOf(res));
    expect(p.ok).toBe(true);
    expect(typeof p.allowed).toBe("boolean");
    expect(typeof p.reason).toBe("string");
    expect(p.allowed).toBe(p.reason === "");
    expect(parseFloat(p.icrAfter)).toBeGreaterThan(0);
    expect(parseFloat(p.floorICR)).toBe(2.5);
  });

  it("preview_draw (internal helper): an oversized draw is refused with a real reason code", async () => {
    const res = await handlePreviewDraw(ctx, { app: APP, amountMusd: "1000000", payee: PAYEE });
    const p = JSON.parse(textOf(res));
    expect(p.ok).toBe(true);
    expect(p.allowed).toBe(false);
    expect(typeof p.reason).toBe("string");
    expect(p.reason.length).toBeGreaterThan(0);
    expect(p.explanation).toBeTruthy();
  });

  it("x402_quote (internal helper): 402 challenge + live payable preview", async () => {
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

  it("balance: chain id is pinned to 31611", () => {
    expect(CHAIN_ID).toBe(31611);
  });
});
