import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ADDRESSES,
  CHAIN_ID,
  loadEnv,
  x402PayTo,
  x402Price,
} from "../src/config.js";
import { explain, reasonText } from "../src/reasons.js";
import { x402Challenge, x402Requirements } from "../src/x402.js";
import {
  createContext,
  guardOutput,
  handleX402Quote,
  ok,
  rejectCredentialFields,
  toolSchemas,
} from "../src/tools.js";

/** Plan §2.1 acceptance, offline part: schema, 402 fixture, refusal reasons, key-not-in-output. */

describe("schemas", () => {
  it("rejects a non-address", () => {
    expect(() => z.object(toolSchemas.balance).parse({ address: "nope" })).toThrow();
  });

  it("rejects a mainnet-looking address on the wrong chain is not a schema matter — addresses are chain-agnostic, chain is pinned in code", () => {
    expect(CHAIN_ID).toBe(31611);
  });

  it("rejects a malformed MUSD amount", () => {
    expect(() =>
      z.object(toolSchemas.preview_draw).parse({
        app: ADDRESSES.spendWallet,
        amountMusd: "10.1234567890123456789",
        payee: ADDRESSES.spendWallet,
      }),
    ).toThrow();
    expect(() =>
      z.object(toolSchemas.preview_draw).parse({
        app: ADDRESSES.spendWallet,
        amountMusd: "-5",
        payee: ADDRESSES.spendWallet,
      }),
    ).toThrow();
  });

  it("defaults sandbox to true", () => {
    const parsed = z.object(toolSchemas.balance).parse({ address: ADDRESSES.governor });
    expect(parsed.sandbox).toBe(true);
  });

  it("rejects an unknown route for x402_quote", () => {
    expect(() => z.object(toolSchemas.x402_quote).parse({ route: "free" })).toThrow();
  });
});

describe("402 fixture", () => {
  it("matches the backend paywall requirements shape exactly", () => {
    const env = loadEnv({ ...process.env, X402_PAY_TO: undefined, X402_PRICE: undefined });
    const req = x402Requirements(env);
    expect(req).toEqual({
      scheme: "exact",
      network: "eip155:31611",
      asset: ADDRESSES.musd,
      amount: "10000000000000000",
      payTo: ADDRESSES.x402PayToInterim,
      maxTimeoutSeconds: 300,
      extra: { name: "Mezo USD", version: "1", assetTransferMethod: "permit2" },
    });
    expect(x402Price(env)).toBe("10000000000000000");
    expect(x402PayTo(env)).toBe(ADDRESSES.x402PayToInterim);
  });

  it("challenge wraps the requirements in the x402 v2 402 shape", () => {
    const env = loadEnv();
    const challenge = x402Challenge(env, "https://sternpost-api.vercel.app/v1/radar", "r");
    expect(challenge.x402Version).toBe(2);
    expect(challenge.error).toBe("payment_required");
    expect(challenge.accepts).toHaveLength(1);
    expect(challenge.accepts[0].scheme).toBe("exact");
  });

  it("x402_quote without an app returns the challenge and no settle of any kind", async () => {
    const ctx = createContext(loadEnv());
    const res = await handleX402Quote(ctx, { route: "radar" });
    const text = res.content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.challenge.error).toBe("payment_required");
    expect(parsed.challenge.accepts[0].network).toBe("eip155:31611");
    expect(parsed.payable).toBeNull();
    expect(parsed).not.toHaveProperty("transaction");
    expect(parsed).not.toHaveProperty("txHash");
    expect(parsed.note).toMatch(/Quote only/);
  });
});

describe("refusal reasons", () => {
  it("explains every previewDraw reason code the governor can return", () => {
    for (const code of [
      "",
      "FROZEN",
      "ZERO_AMOUNT",
      "APP_NOT_AUTHORIZED",
      "APP_EXPIRED",
      "OVER_PER_DRAW",
      "OVER_BUDGET",
      "PAYEE_NOT_ALLOWED",
      "BELOW_FLOOR",
      "TROVE_CLOSED",
      "RECOVERY_MODE",
    ]) {
      expect(reasonText[code]).toBeTruthy();
      expect(explain(code)).toBe(reasonText[code]);
    }
  });
});

describe("key never returned", () => {
  const SENTINEL = "sk-test-sentinel-key-never-returned-9f27";

  it("rejects any credential-shaped input field", () => {
    for (const field of ["key", "apiKey", "api_key", "privateKey", "secret", "password", "seed", "mnemonic"]) {
      expect(() => rejectCredentialFields({ [field]: SENTINEL })).toThrow(/never accepted/);
    }
    expect(() => rejectCredentialFields({ address: ADDRESSES.governor })).not.toThrow();
  });

  it("guardOutput throws if a configured secret would leak into a response", () => {
    const prev = process.env.STERNPOST_API_KEY;
    process.env.STERNPOST_API_KEY = SENTINEL;
    try {
      expect(() => guardOutput(JSON.stringify({ balance: SENTINEL }))).toThrow(/secret/);
      expect(() => guardOutput(JSON.stringify({ ok: true }))).not.toThrow();
    } finally {
      if (prev === undefined) delete process.env.STERNPOST_API_KEY;
      else process.env.STERNPOST_API_KEY = prev;
    }
  });

  it("snapshot: no tool output contains the configured key (x402_quote, offline path)", async () => {
    const prev = process.env.STERNPOST_API_KEY;
    process.env.STERNPOST_API_KEY = SENTINEL;
    try {
      const ctx = createContext(loadEnv());
      const res = await handleX402Quote(ctx, { route: "brief" });
      const text = res.content[0].text;
      expect(text).not.toContain(SENTINEL);
      expect(text).not.toMatch(/api[_-]?key|private[_-]?key|secret/i);
      expect(ok({ note: "snapshot", challenge: JSON.parse(text).challenge }).content[0].text).not.toContain(
        SENTINEL,
      );
    } finally {
      if (prev === undefined) delete process.env.STERNPOST_API_KEY;
      else process.env.STERNPOST_API_KEY = prev;
    }
  });
});
