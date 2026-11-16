import { Hono } from "hono";
import type { Db } from "../db/pool.js";

/**
 * GET /v1/muster (plan 5.6, task 2.6): the Muster roll — every TroveAccount
 * the indexer saw created by the TroveAccountFactory, with quests and EXP.
 *
 * Source of truth is chain logs only (the indexed `activity` table): NO
 * hardcoded account list. The only hardcoded input is the TEAM_ADDRESSES
 * env list, used solely to tag rows as team and exclude them from the
 * outside count — it never adds an account to the roll.
 *
 * Quests (EXP is non-cash, nothing promised about future use):
 *  open_account 100 (AccountCreated) · sign_agent 100 (SessionOpened) ·
 *  pay_by_borrow 200 (Refilled) · survive_shield 100 (Shielded) ·
 *  close_clean 50 (Closed). Sybil caveat: one person can own several
 *  addresses; the count is of distinct addresses.
 * Testnet only: there is no mainnet account factory, so ?network=mainnet
 * returns 400. 60 s cache.
 */

export const QUEST_EXP: Record<string, number> = {
  open_account: 100,
  sign_agent: 100,
  pay_by_borrow: 200,
  survive_shield: 100,
  close_clean: 50,
};

export interface MusterOpts {
  team: string[];
  cacheMs?: number;
  now?: () => number;
}

interface Row {
  account: string;
  owner: string;
  team: boolean;
  createdBlock: string;
  createdTx: string;
  floorIcr: string;
  shieldIcr: string;
  targetIcr: string;
  agents: string[];
  draws: number;
  totalDrawnMusd: string;
  refills: number;
  shields: number;
  closed: boolean;
  quests: string[];
  exp: number;
}

export async function buildMuster(db: Db, teamSet: Set<string>) {
  const { rows: created } = await db.query(
    "SELECT contract, tx_hash, block_number, args FROM activity WHERE event = 'AccountCreated' ORDER BY block_number, log_index",
  );
  const { rows: events } = await db.query(
    "SELECT contract, event, args FROM activity WHERE event IN ('SessionOpened','Drawn','Refilled','Shielded','Closed') ORDER BY block_number, log_index",
  );
  const { rows: cursor } = await db.query("SELECT last_block FROM indexer_cursor WHERE id = 1");
  let sandbox: { account: string }[] = [];
  try {
    // session_requests exists from migration 6; tolerate older DBs.
    sandbox = (await db.query<{ account: string }>(
      "SELECT DISTINCT account FROM session_requests WHERE sandbox = TRUE AND status = 'sandbox_granted'",
    )).rows;
  } catch {
    sandbox = [];
  }

  const byAccount = new Map<string, Row>();
  for (const r of created as any[]) {
    const a = typeof r.args === "string" ? JSON.parse(r.args) : r.args;
    const account = String(a.account).toLowerCase();
    const owner = String(a.owner).toLowerCase();
    byAccount.set(account, {
      account,
      owner,
      team: teamSet.has(owner),
      createdBlock: String(r.block_number),
      createdTx: String(r.tx_hash),
      floorIcr: String(a.floorICR),
      shieldIcr: String(a.shieldICR),
      targetIcr: String(a.targetICR),
      agents: [],
      draws: 0,
      totalDrawnMusd: "0",
      refills: 0,
      shields: 0,
      closed: false,
      quests: ["open_account"],
      exp: QUEST_EXP.open_account,
    });
  }
  const addQuest = (row: Row, q: string) => {
    if (!row.quests.includes(q)) {
      row.quests.push(q);
      row.exp += QUEST_EXP[q];
    }
  };
  for (const r of events as any[]) {
    const row = byAccount.get(String(r.contract).toLowerCase());
    if (!row) continue; // event from an account whose creation is outside the indexed range
    const a = typeof r.args === "string" ? JSON.parse(r.args) : r.args;
    if (r.event === "SessionOpened") {
      const agent = String(a.agent).toLowerCase();
      if (!row.agents.includes(agent)) row.agents.push(agent);
      // Team tag is owner-based ONLY: an outside owner granting a session
      // to a team agent must not flip the row to team.
      addQuest(row, "sign_agent");
    } else if (r.event === "Drawn") {
      row.draws++;
      row.totalDrawnMusd = (BigInt(row.totalDrawnMusd) + BigInt(a.amount)).toString();
    } else if (r.event === "Refilled") {
      row.refills++;
      addQuest(row, "pay_by_borrow");
    } else if (r.event === "Shielded") {
      row.shields++;
      addQuest(row, "survive_shield");
    } else if (r.event === "Closed") {
      row.closed = true;
      addQuest(row, "close_clean");
    }
  }

  const rows = [...byAccount.values()].sort((x, y) => Number(BigInt(x.createdBlock) - BigInt(y.createdBlock)));
  // Counts are of distinct ADDRESSES (rows), not owners: one owner can hold
  // several accounts, and the field names say Addresses.
  const outsideAddresses = rows.filter((r) => !r.team).length;
  const teamAddresses = rows.filter((r) => r.team).length;
  const sandboxAccounts = new Set(sandbox.map((s) => String(s.account).toLowerCase()));
  return {
    network: "testnet",
    generatedAt: new Date().toISOString(),
    fromBlock: rows.length ? rows[0].createdBlock : null,
    toBlock: cursor.length ? String(cursor[0].last_block) : null,
    outsideAddresses,
    teamAddresses,
    sandboxAddresses: [...sandboxAccounts].filter((a) => byAccount.has(a)).length,
    rows,
  };
}

export function musterRoutes(db: Db, opts: MusterOpts) {
  const teamSet = new Set(opts.team.map((a) => a.toLowerCase()));
  const cacheMs = opts.cacheMs ?? 60_000;
  const now = opts.now ?? (() => Date.now());
  let cache: { at: number; body: unknown } | null = null;
  const r = new Hono();

  r.get("/muster", async (c) => {
    const network = c.req.query("network") ?? "testnet";
    if (network !== "testnet") return c.json({ error: "mainnet_not_indexed" }, 400);
    if (cache && now() - cache.at < cacheMs) return c.json(cache.body as any);
    const body = await buildMuster(db, teamSet);
    cache = { at: now(), body };
    return c.json(body);
  });

  return r;
}
