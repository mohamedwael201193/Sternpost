import { describe, it, expect } from "vitest";
import { memDb, testApp } from "./helpers.js";

const TEAM_OWNER = "0xf76e6b0920e9332ff4410f6dd53f01722abc71a3";
const TEAM_AGENT = "0xef647815df216c60c061a5c7b6c07e3e45d77ae8";
const OUT_OWNER = "0x2222222222222222222222222222222222222222";
const OUT_AGENT = "0x3333333333333333333333333333333333333333";
const TEAM_ACCT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OUT_ACCT = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const KEEPER = "0x4444444444444444444444444444444444444444";

async function seed(db: any) {
  const ins = (tx: string, log: number, block: number, contract: string, event: string, args: any) =>
    db.query(
      "INSERT INTO activity (tx_hash, log_index, block_number, contract, event, args) VALUES ($1,$2,$3,$4,$5,$6)",
      [tx, log, block, contract, event, JSON.stringify(args)],
    );
  const acctArgs = (owner: string, account: string) => ({
    owner, account, salt: "0x" + "00".repeat(32),
    floorICR: "2500000000000000000", shieldICR: "1600000000000000000", targetICR: "2000000000000000000",
  });
  await ins("0x" + "01".repeat(32), 0, 100, TEAM_ACCT, "AccountCreated", acctArgs(TEAM_OWNER, TEAM_ACCT));
  await ins("0x" + "02".repeat(32), 0, 101, OUT_ACCT, "AccountCreated", acctArgs(OUT_OWNER, OUT_ACCT));
  await ins("0x" + "03".repeat(32), 0, 102, TEAM_ACCT, "SessionOpened",
    { agent: TEAM_AGENT, budget: "5000000000000000000", perTx: "1000000000000000000", dailyLimit: "5000000000000000000", expiry: 1797330675, anyPayee: false, canSignX402: true });
  await ins("0x" + "04".repeat(32), 0, 103, OUT_ACCT, "SessionOpened",
    { agent: OUT_AGENT, budget: "2000000000000000000", perTx: "500000000000000000", dailyLimit: "2000000000000000000", expiry: 1797330675, anyPayee: false, canSignX402: false });
  await ins("0x" + "05".repeat(32), 0, 104, TEAM_ACCT, "Drawn",
    { agent: TEAM_AGENT, payee: OUT_OWNER, amount: "1000000000000000000", fee: "1000000000000000", icrAfter: "2400000000000000000" });
  await ins("0x" + "06".repeat(32), 0, 105, TEAM_ACCT, "Refilled", { agent: TEAM_AGENT, amount: "500000000000000000" });
  await ins("0x" + "07".repeat(32), 0, 106, TEAM_ACCT, "Shielded",
    { keeper: KEEPER, repaid: "10000000000000000000", collAdded: "0", icrBefore: "1500000000000000000", icrAfter: "1600000000000000000", reason: 1, bountyPaid: "1000000000000000000" });
  await ins("0x" + "08".repeat(32), 0, 107, TEAM_ACCT, "Closed", { btcReturned: "10000000000000000", musdReturned: "0" });
  await db.query("INSERT INTO indexer_cursor (id, last_block) VALUES (1, 107)");
  // A sandbox-granted session request against the outside account.
  await db.query(
    `INSERT INTO session_requests (account, agent, purpose, budget, per_tx, daily_limit, days, payees, sandbox, status)
     VALUES ($1,$2,'sandbox trial','5000000000000000000',NULL,'5000000000000000000',7,'[]',TRUE,'sandbox_granted')`,
    [OUT_ACCT, OUT_AGENT],
  );
}

describe("GET /v1/muster", () => {
  it("lists indexed accounts from chain events, team-tagged, with quests and EXP", async () => {
    const db = await memDb();
    await seed(db);
    const { app } = await testApp({
      db,
      muster: { team: [TEAM_OWNER, TEAM_AGENT], now: () => 1_700_000_000_000 },
    });
    const res = await app.request("/v1/muster");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.network).toBe("testnet");
    expect(body.outsideAddresses).toBe(1);
    expect(body.teamAddresses).toBe(1);
    expect(body.sandboxAddresses).toBe(1);
    expect(body.toBlock).toBe("107");
    expect(body.rows).toHaveLength(2);
    const team = body.rows.find((r: any) => r.account === TEAM_ACCT);
    expect(team.team).toBe(true);
    expect(team.agents).toEqual([TEAM_AGENT]);
    expect(team.draws).toBe(1);
    expect(team.totalDrawnMusd).toBe("1000000000000000000");
    expect(team.refills).toBe(1);
    expect(team.shields).toBe(1);
    expect(team.closed).toBe(true);
    expect(team.quests).toEqual(["open_account", "sign_agent", "pay_by_borrow", "survive_shield", "close_clean"]);
    expect(team.exp).toBe(550);
    const out = body.rows.find((r: any) => r.account === OUT_ACCT);
    expect(out.team).toBe(false);
    expect(out.quests).toEqual(["open_account", "sign_agent"]);
    expect(out.exp).toBe(200);
  });

  it("returns an empty roll (not an error) when no account exists yet", async () => {
    const { app } = await testApp({ muster: { team: [TEAM_OWNER] } });
    const res = await app.request("/v1/muster");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.rows).toEqual([]);
    expect(body.outsideAddresses).toBe(0);
  });

  it("refuses mainnet: there is no mainnet account factory", async () => {
    const { app } = await testApp({ muster: { team: [] } });
    const res = await app.request("/v1/muster?network=mainnet");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "mainnet_not_indexed" });
  });

  it("caches for 60s", async () => {
    const db = await memDb();
    await seed(db);
    let t = 1_700_000_000_000;
    const { app } = await testApp({ db, muster: { team: [TEAM_OWNER], now: () => t } });
    const first: any = await (await app.request("/v1/muster")).json();
    await db.query("DELETE FROM activity WHERE event = 'Drawn'");
    const second: any = await (await app.request("/v1/muster")).json();
    expect(second.generatedAt).toBe(first.generatedAt); // cached
    t += 61_000;
    const third: any = await (await app.request("/v1/muster")).json();
    expect(third.rows.find((r: any) => r.account === TEAM_ACCT).draws).toBe(0); // refreshed, Drawn gone
  });
});
