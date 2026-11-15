import { describe, it, expect } from "vitest";
import { json, testApp } from "./helpers.js";

const SANDBOX = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const OTHER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const AGENT = "0xcccccccccccccccccccccccccccccccccccccccc" as const;
const MUSD = (n: number) => (BigInt(n) * 10n ** 18n).toString();

const opts = (over: any = {}) => ({
  sandboxAccount: SANDBOX,
  dailyCapMusd: "5",
  maxDays: 7,
  appUrl: "https://sternpost-pink.vercel.app",
  isAccount: async (a: string) => a.toLowerCase() === SANDBOX,
  ...over,
});

const body = (over: any = {}) => ({
  account: SANDBOX,
  agent: AGENT,
  purpose: "sandbox trial",
  budget: MUSD(5),
  days: 1,
  sandbox: false,
  ...over,
});

describe("POST /v1/session-requests", () => {
  it("sandbox: 503 while no sandbox account is configured", async () => {
    const { app } = await testApp({ sessionRequests: opts({ sandboxAccount: null }) });
    const res = await app.request("/v1/session-requests", json(body({ sandbox: true })));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "sandbox_not_configured" });
  });

  it("sandbox: grants within the 5 MUSD/day cap", async () => {
    const { app } = await testApp({ sessionRequests: opts() });
    const res = await app.request("/v1/session-requests", json(body({ sandbox: true })));
    expect(res.status).toBe(201);
    const b: any = await res.json();
    expect(b.status).toBe("sandbox_granted");
    expect(b.session.account).toBe(SANDBOX);
    expect(b.session.dailyLimit).toBe(MUSD(5));
    expect(b.session.network).toBe("testnet");
    expect(b.request.status).toBe("sandbox_granted");
  });

  it("sandbox: budget spread over days still respects the daily cap", async () => {
    const { app } = await testApp({ sessionRequests: opts() });
    const ok = await app.request("/v1/session-requests", json(body({ sandbox: true, budget: MUSD(10), days: 2 })));
    expect(ok.status).toBe(201);
    const over = await app.request("/v1/session-requests", json(body({ sandbox: true, budget: MUSD(10), days: 1 })));
    expect(over.status).toBe(400);
    expect(await over.json()).toMatchObject({ error: "sandbox_cap_exceeded" });
  });

  it("sandbox: rejects days beyond the cap and a non-sandbox account", async () => {
    const { app } = await testApp({ sessionRequests: opts() });
    const days = await app.request("/v1/session-requests", json(body({ sandbox: true, days: 8 })));
    expect(days.status).toBe(400);
    const acct = await app.request("/v1/session-requests", json(body({ sandbox: true, account: OTHER })));
    expect(acct.status).toBe(400);
    expect(await acct.json()).toMatchObject({ error: "sandbox_account_mismatch" });
  });

  it("non-sandbox: pending + Crew approve URL for factory accounts", async () => {
    const { app } = await testApp({ sessionRequests: opts() });
    const res = await app.request("/v1/session-requests", json(body()));
    expect(res.status).toBe(201);
    const b: any = await res.json();
    expect(b.status).toBe("pending");
    expect(b.approveUrl).toBe(`https://sternpost-pink.vercel.app/app/crew?request=${b.request.id}`);
  });

  it("non-sandbox: refuses non-factory accounts when the factory is configured", async () => {
    const { app } = await testApp({ sessionRequests: opts() });
    const res = await app.request("/v1/session-requests", json(body({ account: OTHER })));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "not_factory_account" });
  });

  it("validates addresses and budget", async () => {
    const { app } = await testApp({ sessionRequests: opts() });
    const res = await app.request("/v1/session-requests", json(body({ agent: "0x123" })));
    expect(res.status).toBe(400);
  });

  it("GET lists requests, filterable by account", async () => {
    const { app } = await testApp({ sessionRequests: opts() });
    await app.request("/v1/session-requests", json(body()));
    await app.request("/v1/session-requests", json(body({ sandbox: true })));
    const all: any = await (await app.request("/v1/session-requests")).json();
    expect(all.requests).toHaveLength(2);
    const one: any = await (await app.request(`/v1/session-requests?account=${SANDBOX}`)).json();
    expect(one.requests).toHaveLength(2);
  });
});
