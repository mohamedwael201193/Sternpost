import { describe, it, expect, beforeEach } from "vitest";
import { testApp, json } from "./helpers.js";

const APP = "0x1111111111111111111111111111111111111111";
const BOR = "0x2222222222222222222222222222222222222222";
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
    const p = await app.request(`/v1/requests/${request.id}`, json({ status: "approved" }, "PATCH"));
    expect((await p.json()).request.status).toBe("approved");
    expect((await app.request(`/v1/requests/${request.id}`, json({ status: "rejected" }, "PATCH"))).status).toBe(404);
  });
  it("404s for unknown app, 400 for bad amount/id/status/filter", async () => {
    expect((await app.request("/v1/requests", json({ appAddress: BOR, borrower: BOR, amount: "1" }))).status).toBe(404);
    expect((await app.request("/v1/requests", json({ appAddress: APP, borrower: BOR, amount: "-1" }))).status).toBe(400);
    expect((await app.request("/v1/requests/abc", json({ status: "approved" }, "PATCH"))).status).toBe(400);
    expect((await app.request("/v1/requests/1", json({ status: "pending" }, "PATCH"))).status).toBe(400);
    expect((await app.request("/v1/requests?borrower=zz")).status).toBe(400);
    expect((await (await app.request("/v1/requests")).json()).requests).toEqual([]);
  });
});
