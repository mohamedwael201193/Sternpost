import { describe, it, expect, vi } from "vitest";
import { relayDraw, validateRelayDraw, RelayRateLimiter, type RelayerDeps } from "../src/relayer/relayer.js";
import { json, testApp } from "./helpers.js";

const FACTORY = "0xfafafafafafafafafafafafafafafafafafafafa" as const;
const ACCOUNT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const OTHER = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
const AGENT = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const PAYEE = "0xcccccccccccccccccccccccccccccccccccccccc" as const;
const SIG = ("0x" + "11".repeat(65)) as `0x${string}`;
const TX = "0x9999999999999999999999999999999999999999999999999999999999999999" as const;

const base = (over: Partial<any> = {}) => ({
  chainId: 31611,
  account: ACCOUNT,
  agent: AGENT,
  payee: PAYEE,
  amount: 10n ** 18n,
  deadline: Math.floor(Date.now() / 1000) + 600,
  sig: SIG,
  ...over,
});

const wire = (over: Partial<any> = {}) => {
  const b = base(over);
  return { ...b, amount: b.amount.toString() };
};

const stubDeps = (over: Partial<RelayerDeps> = {}): RelayerDeps => ({
  factory: FACTORY,
  isAccount: async (a) => a.toLowerCase() === ACCOUNT,
  relayerAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as `0x${string}`,
  simulate: async () => {},
  send: async () => TX,
  rateLimit: new RelayRateLimiter(20, 3_600_000, () => 1_000_000),
  ...over,
});

describe("validateRelayDraw", () => {
  const now = 1_700_000_000;
  it("refuses mainnet (31612)", () => {
    expect(validateRelayDraw(base({ chainId: 31612 }), now)).toEqual({ error: "mainnet_refused", status: 403 });
  });
  it("refuses any other chain", () => {
    expect(validateRelayDraw(base({ chainId: 1 }), now)).toEqual({ error: "unsupported_network", status: 400 });
  });
  it("refuses expired intents, zero amounts and short sigs", () => {
    expect(validateRelayDraw(base({ deadline: now - 1 }), now)?.error).toBe("intent_expired");
    expect(validateRelayDraw(base({ amount: 0n }), now)?.error).toBe("zero_amount");
    expect(validateRelayDraw(base({ sig: "0x1234" as any }), now)?.error).toBe("bad_signature");
  });
  it("accepts a well-formed testnet intent", () => {
    expect(validateRelayDraw(base({ deadline: now + 60 }), now)).toBeNull();
  });
});

describe("relayDraw", () => {
  it("refuses mainnet before touching the factory or the key", async () => {
    const isAccount = vi.fn(async () => true);
    const send = vi.fn(async () => TX);
    const res = await relayDraw(stubDeps({ isAccount, send }), base({ chainId: 31612 }));
    expect(res).toEqual({ ok: false, error: "mainnet_refused", status: 403 });
    expect(isAccount).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it("fails closed when no factory is configured", async () => {
    const res = await relayDraw(stubDeps({ factory: null }), base());
    expect(res).toEqual({ ok: false, error: "factory_not_configured", status: 503 });
  });
  it("refuses non-factory accounts", async () => {
    const send = vi.fn(async () => TX);
    const res = await relayDraw(stubDeps({ send }), base({ account: OTHER }));
    expect(res).toEqual({ ok: false, error: "not_factory_account", status: 403 });
    expect(send).not.toHaveBeenCalled();
  });
  it("refuses when the factory read fails (fail closed)", async () => {
    const res = await relayDraw(stubDeps({ isAccount: async () => { throw new Error("rpc down"); } }), base());
    expect(res).toEqual({ ok: false, error: "not_factory_account", status: 403 });
  });
  it("enforces 20/hour per agent", async () => {
    let t = 1_000_000;
    const limiter = new RelayRateLimiter(2, 3_600_000, () => t);
    const deps = stubDeps({ rateLimit: limiter });
    expect((await relayDraw(deps, base())).ok).toBe(true);
    expect((await relayDraw(deps, base())).ok).toBe(true);
    expect(await relayDraw(deps, base())).toEqual({ ok: false, error: "relay_rate_limited", status: 429 });
    t += 3_600_001; // next hour: quota resets
    expect((await relayDraw(deps, base())).ok).toBe(true);
  });
  it("returns 503 when no relayer key is configured", async () => {
    const send = vi.fn(async () => TX);
    const res = await relayDraw(stubDeps({ relayerAddress: null, send }), base());
    expect(res).toEqual({ ok: false, error: "relayer_unavailable", status: 503 });
    expect(send).not.toHaveBeenCalled();
  });
  it("refused requests do not burn rate-limit quota (limit is taken only after simulation)", async () => {
    let t = 1_000_000;
    const limiter = new RelayRateLimiter(2, 3_600_000, () => t);
    const send = vi.fn(async () => TX);
    const deps = stubDeps({ rateLimit: limiter, send, simulate: async () => { throw new Error("BelowFloor()"); } });
    expect(await relayDraw(deps, base())).toMatchObject({ error: "simulation_failed" });
    expect(send).not.toHaveBeenCalled();
    const okDeps = stubDeps({ rateLimit: limiter, send });
    expect((await relayDraw(okDeps, base())).ok).toBe(true);
    expect((await relayDraw(okDeps, base())).ok).toBe(true);
    // Only the two successful relays consumed quota: the refused one did not.
    expect(await relayDraw(okDeps, base())).toEqual({ ok: false, error: "relay_rate_limited", status: 429 });
  });
  it("returns 502 relay_send_failed when the broadcast fails", async () => {
    const send = vi.fn(async () => { throw new Error("nonce too low"); });
    const res = await relayDraw(stubDeps({ send }), base());
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("relay_send_failed");
      expect(res.status).toBe(502);
      expect(res.reason).toContain("nonce too low");
    }
  });
  it("never sends when simulation reverts", async () => {
    const send = vi.fn(async () => TX);
    const res = await relayDraw(
      stubDeps({ send, simulate: async () => { throw new Error("BelowFloor()"); } }),
      base(),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("simulation_failed");
    expect(send).not.toHaveBeenCalled();
  });
  it("relays a factory account after simulation", async () => {
    const res = await relayDraw(stubDeps(), base());
    expect(res).toEqual({ ok: true, txHash: TX, relayedBy: "sternpost-relayer", network: "eip155:31611" });
  });
});

describe("POST /v1/relay/draw", () => {
  it("refuses mainnet and non-factory accounts at the route", async () => {
    const { app } = await testApp({ relayer: stubDeps() });
    const mainnet = await app.request("/v1/relay/draw", json(wire({ chainId: 31612 })));
    expect(mainnet.status).toBe(403);
    expect(await mainnet.json()).toMatchObject({ error: "mainnet_refused" });
    const other = await app.request("/v1/relay/draw", json(wire({ account: OTHER })));
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ error: "not_factory_account" });
  });
  it("returns 202 with the tx hash for a factory account", async () => {
    const { app } = await testApp({ relayer: stubDeps() });
    const res = await app.request("/v1/relay/draw", json(wire()));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ txHash: TX, relayedBy: "sternpost-relayer", network: "eip155:31611" });
  });
  it("rejects malformed bodies", async () => {
    const { app } = await testApp({ relayer: stubDeps() });
    const res = await app.request("/v1/relay/draw", json(wire({ sig: "0x1234" })));
    expect(res.status).toBe(400);
  });
});
