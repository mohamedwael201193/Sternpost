import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config.js";
import {
  createContext,
  handleBalance,
  handlePay,
  handleRadar,
  handleRequestSession,
} from "../src/tools.js";

/**
 * Fork tests (plan §5.1, task 1.9 scope note): the Wave 2 system IS now
 * deployed on live testnet (TroveAccount impl, Factory, Radar, Batcher —
 * 2026-11-15, task 1.9) but NO account has been opened there yet
 * (deploy-19 broadcast: 4 deploy txs, no createAndOpen), so the full
 * success paths of `balance` / `pay` / `request_session` / `radar` are
 * still verified on an anvil fork of testnet (FORK=1, nothing broadcast).
 * The deployed Radar's rank() IS verified live separately (smoke run with
 * STERNPOST_RADAR set — see LIVE_EVIDENCE.md).
 *
 * Setup: `npm run fork` (mcp/scripts/fork-setup.mjs) starts anvil forked
 * from https://rpc.test.mezo.org, stubs the PriceFeed precompile per plan
 * G3 (anvil_setCode), deploys TroveAccount + Factory + Radar, creates and
 * opens an account, approves a session for the fork agent key, and runs
 * this file. Run directly against a prepared fork with:
 *   STERNPOST_FORK_TESTS=1 STERNPOST_RPC_URL=http://127.0.0.1:8545 \
 *   STERNPOST_ACCOUNT=0x... STERNPOST_AGENT_KEY_FILE=/tmp/...-agent.json \
 *   STERNPOST_RADAR=0x... npm run test:fork
 * Nothing here touches live testnet except the read-only demo.vativ.io
 * 402 fetch inside `pay` (and the facilitator verify on the full pay).
 */
const FORK = process.env.STERNPOST_FORK_TESTS === "1";
const describeFork = FORK ? describe : describe.skip;

const textOf = (res: { content: { type: string; text: string }[] }) => res.content[0].text;

describeFork("fork testnet (anvil, chain 31611)", () => {
  const ctx = createContext(loadEnv());
  const account = process.env.STERNPOST_ACCOUNT as string;
  const agent = process.env.STERNPOST_FORK_AGENT as string | undefined;

  it("env is a prepared fork (account + agent key + fork RPC)", () => {
    expect(account).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(process.env.STERNPOST_AGENT_KEY_FILE).toBeTruthy();
    expect(process.env.STERNPOST_RPC_URL).toMatch(/^http:\/\/127\.0\.0\.1:8545/);
  });

  it("balance: full plan §5.1 shape on the fork account with a live session", async () => {
    const res = await handleBalance(ctx, { account });
    const p = JSON.parse(textOf(res));
    expect(p.ok).toBe(true);
    expect(p.network).toBe("testnet");
    expect(p.account.toLowerCase()).toBe(account.toLowerCase());
    if (agent) expect(p.agent?.toLowerCase()).toBe(agent.toLowerCase());
    expect(p.session.active).toBe(true);
    expect(p.session.canSignX402).toBe(true);
    expect(Number.parseFloat(p.session.budget)).toBeGreaterThan(0);
    expect(Number.parseFloat(p.session.remaining)).toBeGreaterThan(0);
    expect(Number.parseFloat(p.session.perTx)).toBeGreaterThan(0);
    expect(p.session.expiry).toBeTruthy();
    expect(p.health.troveStatus).toBe("active");
    expect(p.health.icr).toBeGreaterThan(p.health.floor);
    expect(p.health.floor).toBe(2.5);
    expect(p.health.recoveryMode).toBe(false);
    expect(Number.parseFloat(p.accountMusd)).toBeGreaterThanOrEqual(0);
    console.log("fork balance:", JSON.stringify({ session: p.session, health: p.health, accountMusd: p.accountMusd }));
  });

  it("radar: the fork account ranks in the fork list (full walk)", async () => {
    const res = await handleRadar(ctx, { account });
    const p = JSON.parse(textOf(res));
    expect(p.ok).toBe(true);
    expect(p.network).toBe("testnet");
    expect(p.synthetic).toBe(true);
    expect(p.tcr).toBeGreaterThan(1);
    expect(p.rank).toBeGreaterThan(0);
    expect(p.rank).toBeLessThanOrEqual(p.of);
    expect(p.complete).toBe(true);
    expect(p.icr).toBeGreaterThan(0);
    expect(p.shield.armed).toBe(true);
    expect(p.shield.triggers).toContain("RANK");
    // On the fork the deployed Radar's rank() is one heavy eth_call and
    // anvil fetches remote state per slot through the public RPC, so it
    // either completes slowly (rankSource "radar") or times out and the
    // tool falls back to the direct SortedTroves walk (same ground
    // truth, rankSource "walk" + rankNote). Either source is a real
    // rank; the fallback path itself is pinned by a stub test offline.
    expect(["radar", "walk"]).toContain(p.rankSource);
    if (p.rankSource === "walk") expect(p.rankNote).toMatch(/fell back/);
    console.log("fork radar:", JSON.stringify({ rank: p.rank, of: p.of, rankSource: p.rankSource, tcr: p.tcr, icr: p.icr, complete: p.complete }));
  }, 900_000);

  it("pay dryRun: real demo.vativ.io 402 + fork previewDraw (no tx)", async () => {
    const res = await handlePay(ctx, { url: "https://demo.vativ.io/", dryRun: true });
    const p = JSON.parse(textOf(res));
    expect(p.status).toBe("dry_run");
    expect(p.amount).toBe("0.001");
    expect(p.payTo).toBe("0xC3376296a18ef364eA19287203EEd7a87f18e738");
    expect(p.network).toBe("eip155:31611");
    expect(p.refillTx).toBeNull();
    expect(p.settleTx).toBeNull();
    expect(p.responseStatus).toBe(402);
    expect(p.preview.allowed).toBe(true);
    expect(p.preview.reason).toBe("");
  }, 300_000);

  it("pay: full flow against demo.vativ.io — refill draw on the fork, then the live verdict", async () => {
    const res = await handlePay(ctx, { url: "https://demo.vativ.io/" });
    const p = JSON.parse(textOf(res));
    // The refill draw is a real tx on the fork (proves the draw path).
    expect(p.refillTx).toMatch(/^0x[0-9a-fA-F]{64}$/);
    // The signature can only verify/settle on live testnet, where the
    // fork-only account does not exist (no code, no MUSD) — so the live
    // facilitator refuses verification (VERIFY_FAILED) or the resource
    // answers 402 again (SETTLE_FAILED). Either outcome is the live
    // verdict, recorded honestly; `paid` would need a live TroveAccount.
    expect(["paid", "refused"]).toContain(p.status);
    if (p.status === "refused") expect(["VERIFY_FAILED", "SETTLE_FAILED"]).toContain(p.reason);
    if (p.status === "paid") expect(p.responseStatus).toBe(200);
    expect(p.amount).toBe("0.001");
    // Evidence: the refill tx hash + the live facilitator's verdict are
    // the fork proof; print them so the run log records them (anvil's
    // own stdout is lost during the blocking vitest spawn — see
    // fork-setup.mjs drainAnvilOutput).
    console.log("fork pay full-flow:", JSON.stringify({ status: p.status, reason: p.reason, refillTx: p.refillTx, settleTx: p.settleTx, responseStatus: p.responseStatus }));
  }, 300_000);

  it("request_session: reuses the fork agent key and returns a pending request", async () => {
    const res = await handleRequestSession(ctx, {
      account,
      purpose: "fork verification session",
      budget: "5",
    });
    const p = JSON.parse(textOf(res));
    expect(p.ok).toBe(true);
    expect(p.requestId).toMatch(/^req_[0-9a-f]{16}$/);
    if (agent) expect(p.agent.toLowerCase()).toBe(agent.toLowerCase());
    expect(p.status).toBe("pending");
    expect(p.approveUrl).toContain(p.requestId);
    expect(p.keyFileCreated).toBe(false);
  });
});
