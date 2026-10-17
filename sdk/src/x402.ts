import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { Address, Hex, LocalAccount, PublicClient } from "viem";
import { testnetAddresses } from "./chain.js";

export type PaymentRequirements = {
  scheme: "exact"; network: string; asset: Address; amount: string; payTo: Address;
  maxTimeoutSeconds: number; extra: { name: string; version: string; assetTransferMethod?: "permit2" };
};

export const DEFAULT_FACILITATOR = "https://facilitator.vativ.io";

/** MUSD on Mezo testnet paid through Permit2 (the SpendWallet signs via EIP-1271). */
export function musdRequirements(payTo: Address, amount: bigint): PaymentRequirements {
  return { scheme: "exact", network: "eip155:31611", asset: testnetAddresses.musd, amount: amount.toString(), payTo,
    maxTimeoutSeconds: 300, extra: { name: "Mezo USD", version: "1", assetTransferMethod: "permit2" } };
}

/** Build an x402 v2 payment payload where `wallet` (a SpendWallet) is the payer and `agent` its session key. */
export async function createPayment(opts: { wallet: Address; agent: LocalAccount; publicClient: PublicClient; requirements: PaymentRequirements; resource: string }) {
  const signer = {
    address: opts.wallet,
    signTypedData: (a: Parameters<LocalAccount["signTypedData"]>[0]) => opts.agent.signTypedData(a),
    readContract: (a: never) => opts.publicClient.readContract(a),
  };
  const res = await new ExactEvmScheme(signer as never).createPaymentPayload(2, opts.requirements as never);
  return { accepted: opts.requirements, resource: { url: opts.resource, description: "Sternpost x402", mimeType: "application/json" }, ...res, x402Version: 2 };
}

export type SettleResult = { success: boolean; transaction?: Hex; errorReason?: string; payer?: Address };

/** Verify then settle through a facilitator. The payer never pays gas. */
export async function pay(opts: Parameters<typeof createPayment>[0] & { facilitator?: string }): Promise<{ verify: unknown; settle: SettleResult }> {
  const paymentPayload = await createPayment(opts);
  const body = JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements: opts.requirements });
  const f = opts.facilitator ?? DEFAULT_FACILITATOR;
  const post = async (ep: string) => (await fetch(`${f}/${ep}`, { method: "POST", headers: { "content-type": "application/json" }, body })).json();
  const verify = await post("verify");
  const settle = (await post("settle")) as SettleResult;
  return { verify, settle };
}

/** Fetch a resource; on HTTP 402 pay with the SpendWallet and retry once. */
export async function fetchWithPayment(url: string, opts: Omit<Parameters<typeof createPayment>[0], "requirements" | "resource">, init: RequestInit = {}) {
  const first = await fetch(url, init);
  if (first.status !== 402) return first;
  const hdr = first.headers.get("payment-required");
  const body = hdr ? JSON.parse(Buffer.from(hdr, "base64").toString()) : await first.json();
  const requirements = (body.accepts?.[0] ?? body) as PaymentRequirements;
  const payload = await createPayment({ ...opts, requirements, resource: url });
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
  return fetch(url, { ...init, headers: { ...(init.headers ?? {}), "PAYMENT-SIGNATURE": encoded, "X-PAYMENT": encoded } });
}
