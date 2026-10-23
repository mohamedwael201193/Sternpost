import { Hono } from "hono";
import type { Db } from "../db/pool.js";
import { x402Paywall, type PaywallOpts } from "../x402/paywall.js";

export interface ChainSnapshot { blockNumber: bigint; btcPrice?: string }

/** Paid demo API: a "BTC desk brief" that an agent buys with MUSD drawn through its Sternpost governor. */
export function demoRoutes(db: Db, pay: Omit<PaywallOpts, "description">, snapshot: () => Promise<ChainSnapshot>) {
  const r = new Hono();
  r.get("/paid/brief", x402Paywall(db, { ...pay, description: "Sternpost demo: Mezo testnet desk brief" }), async (c) => {
    const s = await snapshot().catch(() => ({ blockNumber: 0n }) as ChainSnapshot);
    const paid = c.get("x402" as never) as { payer: string; tx: string };
    return c.json({
      brief: "Mezo testnet desk brief",
      chainId: 31611,
      block: String(s.blockNumber),
      btcPrice: s.btcPrice ?? null,
      paidBy: paid.payer,
      settlementTx: paid.tx,
      explorer: `https://explorer.test.mezo.org/tx/${paid.tx}`,
    });
  });
  r.get("/paid/price", (c) => c.json({ asset: pay.asset, amount: pay.amount, payTo: pay.payTo, network: pay.network }));
  return r;
}
