import { describe, it, expect } from "vitest";
import { testApp } from "./helpers.js";

const G = "0x3333333333333333333333333333333333333333";
describe("activity feed", () => {
  it("filters by contract and event, newest first, bounded limit", async () => {
    const { app, db } = await testApp();
    const ins = (tx: string, i: number, b: number, c: string, e: string) =>
      db.query("INSERT INTO activity (tx_hash, log_index, block_number, contract, event, args) VALUES ($1,$2,$3,$4,$5,'{}')", [tx, i, b, c, e]);
    await ins("0xa", 0, 1, G, "Drawn");
    await ins("0xb", 0, 2, G, "Revoked");
    await ins("0xc", 0, 3, "0x4444444444444444444444444444444444444444", "Drawn");
    const all = await (await app.request("/v1/activity")).json();
    expect(all.activity.map((a: any) => a.tx_hash)).toEqual(["0xc", "0xb", "0xa"]);
    const f = await (await app.request(`/v1/activity?contract=${G}&event=Drawn`)).json();
    expect(f.activity).toHaveLength(1);
    expect((await (await app.request("/v1/activity?limit=1")).json()).activity).toHaveLength(1);
    expect((await app.request("/v1/activity?limit=999")).status).toBe(400);
    expect((await app.request("/v1/activity?event=Drop;--")).status).toBe(400);
  });
});
