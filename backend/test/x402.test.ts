import { describe, it, expect, vi } from "vitest";
import { testApp, MUSD, PAYTO, b64 } from "./helpers.js";

const TX = "0x" + "5c".repeat(32);
const payer = "0xC05238b304409bC549fd8138301a2E977BaD8Cb3";
const fac = (verify: any, settle: any, vStatus = 200, sStatus = 200) =>
  vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/verify") ? verify : settle), { status: url.endsWith("/verify") ? vStatus : sStatus }));
const pay = (over: any = {}) => ({ facilitatorUrl: "https://fac.test", network: "eip155:31611", asset: MUSD, payTo: PAYTO, amount: "10000000000000000", ...over });
const hdr = { "payment-signature": b64({ x402Version: 2, payload: { sig: "0x" } }) };

describe("x402 paywall", () => {
  it("returns a v2 402 challenge with PAYMENT-REQUIRED header", async () => {
    const { app } = await testApp();
    const r = await app.request("/v1/paid/brief");
    expect(r.status).toBe(402);
    const body = await r.json();
    expect(body.accepts[0]).toMatchObject({ scheme: "exact", network: "eip155:31611", asset: MUSD, payTo: PAYTO });
    const h = JSON.parse(Buffer.from(r.headers.get("payment-required")!, "base64").toString());
    expect(h.x402Version).toBe(2);
  });
  it("verifies, settles, stores receipt and serves content", async () => {
    const f = fac({ isValid: true, payer }, { success: true, transaction: TX });
    const { app, db } = await testApp({ pay: pay({ fetchFn: f }) });
    const r = await app.request("/v1/paid/brief", { headers: hdr });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.settlementTx).toBe(TX);
    expect(body.paidBy).toBe(payer.toLowerCase());
    expect(r.headers.get("payment-response")).toBeTruthy();
    const sent = JSON.parse(f.mock.calls[0][1].body);
    expect(sent.paymentRequirements.extra.assetTransferMethod).toBe("permit2");
    const rec = await (await app.request(`/v1/receipts/${TX}`)).json();
    expect(rec.receipt.status).toBe("settled");
    expect((await (await app.request(`/v1/receipts?payer=${payer}`)).json()).receipts).toHaveLength(1);
    expect((await db.query("SELECT count(*)::int AS n FROM receipts")).rows[0].n).toBe(1);
  });
  it("recovers when facilitator times out on the receipt but tx confirmed on chain", async () => {
    const f = fac({ isValid: true, payer }, { success: false, errorReason: "unexpected_error", errorMessage: `Transaction receipt with hash "${TX}" could not be found.` }, 200, 500);
    const confirmTx = vi.fn(async () => true);
    const { app } = await testApp({ pay: pay({ fetchFn: f, confirmTx }) });
    const r = await app.request("/v1/paid/brief", { headers: hdr });
    expect(r.status).toBe(200);
    expect(confirmTx).toHaveBeenCalledWith(TX);
  });
  it("rejects when recovery confirms failure", async () => {
    const f = fac({ isValid: true, payer }, { success: false, errorMessage: `hash "${TX}"` }, 200, 500);
    const { app } = await testApp({ pay: pay({ fetchFn: f, confirmTx: async () => false }) });
    expect((await app.request("/v1/paid/brief", { headers: hdr })).status).toBe(402);
  });
  it("rejects invalid payments and malformed headers without settling", async () => {
    const f = fac({ isValid: false, invalidReason: "insufficient_funds" }, {});
    const { app } = await testApp({ pay: pay({ fetchFn: f }) });
    const r = await app.request("/v1/paid/brief", { headers: hdr });
    expect(r.status).toBe(402);
    expect((await r.json()).reason).toBe("insufficient_funds");
    expect(f).toHaveBeenCalledTimes(1);
    expect((await app.request("/v1/paid/brief", { headers: { "x-payment": "%%%" } })).status).toBe(402);
  });
  it("exposes price and validates receipt lookups", async () => {
    const { app } = await testApp();
    expect((await (await app.request("/v1/paid/price")).json()).amount).toBe("10000000000000000");
    expect((await app.request("/v1/receipts/0x12")).status).toBe(400);
    expect((await app.request(`/v1/receipts/${TX}`)).status).toBe(404);
    expect((await app.request("/v1/receipts?payer=nope")).status).toBe(400);
  });
});
