import { Hono } from "hono";
import type { Context } from "hono";
import type { Address } from "viem";
import type { Db } from "../db/pool.js";
import { x402Paywall, type PaywallOpts } from "../x402/paywall.js";
import { GATEWAY_PRICES, PREVIEW_REASON_NAMES } from "./prices.js";
import type { GatewayChainReader } from "./chain.js";

/**
 * x402 gateway routes (plan §5.3). Every paid route answers 402 with a
 * correct `payment-required` header first; after the facilitator settles,
 * the handler serves live testnet data. Free routes: the price table.
 *
 * Mounted under `/v1` in `app.ts`, so the routes are
 * `/v1/radar/:account`, `/v1/preview-draw`, `/v1/risk-report`,
 * `/v1/gateway/prices`. Testnet (31611) only: the reader only knows testnet
 * contracts, and there is no mainnet path in this module.
 */

export interface GatewayOpts {
  pay: Omit<PaywallOpts, "description" | "amount">;
  amounts: { radar: string; previewDraw: string; riskReport: string };
  reader: GatewayChainReader;
}

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const AMOUNT = /^\d+$/;
const EXPLORER = "https://explorer.test.mezo.org/tx/";

const b = (v: bigint) => v.toString();
const paidOf = (c: Context) => c.get("x402" as never) as { payer: string; tx: string };

/** Address params are validated BEFORE the paywall, so a malformed address is a 400, never a 402. */
function requireAddress(param: string) {
  return async (c: Context, next: () => Promise<void>) => {
    if (!ADDR.test(c.req.param(param) ?? "")) return c.json({ error: "invalid_address" }, 400);
    await next();
  };
}

/**
 * Preview-draw query params are validated BEFORE the paywall, mirroring
 * requireAddress: a malformed request is a 400 and is never charged
 * (J3 F1, round re-check — the old in-handler check ran after settlement).
 */
function requirePreviewParams() {
  return async (c: Context, next: () => Promise<void>) => {
    const q = c.req.query();
    const account = q.account ?? "";
    const agent = q.agent ?? "";
    const payee = q.payee ?? "";
    const amount = q.amount ?? "";
    if (!ADDR.test(account) || !ADDR.test(agent) || !ADDR.test(payee) || !AMOUNT.test(amount)) {
      return c.json({ error: "invalid_params", want: "?account=0x..&agent=0x..&payee=0x..&amount=<MUSD wei>" }, 400);
    }
    await next();
  };
}

/**
 * Risk-report body is validated BEFORE the paywall, mirroring
 * requireAddress: a malformed body is a 400 and is never charged
 * (J3 F1, round re-check). The parsed body is stashed on the context so
 * the handler does not re-parse it.
 */
function requireRiskBody() {
  return async (c: Context, next: () => Promise<void>) => {
    const body: unknown = await c.req.json().catch(() => null);
    const account = (body as { account?: unknown } | null)?.account;
    if (typeof account !== "string" || !ADDR.test(account)) {
      return c.json({ error: "invalid_params", want: '{ "account": "0x.." }' }, 400);
    }
    c.set("riskBody" as never, body);
    await next();
  };
}

export function gatewayRoutes(db: Db, o: GatewayOpts) {
  const r = new Hono();

  /** Free: the §5.3 price table, verbatim (PROPOSED, not market-tested). */
  r.get("/gateway/prices", (c) =>
    c.json({
      network: o.pay.network,
      asset: o.pay.asset,
      payTo: o.pay.payTo,
      note: "Prices are PROPOSED, not market-tested (plan §5.3). MUSD wei (18 decimals).",
      routes: GATEWAY_PRICES,
    }),
  );

  r.get(
    "/radar/:account",
    requireAddress("account"),
    x402Paywall(db, { ...o.pay, amount: o.amounts.radar, description: GATEWAY_PRICES.radar.description }),
    async (c) => {
      const account = c.req.param("account") as Address;
      const snap = await o.reader.readRadar(account).catch(() => null);
      if (!snap) return c.json({ error: "radar_unavailable" }, 502);
      const paid = paidOf(c);
      return c.json({
        account: account.toLowerCase(),
        network: o.pay.network,
        synthetic: snap.synthetic,
        price: b(snap.price),
        tcr: b(snap.tcr),
        recoveryMode: snap.recoveryMode,
        troveCount: b(snap.troveCount),
        frontier: snap.frontier
          ? { trove: snap.frontier.trove.toLowerCase(), icr: b(snap.frontier.icr), debt: b(snap.frontier.debt) }
          : null,
        rank: snap.rank
          ? { rank: b(snap.rank.rank), debtAhead: b(snap.rank.debtAhead), steps: b(snap.rank.steps), complete: snap.rank.complete }
          : null,
        paidBy: paid.payer,
        settlementTx: paid.tx,
        explorer: `${EXPLORER}${paid.tx}`,
      });
    },
  );

  r.get(
    "/preview-draw",
    requirePreviewParams(),
    x402Paywall(db, { ...o.pay, amount: o.amounts.previewDraw, description: GATEWAY_PRICES.previewDraw.description }),
    async (c) => {
      const q = c.req.query();
      const account = q.account as Address;
      const agent = q.agent as Address;
      const payee = q.payee as Address;
      const amount = q.amount as string;
      const res = await o.reader
        .readPreviewDraw(account as Address, agent as Address, payee as Address, BigInt(amount))
        .catch(() => null);
      if (!res) return c.json({ error: "preview_unavailable" }, 502);
      const paid = paidOf(c);
      return c.json({
        account: account.toLowerCase(),
        agent: agent.toLowerCase(),
        payee: payee.toLowerCase(),
        amount,
        network: o.pay.network,
        ok: res.ok,
        reasonCode: res.reasonCode,
        reason: PREVIEW_REASON_NAMES[res.reasonCode] ?? "UNKNOWN",
        icrAfter: b(res.icrAfter),
        fee: b(res.fee),
        paidBy: paid.payer,
        settlementTx: paid.tx,
        explorer: `${EXPLORER}${paid.tx}`,
      });
    },
  );

  r.post(
    "/risk-report",
    requireRiskBody(),
    x402Paywall(db, { ...o.pay, amount: o.amounts.riskReport, description: GATEWAY_PRICES.riskReport.description }),
    async (c) => {
      const account = (c.get("riskBody" as never) as { account: string }).account as Address;
      const risk = await o.reader.readRisk(account as Address).catch(() => null);
      if (!risk) return c.json({ error: "risk_unavailable" }, 502);
      // Recent on-chain activity for this account (indexer) + recent gateway receipts it paid for.
      const events = await db
        .query(
          `SELECT tx_hash, log_index, block_number, event, args FROM activity
           WHERE lower(contract) = $1 ORDER BY block_number DESC, log_index DESC LIMIT 10`,
          [account.toLowerCase()],
        )
        .then((x) => x.rows)
        .catch(() => []);
      const receipts = await db
        .query(
          `SELECT tx_hash, amount, resource, created_at FROM receipts
           WHERE lower(payer) = $1 ORDER BY created_at DESC LIMIT 10`,
          [account.toLowerCase()],
        )
        .then((x) => x.rows)
        .catch(() => []);
      const paid = paidOf(c);
      return c.json({
        account: account.toLowerCase(),
        network: o.pay.network,
        status: risk.status,
        icr: b(risk.icr),
        price: b(risk.price),
        tcr: b(risk.tcr),
        recoveryMode: risk.recoveryMode,
        troveCount: b(risk.troveCount),
        rank: risk.rank
          ? { rank: b(risk.rank.rank), debtAhead: b(risk.rank.debtAhead), steps: b(risk.rank.steps), complete: risk.rank.complete }
          : null,
        policy: {
          floorICR: b(risk.policy.floorICR),
          shieldICR: b(risk.policy.shieldICR),
          targetICR: b(risk.policy.targetICR),
          bounty: b(risk.policy.bounty),
          minDebtAhead: b(risk.policy.minDebtAhead),
          cooldownBlocks: b(risk.policy.cooldownBlocks),
        },
        shieldWanted: risk.shieldWanted,
        shieldReasons: risk.shieldReasons,
        recentEvents: events,
        recentReceipts: receipts,
        paidBy: paid.payer,
        settlementTx: paid.tx,
        explorer: `${EXPLORER}${paid.tx}`,
      });
    },
  );

  return r;
}
