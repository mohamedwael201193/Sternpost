import { describe, it, expect, beforeEach } from "vitest";
import { testApp, json } from "./helpers.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { requestStatusMessage } from "../src/routes/apps.js";

const acct = privateKeyToAccount(generatePrivateKey());
const exp = () => Math.floor(Date.now() / 1000) + 120;
const signed = async (id: number, status: string, signer = acct, expiry = exp(), borrower = acct.address) =>
  json({ status, expiry, signature: await signer.signMessage({ message: requestStatusMessage(id, status, borrower, expiry) }) }, "PATCH");

const APP = "0x1111111111111111111111111111111111111111";
const BOR = acct.address.toLowerCase();
let app: Awaited<ReturnType<typeof testApp>>["app"];
beforeEach(async () => ({ app } = await testApp()));

describe("app registry", () => {
  it("registers, lowercases and lists apps", async () => {
    const r = await app.request("/v1/apps", json({ name: "Desk Agent", address: APP.toUpperCase().replace("0X", "0x"), url: "https://a.dev" }));
    expect(r.status).toBe(201);
    const list = await (await app.request("/v1/apps")).json();
    expect(list.apps[0].address).toBe(APP);
  });
  it("rejects duplicates with 409", async () => {
    await app.request("/v1/apps", json({ name: "A1", address: APP }));
    expect((await app.request("/v1/apps", json({ name: "A2", address: APP }))).status).toBe(409);
  });
  it("rejects invalid address and bad json", async () => {
    expect((await app.request("/v1/apps", json({ name: "A", address: "0x12" }))).status).toBe(400);
    expect((await app.request("/v1/apps", { method: "POST", body: "{nope", headers: { "content-type": "application/json" } })).status).toBe(400);
  });
});

describe("draw requests", () => {
  beforeEach(async () => { await app.request("/v1/apps", json({ name: "Desk Agent", address: APP })); });
  it("creates, filters and finalizes a request exactly once", async () => {
    const c = await app.request("/v1/requests", json({ appAddress: APP, borrower: BOR, amount: "5000000000000000000", reason: "api credits" }));
    expect(c.status).toBe(201);
    const { request } = await c.json();
    expect(request.status).toBe("pending");
    const f = await (await app.request(`/v1/requests?borrower=${BOR}`)).json();
    expect(f.requests).toHaveLength(1);
    expect((await app.request(`/v1/requests/${request.id}`, json({ status: "approved" }, "PATCH"))).status).toBe(400);
    const p = await app.request(`/v1/requests/${request.id}`, await signed(request.id, "approved"));
    expect((await p.json()).request.status).toBe("approved");
    expect((await app.request(`/v1/requests/${request.id}`, await signed(request.id, "approved"))).status).toBe(404);
    expect((await app.request(`/v1/requests/${request.id}`, await signed(request.id, "rejected"))).status).toBe(404);
  });
  it("rejects unsigned, wrong-signer, wrong-status, expired and far-future signatures", async () => {
    const c = await app.request("/v1/requests", json({ appAddress: APP, borrower: BOR, amount: "1" }));
    const { request } = await c.json();
    const other = privateKeyToAccount(generatePrivateKey());
    const url = `/v1/requests/${request.id}`;
    expect((await app.request(url, await signed(request.id, "approved", other))).status).toBe(401);
    const sig = await acct.signMessage({ message: requestStatusMessage(request.id, "rejected", acct.address, exp()) });
    expect((await app.request(url, json({ status: "approved", expiry: exp(), signature: sig }, "PATCH"))).status).toBe(401);
    expect((await app.request(url, await signed(request.id, "approved", acct, Math.floor(Date.now() / 1000) - 1))).status).toBe(401);
    expect((await app.request(url, await signed(request.id, "approved", acct, Math.floor(Date.now() / 1000) + 3600))).status).toBe(401);
    expect((await app.request(`/v1/requests/9999`, await signed(9999, "approved"))).status).toBe(404);
    expect((await app.request(url, await signed(request.id, "rejected"))).status).toBe(200);
  });
  it("404s for unknown app, 400 for bad amount/id/status/filter", async () => {
    expect((await app.request("/v1/requests", json({ appAddress: BOR, borrower: BOR, amount: "1" }))).status).toBe(404);
    expect((await app.request("/v1/requests", json({ appAddress: APP, borrower: BOR, amount: "-1" }))).status).toBe(400);
    expect((await app.request("/v1/requests/abc", json({ status: "approved" }, "PATCH"))).status).toBe(400);
    expect((await app.request("/v1/requests/1", json({ status: "pending", expiry: exp(), signature: "0x" + "1".repeat(130) }, "PATCH"))).status).toBe(400);
    expect((await app.request("/v1/requests?borrower=zz")).status).toBe(400);
    expect((await (await app.request("/v1/requests")).json()).requests).toEqual([]);
  });
});
