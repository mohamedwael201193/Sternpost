import { describe, it, expect, vi, beforeEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { payByBorrow, parseAmount, parsePaymentRequired, type PayContext } from "../src/pay.js";
import { testnetAddresses } from "../src/chain.js";
import type { Address, Hex } from "viem";

vi.mock("../src/x402.js", () => ({ createPayment: vi.fn() }));
import { createPayment } from "../src/x402.js";
const mockCreatePayment = vi.mocked(createPayment);

// Public anvil test vector (valueless).
const agent = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;
const PAY_TO = "0xC3376296a18ef364eA19287203EEd7a87f18e738" as Address;

// The live 402 from https://demo.vativ.io/ (captured 2026-11-16, 09:42 UTC):
// 0.001 MUSD, eip155:31611, asset MUSD, payTo 0xC337..., scheme exact, permit2.
const ACCEPT = {
  scheme: "exact",
  network: "eip155:31611",
  amount: "1000000000000000",
  asset: testnetAddresses.musd,
  payTo: PAY_TO,
  maxTimeoutSeconds: 300,
  extra: { name: "Mezo USD", version: "1", assetTransferMethod: "permit2" },
} as const;
const BODY_402 = {
  x402Version: 2,
  error: "Payment required",
  resource: { url: "http://demo.vativ.io/", description: "Mezo x402 Quickstart — pay $0.001 in MUSD to unlock", mimeType: "" },
  accepts: [ACCEPT],
};
const HDR_402 = Buffer.from(JSON.stringify(BODY_402)).toString("base64");
const SETTLE_TX = "0x7876c7b74708877c4537ae3652210b36b328146ba28939ed5231dd4dbc47e342" as Hex;
const HDR_SETTLE = Buffer.from(JSON.stringify({ success: true, transaction: SETTLE_TX, network: "eip155:31611" })).toString("base64");

type FakeResp = { status: number; headers: { get(n: string): string | null }; text: () => Promise<string> };
function resp(status: number, headers: Record<string, string>, body = ""): FakeResp {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return { status, headers: { get: (n: string) => lower[n.toLowerCase()] ?? null }, text: async () => body };
}

function ctx(over: Partial<PayContext> = {}): PayContext {
  return {
    chainId: 31611,
    network: "testnet",
    account: ACCOUNT,
    agent: agent as never,
    publicClient: {} as never,
    musdBalance: vi.fn(async () => 0n),
    previewDraw: vi.fn(async () => ({ ok: true, reasonCode: 0, icrAfter: 2_000_000_000_000_000_000n, fee: 0n })),
    draw: vi.fn(async () => "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex),
    waitForReceipt: vi.fn(async () => ({ status: "success" as const })),
    ...over,
  } as PayContext;
}

beforeEach(() => {
  vi.mocked(createPayment).mockImplementation(async (opts: never) => {
    const o = opts as { requirements: unknown; resource: string };
    return { x402Version: 2, accepted: o.requirements, resource: { url: o.resource, description: "Sternpost x402", mimeType: "application/json" }, payload: { signature: "0x1234" } } as never;
  });
});

describe("parseAmount / parsePaymentRequired", () => {
  it("parses atomic-unit and decimal MUSD strings", () => {
    expect(parseAmount("1000000000000000")).toBe(1_000_000_000_000_000n);
    expect(parseAmount("0.001")).toBe(1_000_000_000_000_000n);
    // A plain integer string is atomic units per x402 (an 1800-MUSD
    // payment would arrive as "1800000000000000000000").
    expect(parseAmount("1800")).toBe(1800n);
  });

  it("parses the live demo.vativ.io 402", () => {
    const body = parsePaymentRequired(resp(402, { "payment-required": HDR_402 }));
    expect(body.x402Version).toBe(2);
    expect(body.accepts[0].network).toBe("eip155:31611");
    expect(body.accepts[0].asset.toLowerCase()).toBe(testnetAddresses.musd.toLowerCase());
    expect(parseAmount(body.accepts[0].amount)).toBe(1_000_000_000_000_000n);
  });

  it("throws on a 402 without the header", () => {
    expect(() => parsePaymentRequired(resp(402, {}))).toThrow("payment-required");
  });
});

describe("payByBorrow flow", () => {
  it("passes a free resource through untouched (no payment, no draw)", async () => {
    const fetchImpl = vi.fn(async () => resp(200, {}, '{"ok":true}'));
    const c = ctx({ fetchImpl: fetchImpl as never });
    const r = await payByBorrow(c, "https://demo.vativ.io/");
    expect(r.status).toBe("paid");
    if (r.status !== "paid") throw new Error("unreachable");
    expect(r.amount).toBe(0n);
    expect(r.settleTx).toBeNull();
    expect(r.refillTx).toBeNull();
    expect(r.responseStatus).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(c.draw).not.toHaveBeenCalled();
    expect(mockCreatePayment).not.toHaveBeenCalled();
  });

  it("refuses a network mismatch without touching the chain", async () => {
    const other = { ...BODY_402, accepts: [{ ...ACCEPT, network: "eip155:1" }] };
    const fetchImpl = vi.fn(async () => resp(402, { "payment-required": Buffer.from(JSON.stringify(other)).toString("base64") }, "{}"));
    const c = ctx({ fetchImpl: fetchImpl as never });
    const r = await payByBorrow(c, "https://demo.vativ.io/");
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("NETWORK_MISMATCH");
    expect(c.draw).not.toHaveBeenCalled();
  });

  it("refuses an asset mismatch", async () => {
    const other = { ...BODY_402, accepts: [{ ...ACCEPT, asset: "0x0000000000000000000000000000000000000001" }] };
    const fetchImpl = vi.fn(async () => resp(402, { "payment-required": Buffer.from(JSON.stringify(other)).toString("base64") }, "{}"));
    const r = await payByBorrow(ctx({ fetchImpl: fetchImpl as never }), "https://demo.vativ.io/");
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("ASSET_MISMATCH");
  });

  it("refuses OVER_MAX when the 402 asks for more than the ceiling", async () => {
    const fetchImpl = vi.fn(async () => resp(402, { "payment-required": HDR_402 }, "{}"));
    const r = await payByBorrow(ctx({ fetchImpl: fetchImpl as never }), "https://demo.vativ.io/", { maxAmount: 500_000_000_000_000n });
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("OVER_MAX");
    expect(r.amount).toBe(1_000_000_000_000_000n);
  });

  it("pays without a refill when the balance covers it, and returns the settle hash", async () => {
    const calls: { url: string; init?: unknown }[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: unknown) => {
      calls.push({ url, init });
      return calls.length === 1
        ? resp(402, { "payment-required": HDR_402 }, "{}")
        : resp(200, { "payment-response": HDR_SETTLE }, '{"unlocked":true}');
    });
    const c = ctx({ fetchImpl: fetchImpl as never, musdBalance: vi.fn(async () => 5_000_000_000_000_000n) });
    const r = await payByBorrow(c, "https://demo.vativ.io/");
    expect(r.status).toBe("paid");
    if (r.status !== "paid") throw new Error("unreachable");
    expect(r.amount).toBe(1_000_000_000_000_000n);
    expect(r.payTo).toBe(PAY_TO);
    expect(r.refillTx).toBeNull();
    expect(r.settleTx).toBe(SETTLE_TX);
    expect(r.responseStatus).toBe(200);
    expect(c.draw).not.toHaveBeenCalled();
    expect(c.previewDraw).not.toHaveBeenCalled();
    expect(mockCreatePayment).toHaveBeenCalledTimes(1);
    const payArg = vi.mocked(createPayment).mock.calls[0][0] as { wallet: Address; requirements: { amount: string } };
    expect(payArg.wallet).toBe(ACCOUNT);
    expect(payArg.requirements.amount).toBe("1000000000000000");
    // The retry carries the signed payload in PAYMENT-SIGNATURE.
    const retryHeaders = (calls[1].init as { headers: Record<string, string> }).headers;
    const decoded = JSON.parse(Buffer.from(retryHeaders["PAYMENT-SIGNATURE"], "base64").toString());
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepted.amount).toBe("1000000000000000");
    expect(decoded.payload.signature).toBe("0x1234");
  });

  it("refills exactly the shortfall, then pays (balance 0.0005 of 0.001)", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: unknown) =>
      init ? resp(200, { "payment-response": HDR_SETTLE }, "{}") : resp(402, { "payment-required": HDR_402 }, "{}"),
    );
    const c = ctx({ fetchImpl: fetchImpl as never, musdBalance: vi.fn(async () => 500_000_000_000_000n) });
    const r = await payByBorrow(c, "https://demo.vativ.io/");
    expect(r.status).toBe("paid");
    if (r.status !== "paid") throw new Error("unreachable");
    expect(c.previewDraw).toHaveBeenCalledWith(agent.address, ACCOUNT, 500_000_000_000_000n);
    expect(c.draw).toHaveBeenCalledWith(ACCOUNT, 500_000_000_000_000n);
    expect(c.waitForReceipt).toHaveBeenCalledWith("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(r.refillTx).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(r.settleTx).toBe(SETTLE_TX);
  });

  it("refillTarget raises the draw above the shortfall", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: unknown) =>
      init ? resp(200, { "payment-response": HDR_SETTLE }, "{}") : resp(402, { "payment-required": HDR_402 }, "{}"),
    );
    const c = ctx({ fetchImpl: fetchImpl as never, musdBalance: vi.fn(async () => 0n) });
    await payByBorrow(c, "https://demo.vativ.io/", { refillTarget: 10_000_000_000_000_000n });
    expect(c.draw).toHaveBeenCalledWith(ACCOUNT, 10_000_000_000_000_000n);
  });

  it("refuses with the preview reason and never draws when previewDraw fails", async () => {
    const fetchImpl = vi.fn(async () => resp(402, { "payment-required": HDR_402 }, "{}"));
    const c = ctx({
      fetchImpl: fetchImpl as never,
      musdBalance: vi.fn(async () => 0n),
      previewDraw: vi.fn(async () => ({ ok: false, reasonCode: 6, icrAfter: 0n, fee: 0n })),
    });
    const r = await payByBorrow(c, "https://demo.vativ.io/");
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("BELOW_FLOOR");
    expect(c.draw).not.toHaveBeenCalled();
    expect(mockCreatePayment).not.toHaveBeenCalled();
  });

  it("throws when the refill draw reverts on chain", async () => {
    const fetchImpl = vi.fn(async () => resp(402, { "payment-required": HDR_402 }, "{}"));
    const c = ctx({
      fetchImpl: fetchImpl as never,
      musdBalance: vi.fn(async () => 0n),
      waitForReceipt: vi.fn(async () => ({ status: "reverted" as const })),
    });
    await expect(payByBorrow(c, "https://demo.vativ.io/")).rejects.toThrow("refill draw reverted");
  });

  it("throws when the payment retry is not 200", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: unknown) =>
      init ? resp(402, {}, "insufficient funds") : resp(402, { "payment-required": HDR_402 }, "{}"),
    );
    const c = ctx({ fetchImpl: fetchImpl as never, musdBalance: vi.fn(async () => 5_000_000_000_000_000n) });
    await expect(payByBorrow(c, "https://demo.vativ.io/")).rejects.toThrow("payment retry returned 402");
  });

  it("pays with a null settle hash when the server omits payment-response (documents the gap, does not invent one)", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: unknown) =>
      init ? resp(200, {}, "{}") : resp(402, { "payment-required": HDR_402 }, "{}"),
    );
    const c = ctx({ fetchImpl: fetchImpl as never, musdBalance: vi.fn(async () => 5_000_000_000_000_000n) });
    const r = await payByBorrow(c, "https://demo.vativ.io/");
    expect(r.status).toBe("paid");
    if (r.status !== "paid") throw new Error("unreachable");
    expect(r.settleTx).toBeNull();
  });
});
