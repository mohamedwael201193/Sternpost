import type { Context, MiddlewareHandler } from "hono";
import type { Db } from "../db/pool.js";
import { logger } from "../logger.js";

export interface PaywallOpts {
  facilitatorUrl: string;
  network: string; // e.g. eip155:31611
  asset: `0x${string}`;
  payTo: `0x${string}`;
  amount: string;
  description: string;
  fetchFn?: typeof fetch;
  /** Confirms a tx on chain when the facilitator times out waiting for its receipt. */
  confirmTx?: (hash: `0x${string}`) => Promise<boolean>;
}

export const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const unb64 = (s: string) => JSON.parse(Buffer.from(s, "base64").toString("utf8"));

export function requirements(o: PaywallOpts) {
  return {
    scheme: "exact",
    network: o.network,
    asset: o.asset,
    amount: o.amount,
    payTo: o.payTo,
    maxTimeoutSeconds: 300,
    extra: { name: "Mezo USD", version: "1", assetTransferMethod: "permit2" },
  };
}

/** x402 v2 seller middleware: 402 challenge -> facilitator verify -> settle -> receipt row. */
export function x402Paywall(db: Db, o: PaywallOpts): MiddlewareHandler {
  const f = o.fetchFn ?? fetch;
  return async (c: Context, next) => {
    const req = requirements(o);
    const resource = { url: c.req.url, description: o.description, mimeType: "application/json" };
    const challenge = { x402Version: 2, error: "payment_required", resource, accepts: [req] };
    const header = c.req.header("payment-signature") ?? c.req.header("x-payment");
    if (!header) {
      c.header("PAYMENT-REQUIRED", b64(challenge));
      return c.json(challenge, 402);
    }
    let payload: any;
    try { payload = unb64(header); } catch { return c.json({ ...challenge, error: "malformed_payment" }, 402); }
    const body = JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: req });
    const post = (ep: string) =>
      f(`${o.facilitatorUrl}/${ep}`, { method: "POST", headers: { "content-type": "application/json" }, body });

    const v = await post("verify");
    const vj: any = await v.json().catch(() => ({}));
    if (!v.ok || !vj.isValid) {
      return c.json({ ...challenge, error: "payment_invalid", reason: vj.invalidReason ?? vj.errorReason ?? null }, 402);
    }
    const payer = String(vj.payer ?? "").toLowerCase();

    const s = await post("settle");
    const sj: any = await s.json().catch(() => ({}));
    let tx: string | undefined = sj.transaction || undefined;
    let ok = Boolean(sj.success);
    if (!ok && !tx) {
      // Facilitator sometimes broadcasts but times out reading the receipt; recover the hash and confirm ourselves.
      const m = /0x[0-9a-fA-F]{64}/.exec(String(sj.errorMessage ?? sj.error ?? ""));
      if (m && o.confirmTx) {
        tx = m[0];
        ok = await o.confirmTx(tx as `0x${string}`).catch(() => false);
      }
    }
    if (!ok || !tx) {
      logger.warn({ status: s.status, reason: sj.errorReason }, "x402 settle failed");
      return c.json({ ...challenge, error: "settlement_failed", reason: sj.errorReason ?? null }, 402);
    }
    tx = tx.toLowerCase();
    await db.query(
      `INSERT INTO receipts (payer, pay_to, amount, asset, network, resource, tx_hash, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'settled') ON CONFLICT (tx_hash) DO NOTHING`,
      [payer, o.payTo.toLowerCase(), o.amount, o.asset.toLowerCase(), o.network, resource.url, tx],
    );
    c.set("x402" as never, { payer, tx } as never);
    c.header("PAYMENT-RESPONSE", b64({ success: true, transaction: tx, network: o.network, payer }));
    await next();
  };
}
