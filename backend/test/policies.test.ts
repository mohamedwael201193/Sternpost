import { describe, it, expect } from "vitest";
import { testApp, json } from "./helpers.js";

const G = "0x3333333333333333333333333333333333333333";
const B = "0x2222222222222222222222222222222222222222";
const E = (n: number) => (BigInt(Math.round(n * 100)) * 10n ** 16n).toString();

describe("policies", () => {
  it("upserts and reads a policy", async () => {
    const { app } = await testApp();
    expect((await app.request("/v1/policies", json({ governor: G, borrower: B, floorICR: E(1.5), defendICR: E(1.6) }, "PUT"))).status).toBe(200);
    await app.request("/v1/policies", json({ governor: G, borrower: B, floorICR: E(2), defendICR: E(2.2) }, "PUT"));
    const p = await (await app.request(`/v1/policies/${G}`)).json();
    expect(p.policy.floor_icr).toBe(E(2));
  });
  it("refuses floors below Mezo MCR and defend < floor", async () => {
    const { app } = await testApp();
    expect((await app.request("/v1/policies", json({ governor: G, borrower: B, floorICR: E(1.05), defendICR: E(1.2) }, "PUT"))).status).toBe(400);
    expect((await app.request("/v1/policies", json({ governor: G, borrower: B, floorICR: E(1.6), defendICR: E(1.5) }, "PUT"))).status).toBe(400);
  });
  it("404 unknown, 400 bad address", async () => {
    const { app } = await testApp();
    expect((await app.request(`/v1/policies/${G}`)).status).toBe(404);
    expect((await app.request(`/v1/policies/0xbad`)).status).toBe(400);
  });
});
