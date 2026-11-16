import { parseUnits, type Address, type Hex, type LocalAccount, type PublicClient } from "viem";
import { createPayment, type PaymentRequirements } from "./x402.js";
import { reasonFromCode, type ReasonCode } from "./reasons.js";
import { testnetAddresses } from "./chain.js";

/**
 * pay-by-borrow x402 (plan §5.2, G2): pay an x402-protected HTTP resource in
 * MUSD by borrowing exactly that amount just in time against the account's
 * Bitcoin collateral, then fetch the resource. Spends session budget.
 *
 * Order (G2): (1) GET url -> 402, parse `payment-required` (base64 JSON),
 * pick the accept whose `network` equals the account network and whose
 * `asset` equals MUSD; (2) previewDraw the refill; (3) if the account's
 * MUSD balance is below `amount`, refill with `draw(account,
 * max(amount - balance, refillTarget))` — the borrow happens BEFORE signing
 * (the facilitator settles by itself, so a refill after signing would find
 * no balance to pull); (4) sign with ExactEvmScheme, payer = the account
 * (EIP-1271, the agent session key signs); (5) retry with PAYMENT-SIGNATURE;
 * (6) read `payment-response` for the settle hash.
 *
 * The borrow is minimal: only the shortfall is drawn (plus the 10 bps draw
 * fee, which the contract takes from the gross). The Permit2 allowance caps
 * what the facilitator can pull, so the account must have approved Permit2
 * (owner `approveToken`) for at least `amount` before paying.
 */

export type PayContext = {
  chainId: number;
  network: "testnet" | "mainnet";
  /** The TroveAccount (the x402 payer). */
  account: Address;
  /** The session agent key: signs the Permit2 payload and sends the refill draw. */
  agent: LocalAccount;
  publicClient: PublicClient;
  /** The account's current MUSD balance. */
  musdBalance: () => Promise<bigint>;
  /** TroveAccount.previewDraw(agent, payee, amount). */
  previewDraw: (
    agent: Address,
    payee: Address,
    amount: bigint,
  ) => Promise<{ ok: boolean; reasonCode: number; icrAfter: bigint; fee: bigint }>;
  /** Agent draw(payee, amount); returns the tx hash. Pays gas from the agent key. */
  draw: (payee: Address, amount: bigint) => Promise<Hex>;
  /** Waits for a tx receipt; the refill must be mined before signing. */
  waitForReceipt: (hash: Hex) => Promise<{ status: "success" | "reverted" }>;
  /** Injectable fetch (tests stub this). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

export type PayResult =
  | {
      status: "paid";
      /** MUSD paid (atomic units); 0 when the resource needed no payment. */
      amount: bigint;
      payTo: Address | null;
      network: string;
      /** The refill draw tx, or null when the balance already covered it. */
      refillTx: Hex | null;
      /** The facilitator settle tx from `payment-response`; null when the resource needed no payment. */
      settleTx: Hex | null;
      responseStatus: number;
      responseBody: string;
    }
  | {
      status: "refused";
      reason: ReasonCode;
      amount: bigint;
      payTo: Address | null;
      network: string;
      refillTx: Hex | null;
      settleTx: null;
      responseStatus: number;
      responseBody: string;
    };

export type PaymentRequiredBody = {
  x402Version: number;
  resource?: { url: string; description?: string; mimeType?: string };
  accepts: PaymentRequirements[];
};

/** Parse the `payment-required` header of a 402 (base64 JSON). */
export function parsePaymentRequired(res: { headers: { get(name: string): string | null } }): PaymentRequiredBody {
  const hdr = res.headers.get("payment-required");
  if (!hdr) throw new Error("402 without a payment-required header");
  return JSON.parse(Buffer.from(hdr, "base64").toString()) as PaymentRequiredBody;
}

/** x402 amounts are atomic-unit strings; tolerate a decimal MUSD string too. */
export function parseAmount(raw: string): bigint {
  if (/^[0-9]+$/.test(raw)) return BigInt(raw);
  return parseUnits(raw, 18);
}

const BODY_LIMIT = 8_192;

export async function payByBorrow(
  ctx: PayContext,
  url: string,
  opts: { maxAmount?: bigint; refillTarget?: bigint } = {},
): Promise<PayResult> {
  const fetchFn = ctx.fetchImpl ?? fetch;
  const networkId = `eip155:${ctx.chainId}`;
  const musd = testnetAddresses.musd;

  const first = await fetchFn(url);
  if (first.status !== 402) {
    // No payment needed: the resource is free (or already paid).
    return {
      status: "paid",
      amount: 0n,
      payTo: null,
      network: networkId,
      refillTx: null,
      settleTx: null,
      responseStatus: first.status,
      responseBody: (await first.text()).slice(0, BODY_LIMIT),
    };
  }
  const body = parsePaymentRequired(first);
  const accepts = body.accepts ?? [];
  const networkMatches = accepts.filter((a) => a.network === networkId);
  if (networkMatches.length === 0) {
    return {
      status: "refused",
      reason: "NETWORK_MISMATCH",
      amount: 0n,
      payTo: null,
      network: networkId,
      refillTx: null,
      settleTx: null,
      responseStatus: 402,
      responseBody: (await first.text()).slice(0, BODY_LIMIT),
    };
  }
  const req = networkMatches.find((a) => a.asset.toLowerCase() === musd.toLowerCase());
  if (!req) {
    return {
      status: "refused",
      reason: "ASSET_MISMATCH",
      amount: 0n,
      payTo: networkMatches[0]?.payTo ?? null,
      network: networkId,
      refillTx: null,
      settleTx: null,
      responseStatus: 402,
      responseBody: (await first.text()).slice(0, BODY_LIMIT),
    };
  }
  const amount = parseAmount(req.amount);
  if (opts.maxAmount !== undefined && amount > opts.maxAmount) {
    return {
      status: "refused",
      reason: "OVER_MAX",
      amount,
      payTo: req.payTo,
      network: networkId,
      refillTx: null,
      settleTx: null,
      responseStatus: 402,
      responseBody: "",
    };
  }

  // Refill: borrow only the shortfall (testnet refillTarget defaults to 0).
  const balance = await ctx.musdBalance();
  const shortfall = balance >= amount ? 0n : amount - balance;
  const refillAmount = shortfall === 0n ? 0n : shortfall > (opts.refillTarget ?? 0n) ? shortfall : (opts.refillTarget ?? 0n);
  let refillTx: Hex | null = null;
  if (refillAmount > 0n) {
    const preview = await ctx.previewDraw(ctx.agent.address, ctx.account, refillAmount);
    if (!preview.ok) {
      return {
        status: "refused",
        reason: reasonFromCode(preview.reasonCode),
        amount,
        payTo: req.payTo,
        network: networkId,
        refillTx: null,
        settleTx: null,
        responseStatus: 402,
        responseBody: "",
      };
    }
    refillTx = await ctx.draw(ctx.account, refillAmount);
    const receipt = await ctx.waitForReceipt(refillTx);
    if (receipt.status !== "success") throw new Error(`refill draw reverted: ${refillTx}`);
  }

  // Sign the Permit2 payment as the account (EIP-1271, agent session key signs).
  const payload = await createPayment({
    wallet: ctx.account,
    agent: ctx.agent,
    publicClient: ctx.publicClient,
    requirements: req,
    resource: url,
  });
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
  const retry = await fetchFn(url, {
    headers: { "PAYMENT-SIGNATURE": encoded, "X-PAYMENT": encoded },
  });
  const responseBody = (await retry.text()).slice(0, BODY_LIMIT);
  if (retry.status !== 200) {
    throw new Error(`payment retry returned ${retry.status}: ${responseBody}`);
  }
  const payResp = retry.headers.get("payment-response");
  let settleTx: Hex | null = null;
  if (payResp) {
    const settled = JSON.parse(Buffer.from(payResp, "base64").toString()) as {
      success?: boolean;
      transaction?: Hex;
    };
    settleTx = settled.transaction ?? null;
  }
  return {
    status: "paid",
    amount,
    payTo: req.payTo,
    network: networkId,
    refillTx,
    settleTx,
    responseStatus: retry.status,
    responseBody,
  };
}
