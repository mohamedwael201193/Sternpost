import { Hono } from "hono";
import { z } from "zod";
import { address, parseBody, uintString } from "../lib/validate.js";
import { relayDraw, type RelayerDeps } from "../relayer/relayer.js";

const relaySchema = z.object({
  chainId: z.number().int(),
  account: address,
  agent: address,
  payee: address,
  amount: uintString,
  deadline: z.number().int().positive(),
  sig: z.string().regex(/^0x[0-9a-fA-F]{130}$/, "sig must be 65 bytes"),
});

/**
 * POST /v1/relay/draw — gas-sponsored drawBySig (plan 5.7, task 2.4).
 * Testnet only. Refuses mainnet and non-factory accounts before any send;
 * simulates the call first and never sends a doomed tx. Rate limit 20/h/agent
 * (one shared limiter per runtime, taken only after simulation, so refusals
 * never burn quota). The account factory is pinned to the Shield-redeploy
 * factory in config; 503 only while RELAYER_PRIVATE_KEY is unset.
 * Free for sandbox/testnet use; the relayer key never appears in a response.
 */
export function relayRoutes(deps: RelayerDeps) {
  const r = new Hono();

  r.post("/relay/draw", async (c) => {
    const body = await parseBody(c, relaySchema);
    if (body instanceof Response) return body;
    const res = await relayDraw(deps, {
      chainId: body.chainId,
      account: body.account as `0x${string}`,
      agent: body.agent as `0x${string}`,
      payee: body.payee as `0x${string}`,
      amount: BigInt(body.amount),
      deadline: body.deadline,
      sig: body.sig as `0x${string}`,
    });
    if (!res.ok) return c.json({ error: res.error, reason: res.reason ?? undefined }, res.status as any);
    return c.json({ txHash: res.txHash, relayedBy: res.relayedBy, network: res.network }, 202);
  });

  return r;
}
