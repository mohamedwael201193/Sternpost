import { describe, it, expect } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Log } from "viem";
import { Indexer, type ChainReader } from "../src/indexer/indexer.js";
import { accountFactoryEvents, accountEvents, factoryEvents, governorEvents } from "../src/indexer/abi.js";
import { memDb } from "./helpers.js";

const ACCT_FACTORY = "0xdddddddddddddddddddddddddddddddddddddddd";
const ACCT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OWNER = "0xf76e6b0920e9332ff4410f6dd53f01722abc71a3";
const AGENT = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const PAYEE = "0xcccccccccccccccccccccccccccccccccccccccc";
const KEEPER = "0x4444444444444444444444444444444444444444";
const GOV = "0x3333333333333333333333333333333333333333";
const CLASSIC_FACTORY = "0xfafafafafafafafafafafafafafafafafafafafa";

const mk = (address: string, abi: any, eventName: string, args: any, data: string, block: bigint, i: number): Log =>
  ({ address, topics: encodeEventTopics({ abi, eventName, args }), data, blockNumber: block, logIndex: i,
     transactionHash: `0x${block.toString(16).padStart(62, "0")}${i.toString(16).padStart(2, "0")}` } as any);

function fakeChain(head: bigint, logs: Log[]): ChainReader {
  return {
    getBlockNumber: async () => head,
    getLogs: async (a) => {
      const addrs = a.address.map((x) => x.toLowerCase());
      return logs.filter((l) => l.blockNumber! >= a.fromBlock && l.blockNumber! <= a.toBlock && addrs.includes(l.address.toLowerCase()));
    },
  };
}

const govCreated = mk(CLASSIC_FACTORY, factoryEvents, "GovernorCreated", { borrower: OWNER },
  encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }],
    [GOV, 25n * 10n ** 17n, 16n * 10n ** 17n]), 9n, 0);
const created = mk(ACCT_FACTORY, accountFactoryEvents, "AccountCreated", { owner: OWNER, account: ACCT },
  encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    ["0x" + "00".repeat(32), 25n * 10n ** 17n, 16n * 10n ** 17n, 2n * 10n ** 18n],
  ), 10n, 0);
const session = mk(ACCT, accountEvents, "SessionOpened", { agent: AGENT },
  encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint64" }, { type: "bool" }, { type: "bool" }],
    [5n * 10n ** 18n, 10n ** 18n, 5n * 10n ** 18n, 1797330675n, false, true],
  ), 11n, 1);
const drawn = mk(ACCT, accountEvents, "Drawn", { agent: AGENT, payee: PAYEE },
  encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    [10n ** 18n, 10n ** 15n, 24n * 10n ** 17n]), 12n, 2);
const refilled = mk(ACCT, accountEvents, "Refilled", { agent: AGENT },
  encodeAbiParameters([{ type: "uint256" }], [5n * 10n ** 17n]), 12n, 3);
const shielded = mk(ACCT, accountEvents, "Shielded", { keeper: KEEPER },
  encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint8" }, { type: "uint256" }],
    [10n ** 19n, 0n, 15n * 10n ** 17n, 16n * 10n ** 17n, 1, 10n ** 18n],
  ), 13n, 4);
// Classic Governor PolicySet must still update the policies mirror (and must
// not be confused with the 5-field Account PolicySet).
const classicPolicy = mk(GOV, governorEvents, "PolicySet", {},
  encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [2n * 10n ** 18n, 21n * 10n ** 17n]), 13n, 5);

describe("indexer: account factory events", () => {
  it("indexes AccountCreated, tracks the account, stores its events, is idempotent", async () => {
    const db = await memDb();
    await db.query(
      "INSERT INTO policies (governor, borrower, floor_icr, defend_icr) VALUES ($1,$2,'2500000000000000000','1600000000000000000')",
      [GOV, OWNER],
    );
    const chain = fakeChain(20n, [govCreated, created, session, drawn, refilled, shielded, classicPolicy]);
    const ix = new Indexer(db, chain, { factory: CLASSIC_FACTORY, startBlock: 1n, maxRange: 100n, accountFactory: ACCT_FACTORY });
    // One tick stores everything: creation and the account's first events land
    // in the same window, and the indexer re-fetches the window after each
    // discovery instead of letting the cursor skip past them.
    expect(await ix.tick()).toBe(7);
    expect(ix.addresses).toContain(ACCT);
    expect(await ix.tick()).toBe(0); // caught up
    const { rows } = await db.query("SELECT event, args FROM activity ORDER BY block_number, log_index");
    expect(rows.map((r: any) => r.event)).toEqual(
      ["GovernorCreated", "AccountCreated", "SessionOpened", "Drawn", "Refilled", "Shielded", "PolicySet"],
    );
    expect(rows[1].args.owner).toBe(OWNER);
    expect(rows[1].args.account).toBe(ACCT);
    expect(rows[3].args.amount).toBe("1000000000000000000");
    const p = await db.query("SELECT floor_icr FROM policies WHERE governor = $1", [GOV]);
    expect(p.rows[0].floor_icr).toBe("2000000000000000000");

    // A fresh indexer reloads the tracked account from stored events and replays nothing.
    const ix2 = new Indexer(db, chain, { factory: CLASSIC_FACTORY, startBlock: 1n, maxRange: 100n, accountFactory: ACCT_FACTORY });
    await ix2.loadTracked();
    expect(ix2.addresses).toContain(ACCT);
    expect(await ix2.tick()).toBe(0);
  });

  it("works without an account factory (Classic-only mode)", async () => {
    const db = await memDb();
    const chain = fakeChain(20n, [created, session]);
    const ix = new Indexer(db, chain, { factory: CLASSIC_FACTORY, startBlock: 1n, maxRange: 100n });
    expect(await ix.tick()).toBe(0); // account factory not tracked
  });
});
