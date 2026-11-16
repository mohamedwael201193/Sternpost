import { describe, it, expect, vi } from "vitest";
import { testApp, MUSD, PAYTO, b64 } from "./helpers.js";
import type { GatewayChainReader } from "../src/gateway/chain.js";

const TX = "0x" + "5c".repeat(32);
const ACCT = "0x6B88f1f2C7791cB0cc417297B4590B0392Fbe6a1";
const AGENT = "0x94233B50980343bF36A6f217150b3D98E7a785AA";
const payer = "0xC05238b304409bC549fd8138301a2E977BaD8Cb3";
const fac = (verify: any, settle: any, vStatus = 200, sStatus = 200) =>
  vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/verify") ? verify : settle), { status: url.endsWith("/verify") ? vStatus : sStatus }));
const hdr = { "payment-signature": b64({ x402Version: 2, payload: { sig: "0x" } }) };

const stubReader: GatewayChainReader = {
  readRadar: vi.fn(async () => ({
    network: "testnet" as const,
    synthetic: true as const,
    price: 64348217050000000000000n,
    tcr: 2310000000000000000n,
    recoveryMode: false,
    troveCount: 277n,
    frontier: { trove: "0x71a8b3f0b6e7d0c9a8b7f6e5d4c3b2a19087f6e5" as const, icr: 1258000000000000000n, debt: 426001071000000000000000000n },
    rank: { rank: 181n, debtAhead: 1234560000000000000000000n, steps: 181n, complete: true },
  })),
  readPreviewDraw: vi.fn(async () => ({ ok: true, reasonCode: 0, icrAfter: 1330000000000000000n, fee: 1000000000000000n })),
  readRisk: vi.fn(async () => ({
    account: ACCT as `0x${string}`,
    status: 1,
    icr: 1330000000000000000n,
    price: 64348217050000000000000n,
    tcr: 2310000000000000000n,
    recoveryMode: false,
    troveCount: 277n,
    rank: { rank: 181n, debtAhead: 1234560000000000000000000n, steps: 181n, complete: true },
    policy: { floorICR: 1200000000000000000n, shieldICR: 1150000000000000000n, targetICR: 1500000000000000000n, bounty: 1000000000000000000n, minDebtAhead: 0n, cooldownBlocks: 20n },
    shieldWanted: false,
    shieldReasons: [],
  })),
};

const gw = (over: any = {}) => ({
  pay: { facilitatorUrl: "https://fac.test", network: "eip155:31611", asset: MUSD, payTo: PAYTO, fetchFn: fac({ isValid: true, payer }, { success: true, transaction: TX }) },
  amounts: { radar: "1000000000000000", previewDraw: "1000000000000000", riskReport: "10000000000000000" },
  reader: stubReader,
  ...over,
});

describe("gateway prices", () => {
  it("publishes the §5.3 table for free", async () => {
    const { app } = await testApp({ gateway: gw() });
    const r = await app.request("/v1/gateway/prices");
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.routes.radar.amount).toBe("1000000000000000");
    expect(body.routes.radar.musd).toBe("0.001");
    expect(body.routes.previewDraw.amount).toBe("1000000000000000");
    expect(body.routes.brief.amount).toBe("10000000000000000");
    expect(body.routes.riskReport.amount).toBe("10000000000000000");
    expect(body.network).toBe("eip155:31611");
  });
  it("is absent without gateway deps", async () => {
    const { app } = await testApp();
    expect((await app.request("/v1/gateway/prices")).status).toBe(404);
    expect((await app.request(`/v1/radar/${ACCT}`)).status).toBe(404);
  });
});

describe("GET /v1/radar/:account", () => {
  it("returns a v2 402 with the 0.001 MUSD requirement and PAYMENT-REQUIRED header", async () => {
    const { app } = await testApp({ gateway: gw() });
    const r = await app.request(`/v1/radar/${ACCT}`);
    expect(r.status).toBe(402);
    const body = await r.json();
    expect(body.accepts[0]).toMatchObject({ scheme: "exact", network: "eip155:31611", asset: MUSD, payTo: PAYTO, amount: "1000000000000000" });
    const h = JSON.parse(Buffer.from(r.headers.get("payment-required")!, "base64").toString());
    expect(h.x402Version).toBe(2);
    expect(h.accepts[0].amount).toBe("1000000000000000");
  });
  it("rejects a malformed address with 400 before any payment", async () => {
    const { app } = await testApp({ gateway: gw() });
    const r = await app.request("/v1/radar/not-an-address");
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("invalid_address");
  });
  it("serves live-shaped Radar JSON after payment and stores the receipt", async () => {
    const { app, db } = await testApp({ gateway: gw() });
    const r = await app.request(`/v1/radar/${ACCT}`, { headers: hdr });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.account).toBe(ACCT.toLowerCase());
    expect(body.network).toBe("eip155:31611");
    expect(body.synthetic).toBe(true);
    expect(body.rank.rank).toBe("181");
    expect(body.rank.debtAhead).toBe("1234560000000000000000000");
    expect(body.tcr).toBe("2310000000000000000");
    expect(body.recoveryMode).toBe(false);
    expect(body.settlementTx).toBe(TX);
    expect(body.explorer).toBe(`https://explorer.test.mezo.org/tx/${TX}`);
    expect(r.headers.get("payment-response")).toBeTruthy();
    const rec = await (await app.request(`/v1/receipts/${TX}`)).json();
    expect(rec.receipt.status).toBe("settled");
    expect((await db.query("SELECT count(*)::int AS n FROM receipts")).rows[0].n).toBe(1);
  });
  it("returns 502 when the Radar read fails after payment", async () => {
    const failing = { ...stubReader, readRadar: vi.fn(async () => { throw new Error("boom"); }) };
    const { app } = await testApp({ gateway: gw({ reader: failing }) });
    const r = await app.request(`/v1/radar/${ACCT}`, { headers: hdr });
    expect(r.status).toBe(502);
    expect((await r.json()).error).toBe("radar_unavailable");
  });
  it("rejects invalid payments without serving", async () => {
    const f = fac({ isValid: false, invalidReason: "insufficient_funds" }, {});
    const { app } = await testApp({ gateway: gw({ pay: { facilitatorUrl: "https://fac.test", network: "eip155:31611", asset: MUSD, payTo: PAYTO, fetchFn: f } }) });
    const r = await app.request(`/v1/radar/${ACCT}`, { headers: hdr });
    expect(r.status).toBe(402);
    expect((await r.json()).reason).toBe("insufficient_funds");
  });
});

describe("GET /v1/preview-draw", () => {
  const qs = `?account=${ACCT}&agent=${AGENT}&payee=${PAYTO}&amount=1000000000000000`;
  it("returns a v2 402 with the 0.001 MUSD requirement", async () => {
    const { app } = await testApp({ gateway: gw() });
    const r = await app.request(`/v1/preview-draw${qs}`);
    expect(r.status).toBe(402);
    expect((await r.json()).accepts[0].amount).toBe("1000000000000000");
  });
  it("returns 400 for missing params before any payment, without settling", async () => {
    const fetchFn = fac({ isValid: true, payer }, { success: true, transaction: TX });
    const { app, db } = await testApp({ gateway: gw({ pay: { facilitatorUrl: "https://fac.test", network: "eip155:31611", asset: MUSD, payTo: PAYTO, fetchFn } }) });
    // Payment signature presented AND params malformed: validation runs before
    // the paywall, so the facilitator is never called and no receipt is stored.
    const r = await app.request("/v1/preview-draw?account=0x1234", { headers: hdr });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("invalid_params");
    expect(fetchFn).not.toHaveBeenCalled();
    expect((await db.query("SELECT count(*)::int AS n FROM receipts")).rows[0].n).toBe(0);
  });
  it("returns 400 for missing params with no payment signature at all", async () => {
    const fetchFn = fac({ isValid: true, payer }, { success: true, transaction: TX });
    const { app, db } = await testApp({ gateway: gw({ pay: { facilitatorUrl: "https://fac.test", network: "eip155:31611", asset: MUSD, payTo: PAYTO, fetchFn } }) });
    const r = await app.request("/v1/preview-draw?account=0x1234");
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("invalid_params");
    expect(fetchFn).not.toHaveBeenCalled();
    expect((await db.query("SELECT count(*)::int AS n FROM receipts")).rows[0].n).toBe(0);
  });
  it("serves the preview result after payment", async () => {
    const { app } = await testApp({ gateway: gw() });
    const r = await app.request(`/v1/preview-draw${qs}`, { headers: hdr });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.reasonCode).toBe(0);
    expect(body.reason).toBe("OK");
    expect(body.icrAfter).toBe("1330000000000000000");
    expect(body.fee).toBe("1000000000000000");
    expect(body.settlementTx).toBe(TX);
  });
  it("returns 502 when the preview read reverts after payment", async () => {
    const failing = { ...stubReader, readPreviewDraw: vi.fn(async () => { throw new Error("revert"); }) };
    const { app } = await testApp({ gateway: gw({ reader: failing }) });
    const r = await app.request(`/v1/preview-draw${qs}`, { headers: hdr });
    expect(r.status).toBe(502);
    expect((await r.json()).error).toBe("preview_unavailable");
  });
});

describe("POST /v1/risk-report", () => {
  const body = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: ACCT }) };
  it("returns a v2 402 with the 0.01 MUSD requirement", async () => {
    const { app } = await testApp({ gateway: gw() });
    const r = await app.request("/v1/risk-report", body);
    expect(r.status).toBe(402);
    expect((await r.json()).accepts[0].amount).toBe("10000000000000000");
  });
  it("returns 400 for a malformed account before any payment, without settling", async () => {
    const fetchFn = fac({ isValid: true, payer }, { success: true, transaction: TX });
    const { app, db } = await testApp({ gateway: gw({ pay: { facilitatorUrl: "https://fac.test", network: "eip155:31611", asset: MUSD, payTo: PAYTO, fetchFn } }) });
    // Payment signature presented AND body malformed: validation runs before
    // the paywall, so the facilitator is never called and no receipt is stored.
    const r = await app.request("/v1/risk-report", { ...body, headers: { ...body.headers, ...hdr }, body: JSON.stringify({ account: "nope" }) });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("invalid_params");
    expect(fetchFn).not.toHaveBeenCalled();
    expect((await db.query("SELECT count(*)::int AS n FROM receipts")).rows[0].n).toBe(0);
  });
  it("returns 400 for a malformed account with no payment signature at all", async () => {
    const fetchFn = fac({ isValid: true, payer }, { success: true, transaction: TX });
    const { app, db } = await testApp({ gateway: gw({ pay: { facilitatorUrl: "https://fac.test", network: "eip155:31611", asset: MUSD, payTo: PAYTO, fetchFn } }) });
    const r = await app.request("/v1/risk-report", { ...body, body: JSON.stringify({ account: "nope" }) });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("invalid_params");
    expect(fetchFn).not.toHaveBeenCalled();
    expect((await db.query("SELECT count(*)::int AS n FROM receipts")).rows[0].n).toBe(0);
  });
  it("serves the risk report after payment", async () => {
    const { app, db } = await testApp({ gateway: gw() });
    // Seed one earlier receipt paid BY the account so recentReceipts is exercised.
    await db.query(
      `INSERT INTO receipts (payer, pay_to, amount, asset, network, resource, tx_hash, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'settled')`,
      [ACCT.toLowerCase(), PAYTO.toLowerCase(), "1000000000000000", MUSD.toLowerCase(), "eip155:31611", "https://example.test/v1/radar", "0x" + "ab".repeat(32)],
    );
    const r = await app.request("/v1/risk-report", { ...body, headers: { ...body.headers, ...hdr } });
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.account).toBe(ACCT.toLowerCase());
    expect(b.status).toBe(1);
    expect(b.icr).toBe("1330000000000000000");
    expect(b.rank.rank).toBe("181");
    expect(b.policy.floorICR).toBe("1200000000000000000");
    expect(b.shieldWanted).toBe(false);
    expect(b.shieldReasons).toEqual([]);
    expect(b.recentEvents).toEqual([]);
    expect(b.recentReceipts).toHaveLength(1);
    expect(b.recentReceipts[0].tx_hash).toBe("0x" + "ab".repeat(32));
    expect(b.settlementTx).toBe(TX);
  });
  it("returns 502 when the risk read fails after payment", async () => {
    const failing = { ...stubReader, readRisk: vi.fn(async () => { throw new Error("boom"); }) };
    const { app } = await testApp({ gateway: gw({ reader: failing }) });
    const r = await app.request("/v1/risk-report", { ...body, headers: { ...body.headers, ...hdr } });
    expect(r.status).toBe(502);
    expect((await r.json()).error).toBe("risk_unavailable");
  });
});
