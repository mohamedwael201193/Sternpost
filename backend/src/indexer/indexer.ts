import type { Abi, Log } from "viem";
import { decodeEventLog } from "viem";
import type { Db } from "../db/pool.js";
import { allAccountEvents } from "./abi.js";
import { logger } from "../logger.js";

export interface ChainReader {
  getBlockNumber(): Promise<bigint>;
  getLogs(args: { address: `0x${string}`[]; fromBlock: bigint; toBlock: bigint }): Promise<Log[]>;
}

const json = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : typeof x === "string" ? x.toLowerCase() : x));

export interface IndexerOpts {
  factory: `0x${string}`;
  startBlock: bigint;
  maxRange?: bigint;
  /** Wave 2 TroveAccountFactory. When set, AccountCreated + every account event is indexed and the account is tracked. */
  accountFactory?: `0x${string}`;
}

/** Polls Factory + every Governor/SpendWallet/TroveAccount it created, decodes events into `activity`. Idempotent. */
export class Indexer {
  private tracked = new Set<string>();
  constructor(private db: Db, private chain: ChainReader, private opts: IndexerOpts) {
    this.tracked.add(opts.factory.toLowerCase());
    if (opts.accountFactory) this.tracked.add(opts.accountFactory.toLowerCase());
  }

  async loadTracked() {
    const { rows } = await this.db.query<{ args: any; event: string }>(
      "SELECT event, args FROM activity WHERE event IN ('GovernorCreated','SpendWalletCreated','AccountCreated')",
    );
    for (const r of rows) {
      const a = typeof r.args === "string" ? JSON.parse(r.args) : r.args;
      this.tracked.add(String(a.governor ?? a.wallet ?? a.account).toLowerCase());
    }
  }

  get addresses() { return [...this.tracked] as `0x${string}`[]; }

  async cursor(): Promise<bigint> {
    const { rows } = await this.db.query<{ last_block: string }>("SELECT last_block FROM indexer_cursor WHERE id = 1");
    return rows.length ? BigInt(rows[0].last_block) : this.opts.startBlock - 1n;
  }

  /** Runs one polling step. Returns number of events stored. */
  async tick(): Promise<number> {
    const head = await this.chain.getBlockNumber();
    let from = (await this.cursor()) + 1n;
    if (from > head) return 0;
    const to = head - from > (this.opts.maxRange ?? 2000n) ? from + (this.opts.maxRange ?? 2000n) : head;
    let stored = 0;
    // A contract discovered mid-window (AccountCreated / GovernorCreated)
    // must have its events in the SAME window indexed too: without a
    // re-fetch, the cursor would advance past its first events and they
    // would be lost forever. Re-fetch the window with the expanded address
    // set until no new address appears (bounded; inserts are idempotent).
    for (let pass = 0; pass < 3; pass++) {
      const logs = await this.chain.getLogs({ address: this.addresses, fromBlock: from, toBlock: to });
      let discovered = false;
      for (const log of logs) {
        let decoded;
        try {
          decoded = decodeEventLog({ abi: allAccountEvents as Abi, data: log.data, topics: log.topics as any });
        } catch {
          continue;
        }
        const args = (decoded.args ?? {}) as Record<string, unknown>;
        const contract = log.address.toLowerCase();
        const res = await this.db.query(
          `INSERT INTO activity (tx_hash, log_index, block_number, contract, event, args)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tx_hash, log_index) DO NOTHING RETURNING id`,
          [log.transactionHash!.toLowerCase(), log.logIndex, String(log.blockNumber), contract, decoded.eventName, json(args)],
        );
        stored += res.rows.length;
        if (decoded.eventName === "AccountCreated") {
          const a = String(args.account).toLowerCase();
          if (!this.tracked.has(a)) { this.tracked.add(a); discovered = true; }
        } else if (decoded.eventName === "GovernorCreated") {
          const g = String(args.governor).toLowerCase();
          if (!this.tracked.has(g)) {
            this.tracked.add(g);
            discovered = true;
          }
          await this.db.query(
            `INSERT INTO policies (governor, borrower, floor_icr, defend_icr) VALUES ($1,$2,$3,$4)
             ON CONFLICT (governor) DO UPDATE SET floor_icr = EXCLUDED.floor_icr, defend_icr = EXCLUDED.defend_icr, updated_at = now()`,
            [g, String(args.borrower).toLowerCase(), String(args.floorICR), String(args.defendICR)],
          );
        } else if (decoded.eventName === "SpendWalletCreated") {
          const w = String(args.wallet).toLowerCase();
          if (!this.tracked.has(w)) { this.tracked.add(w); discovered = true; }
        } else if (decoded.eventName === "PolicySet" && args.defendICR !== undefined) {
          // Classic Governor PolicySet only: the Account PolicySet has 5 fields
          // (floor/shield/target/bounty/minDebtAhead) and no defendICR.
          await this.db.query("UPDATE policies SET floor_icr = $1, defend_icr = $2, updated_at = now() WHERE governor = $3", [
            String(args.floorICR), String(args.defendICR), contract,
          ]);
        }
      }
      if (!discovered) break;
    }
    await this.db.query(
      "INSERT INTO indexer_cursor (id, last_block) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET last_block = EXCLUDED.last_block",
      [String(to)],
    );
    if (stored) logger.info({ from: String(from), to: String(to), stored }, "indexed events");
    return stored;
  }

  start(intervalMs: number) {
    let running = false;
    const t = setInterval(async () => {
      if (running) return;
      running = true;
      try { await this.tick(); } catch (err) { logger.warn({ err: String(err) }, "indexer tick failed"); }
      finally { running = false; }
    }, intervalMs);
    return () => clearInterval(t);
  }
}
