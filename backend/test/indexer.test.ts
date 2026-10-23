import { describe, it, expect } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Log } from "viem";
import { Indexer, type ChainReader } from "../src/indexer/indexer.js";
import { factoryEvents, governorEvents } from "../src/indexer/abi.js";
import { memDb } from "./helpers.js";

const FACTORY = "0xfafafafafafafafafafafafafafafafafafafafa";
const GOV = "0x3333333333333333333333333333333333333333";
const BOR = "0x2222222222222222222222222222222222222222";
const APP = "0x1111111111111111111111111111111111111111";

const mk = (address: string, abi: any, eventName: string, args: any, data: string, block: bigint, i: number): Log =>
  ({ address, topics: encodeEventTopics({ abi, eventName, args }), data, blockNumber: block, logIndex: i,
     transactionHash: `0x${block.toString(16).padStart(62, "0")}${i.toString(16).padStart(2, "0")}` } as any);

function fakeChain(head: bigint, logs: Log[]): ChainReader & { calls: any[] } {
  const calls: any[] = [];
  return {
    calls,
    getBlockNumber: async () => head,
    getLogs: async (a) => {
      calls.push(a);
      const addrs = a.address.map((x) => x.toLowerCase());
      return logs.filter((l) => l.blockNumber! >= a.fromBlock && l.blockNumber! <= a.toBlock && addrs.includes(l.address.toLowerCase()));
    },
  };
}

const created = mk(FACTORY, factoryEvents, "GovernorCreated", { borrower: BOR },
  encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }], [GOV, 15n * 10n ** 17n, 16n * 10n ** 17n]), 10n, 0);
const drawn = mk(GOV, governorEvents, "Drawn", { app: APP, payee: APP },
  encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [10n ** 18n, 3n * 10n ** 18n, 7n]), 12n, 1);
const policy = mk(GOV, governorEvents, "PolicySet", {},
  encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [2n * 10n ** 18n, 21n * 10n ** 17n]), 12n, 2);
const junk = { ...drawn, topics: ["0x" + "ab".repeat(32)], logIndex: 3 } as any;

describe("indexer", () => {
  it("indexes factory, follows new governor, mirrors policy, is idempotent", async () => {
    const db = await memDb();
    const chain = fakeChain(20n, [created, drawn, policy, junk]);
    const ix = new Indexer(db, chain, { factory: FACTORY, startBlock: 1n, maxRange: 10n });
    expect(await ix.tick()).toBe(1); // blocks 1..11: GovernorCreated
    expect(ix.addresses).toContain(GOV);
    expect(await ix.tick()).toBe(2); // 12..20: Drawn + PolicySet, junk skipped
    expect(await ix.tick()).toBe(0); // caught up
    const { rows } = await db.query("SELECT event, args FROM activity ORDER BY block_number, log_index");
    expect(rows.map((r: any) => r.event)).toEqual(["GovernorCreated", "Drawn", "PolicySet"]);
    expect(rows[1].args.amount).toBe("1000000000000000000");
    const p = await db.query("SELECT floor_icr FROM policies WHERE governor = $1", [GOV]);
    expect(p.rows[0].floor_icr).toBe("2000000000000000000");

    await db.query("DELETE FROM indexer_cursor");
    const ix2 = new Indexer(db, chain, { factory: FACTORY, startBlock: 1n, maxRange: 100n });
    await ix2.loadTracked();
    expect(ix2.addresses).toContain(GOV);
    expect(await ix2.tick()).toBe(0); // replay inserts nothing new
  });
  it("start() polls and stop clears the timer; errors are swallowed", async () => {
    const db = await memDb();
    const chain = { getBlockNumber: async () => { throw new Error("rpc down"); }, getLogs: async () => [] };
    const stop = new Indexer(db, chain as any, { factory: FACTORY, startBlock: 1n }).start(5);
    await new Promise((r) => setTimeout(r, 20));
    stop();
  });
});
