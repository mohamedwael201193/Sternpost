import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { testApp } from "./helpers.js";
import { rateLimit } from "../src/middleware/rateLimit.js";
import { loadConfig } from "../src/config.js";

describe("app shell", () => {
  it("health reports db + chain", async () => {
    const { app } = await testApp();
    const b = await (await app.request("/health")).json();
    expect(b).toMatchObject({ status: "ok", db: "ok", chain: { block: "123" } });
  });
  it("health degrades when db is down", async () => {
    const { app } = await testApp({ db: { query: async () => { throw new Error("x"); } }, snapshot: async () => { throw new Error("rpc"); } });
    const r = await app.request("/health");
    expect(r.status).toBe(503);
    expect((await r.json()).chain).toBe("unreachable");
  });
  it("CORS allows configured and wildcard vercel origins only", async () => {
    const { app } = await testApp();
    const o = (origin: string) => app.request("/v1/apps", { headers: { origin } }).then((r) => r.headers.get("access-control-allow-origin"));
    expect(await o("https://sternpost.vercel.app")).toBe("https://sternpost.vercel.app");
    expect(await o("https://preview-x.vercel.app")).toBe("https://preview-x.vercel.app");
    expect(await o("https://evil.com")).toBeNull();
  });
  it("404 json, root info, 500 on internal errors", async () => {
    const { app } = await testApp({ db: { query: async () => { throw new Error("boom"); } } });
    expect((await app.request("/nope")).status).toBe(404);
    expect((await app.request("/")).status).toBe(200);
    expect((await app.request("/v1/apps")).status).toBe(500);
  });
  it("rejects oversized bodies", async () => {
    const { app } = await testApp();
    const r = await app.request("/v1/apps", { method: "POST", headers: { "content-type": "application/json", "content-length": "40000" }, body: "x".repeat(40000) });
    expect(r.status).toBe(413);
  });
});

describe("rateLimit", () => {
  it("limits per IP and resets after the window", async () => {
    let t = 0;
    const a = new Hono().use(rateLimit(2, 1000, () => t)).get("/", (c) => c.text("ok"));
    const hit = () => a.request("/", { headers: { "x-forwarded-for": "1.2.3.4" } });
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(200);
    const r = await hit();
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("1");
    t = 1001;
    expect((await hit()).status).toBe(200);
  });
});

describe("config", () => {
  it("applies defaults and rejects bad addresses", () => {
    const c = loadConfig({});
    expect(c.CHAIN_ID).toBe(31611);
    expect(() => loadConfig({ X402_PAY_TO: "0x1" })).toThrow();
  });
});
