import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import {
  ADDRESSES,
  CHAIN_ID,
  loadEnv,
  x402PayTo,
  x402Price,
} from "../src/config.js";
import { explain, reasonText } from "../src/reasons.js";
import { safeDeadline } from "../src/chain.js";
import { x402Challenge, x402Requirements } from "../src/x402.js";
import {
  createContext,
  fail,
  guardOutput,
  handleBalance,
  handleGovernorStatus,
  handlePay,
  handlePreviewDraw,
  handleRadar,
  handleRequestSession,
  handleX402Quote,
  ok,
  rejectCredentialFields,
  toolSchemas,
} from "../src/tools.js";
import { loadOrCreateAgentKey } from "../src/agentKey.js";

/** Plan §5.1 acceptance, offline part: schema, real 402 fixture, refusal reasons, key-not-in-output. */

const ALL_CREDENTIAL_FIELDS = [
  "key",
  "apiKey",
  "api_key",
  "apikey",
  "privateKey",
  "private_key",
  "secret",
  "password",
  "seed",
  "seedPhrase",
  "mnemonic",
];

describe("schemas (plan §5.1 tool set)", () => {
  it("rejects a non-address", () => {
    expect(() => z.object(toolSchemas.balance).parse({ account: "nope" })).toThrow();
  });

  it("pins the chain to Mezo testnet 31611 (addresses are chain-agnostic; the chain is pinned in code)", () => {
    expect(CHAIN_ID).toBe(31611);
  });

  it("rejects a malformed MUSD amount for preview_draw", () => {
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

  it("request_session defaults sandbox to false (plan §5.1) and days to 7", () => {
    const parsed = z.object(toolSchemas.request_session).parse({
      account: ADDRESSES.governor,
      purpose: "pay for radar",
      budget: "10",
    });
    expect(parsed.sandbox).toBe(false);
    expect(parsed.days).toBe(7);
  });

  it("request_session rejects days outside 1..90 and more than 10 payees", () => {
    const base = { account: ADDRESSES.governor, purpose: "p", budget: "10" };
    expect(() => z.object(toolSchemas.request_session).parse({ ...base, days: 0 })).toThrow();
    expect(() => z.object(toolSchemas.request_session).parse({ ...base, days: 91 })).toThrow();
    expect(() =>
      z.object(toolSchemas.request_session).parse({ ...base, payees: Array(11).fill(ADDRESSES.governor) }),
    ).toThrow();
  });

  it("pay requires a url and defaults method to GET, dryRun to false", () => {
    expect(() => z.object(toolSchemas.pay).parse({})).toThrow();
    const parsed = z.object(toolSchemas.pay).parse({ url: "https://demo.vativ.io/" });
    expect(parsed.method).toBe("GET");
    expect(parsed.dryRun).toBe(false);
  });

  it("pay rejects a maxAmount that is not a decimal MUSD string", () => {
    expect(() =>
      z.object(toolSchemas.pay).parse({ url: "https://demo.vativ.io/", maxAmount: "ten" }),
    ).toThrow();
  });

  it("radar accepts an optional account and a testnet|mainnet network", () => {
    expect(z.object(toolSchemas.radar).parse({}).network).toBeUndefined();
    expect(() => z.object(toolSchemas.radar).parse({ network: "devnet" })).toThrow();
  });

  it("rejects an unknown route for x402_quote", () => {
    expect(() => z.object(toolSchemas.x402_quote).parse({ route: "free" })).toThrow();
  });
});

describe("402 fixture (real, from demo.vativ.io)", () => {
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

  it("the live demo.vativ.io fixture decodes to an exact-scheme 402 for 0.001 MUSD on eip155:31611", async () => {
    const fixture = JSON.parse(
      await readFile(new URL("./fixtures/demo-vativ-402.json", import.meta.url), "utf8"),
    ) as {
      status: number;
      decoded: {
        x402Version: number;
        error: string;
        accepts: { scheme: string; network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds: number }[];
      };
    };
    expect(fixture.status).toBe(402);
    expect(fixture.decoded.x402Version).toBe(2);
    expect(fixture.decoded.error).toMatch(/payment required/i);
    const accept = fixture.decoded.accepts[0];
    expect(accept.scheme).toBe("exact");
    expect(accept.network).toBe("eip155:31611");
    expect(accept.amount).toBe("1000000000000000"); // 0.001 MUSD
    expect(accept.asset.toLowerCase()).toBe(ADDRESSES.musd.toLowerCase());
    expect(accept.payTo).toBe("0xC3376296a18ef364eA19287203EEd7a87f18e738");
    expect(accept.maxTimeoutSeconds).toBe(300);
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
    const ctx = stubContext({
      getChainId: async () => 31611,
    });
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

/** Minimal stub PublicClient: canned readContract/getBytecode/getChainId, no network. */
function stubContext(
  impl: {
    readContract?: (args: { functionName: string; args?: unknown[] }) => unknown;
    getBytecode?: () => unknown;
    getChainId?: () => Promise<number>;
    getBalance?: () => Promise<bigint>;
  },
  extraEnv: Record<string, string> = {},
) {
  const ctx = createContext(loadEnv({ ...process.env, STERNPOST_AGENT_KEY_FILE: join(tmpdir(), "sternpost-mcp-no-key-here.json"), ...extraEnv }));
  const client = {
    readContract: async (args: { functionName: string; args?: unknown[] }) => impl.readContract?.(args),
    getBytecode: async () => impl.getBytecode?.() ?? "0x1234",
    getChainId: impl.getChainId ?? (async () => 31611),
    getBalance: impl.getBalance ?? (async () => 0n),
  };
  return { ...ctx, client: client as unknown as typeof ctx.client };
}

describe("snapshots (stub chain, offline)", () => {
  it("balance returns the plan §5.1 shape: session + health + accountMusd", async () => {
    const ctx = stubContext({
      readContract: ({ functionName }) => {
        switch (functionName) {
          case "policy":
            return [2_500_000_000_000_000_000n, 1_600_000_000_000_000_000n, 2_000_000_000_000_000_000n, 1_000_000_000_000_000_000n, 0n, 20];
          case "status":
            return 1;
          case "balanceOf":
            return 5_000_000_000_000_000_000n;
          case "fetchPrice":
            return 64_451_357_300_000_000_000_000n;
          case "getCurrentICR":
            return 2_500_000_000_000_000_000n;
          case "checkRecoveryMode":
            return false;
          default:
            throw new Error(`unexpected call ${functionName}`);
        }
      },
    });
    const res = await handleBalance(ctx, { account: ADDRESSES.governor });
    const p = JSON.parse(res.content[0].text);
    expect(p.ok).toBe(true);
    expect(p.network).toBe("testnet");
    expect(p.agent).toBeNull();
    expect(p.session).toEqual({
      active: false,
      budget: "0",
      spent: "0",
      remaining: "0",
      perTx: "0",
      dailyRemaining: null,
      expiry: null,
      canSignX402: false,
    });
    expect(p.health).toEqual({ icr: 2.5, floor: 2.5, recoveryMode: false, troveStatus: "active" });
    expect(p.accountMusd).toBe("5");
  });

  it("balance refuses an address with no code (not a TroveAccount)", async () => {
    const ctx = stubContext({ getBytecode: () => undefined });
    const res = await handleBalance(ctx, { account: ADDRESSES.governor });
    const p = JSON.parse(res.content[0].text);
    expect(p.refused).toBe(true);
    expect(p.reason).toBe("ACCOUNT_NOT_DEPLOYED");
  });

  it("balance refuses with no account configured", async () => {
    const ctx = stubContext({});
    const res = await handleBalance(ctx, {});
    const p = JSON.parse(res.content[0].text);
    expect(p.refused).toBe(true);
    expect(p.reason).toBe("ACCOUNT_NOT_SET");
  });

  it("preview_draw snapshot: allowed verdict with ICR after, floor, remaining budget", async () => {
    const ctx = stubContext({
      readContract: ({ functionName }) => {
        switch (functionName) {
          case "previewDraw":
            return [true, "", 2_600_000_000_000_000_000n];
          case "floorICR":
            return 2_500_000_000_000_000_000n;
          case "remainingBudget":
            return 100_000_000_000_000_000_000n;
          default:
            throw new Error(`unexpected call ${functionName}`);
        }
      },
    });
    const res = await handlePreviewDraw(ctx, {
      app: ADDRESSES.spendWallet,
      amountMusd: "10",
      payee: ADDRESSES.spendWallet,
    });
    const p = JSON.parse(res.content[0].text);
    expect(p.ok).toBe(true);
    expect(p.allowed).toBe(true);
    expect(p.reason).toBe("");
    expect(p.explanation).toMatch(/Safe/);
    expect(p.icrAfter).toBe("2.6");
    expect(p.floorICR).toBe("2.5");
    expect(p.remainingBudgetMusd).toBe("100");
  });

  it("governor_status snapshot: floor/defend/buffer/standby/ICR/fee, deadline clamped (J3 F4)", async () => {
    const ctx = stubContext({
      readContract: ({ functionName }) => {
        switch (functionName) {
          case "borrower":
            return "0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3";
          case "floorICR":
            return 2_500_000_000_000_000_000n;
          case "defendICR":
            return 1_600_000_000_000_000_000n;
          case "frozen":
            return false;
          case "buffer":
            return 30_000_000_000_000_000_000n;
          case "standby":
            return [30_000_000_000_000_000_000n, 1_797_331_299n, 45n, true];
          case "icr":
            return 2_380_450_065_257_390_321n;
          case "feeBps":
            return 10;
          case "feeRecipient":
            return "0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3";
          case "musd":
            return ADDRESSES.musd;
          case "governorOf":
            return ADDRESSES.governor;
          default:
            throw new Error(`unexpected call ${functionName}`);
        }
      },
    });
    const res = await handleGovernorStatus(ctx, {});
    const p = JSON.parse(res.content[0].text);
    expect(p.ok).toBe(true);
    expect(p.floorICR).toBe("2.5");
    expect(p.defendICR).toBe("1.6");
    expect(p.frozen).toBe(false);
    expect(p.bufferMusd).toBe("30");
    expect(p.standby.amountMusd).toBe("30");
    expect(p.standby.deadline).toBe("1797331299");
    expect(p.standby.deadlineISO).toBe("2026-12-15T10:41:39.000Z");
    expect(p.standby.nonce).toBe("45");
    expect(p.standby.live).toBe(true);
    expect(p.factoryRecognised).toBe(true);
    expect(p.feeBps).toBe(10);
  });

  it("safeDeadline returns the raw value and a null ISO for out-of-range deadlines", () => {
    expect(safeDeadline(1797331299n)).toEqual({ deadline: "1797331299", deadlineISO: "2026-12-15T10:41:39.000Z" });
    const huge = safeDeadline(2n ** 256n - 1n);
    expect(huge.deadline).toBe((2n ** 256n - 1n).toString());
    expect(huge.deadlineISO).toBeNull();
  });

  it("radar falls back to the direct walk when the deployed Radar rank() throws", async () => {
    const ctx = stubContext(
      {
        readContract: ({ functionName }) => {
          switch (functionName) {
            case "fetchPrice":
              return 64_451_357_300_000_000_000_000n;
            case "systemHealth":
              return [0n, 2_300_000_000_000_000_000n, false, 279n];
            case "frontier":
              return ["0x5eaA8bdc315608E8Cf873CFAbA05e42826f68C4d", 1_263_664_234_481_925_800n, 426_003_387_454_256_128_793_338_096n];
            case "rank":
              throw new Error("simulated Radar rank() timeout");
            case "getPrev":
              return "0x0000000000000000000000000000000000000000";
            case "getCurrentICR":
              return 2_500_000_000_000_000_000n;
            case "getEntireDebtAndColl":
              // [coll, principal, interest, ...] — the walk reads the
              // frontier trove itself before getPrev returns zero.
              return [0n, 100n, 0n, 0n, 0n, 0n];
            case "policy":
              return [2_500_000_000_000_000_000n, 1_600_000_000_000_000_000n, 2_000_000_000_000_000_000n, 1_000_000_000_000_000_000n, 0n, 20];
            case "status":
              return 1;
            default:
              throw new Error(`unexpected call ${functionName}`);
          }
        },
      },
      { STERNPOST_RADAR: "0x9Cd95A420e014da798dbFB74833b9D4DEe868be2" },
    );
    const res = await handleRadar(ctx, { account: ADDRESSES.governor });
    const p = JSON.parse(res.content[0].text);
    expect(p.ok).toBe(true);
    expect(p.rankSource).toBe("walk");
    expect(p.rankNote).toMatch(/fell back/);
    // Timeout wording pinned byte-identical (J3 F3): other branches must
    // word their kind distinctly, never relabelled as a timeout.
    expect(p.rankNote).toBe("deployed Radar rank() timed out; fell back to the direct SortedTroves walk");
    expect(p.tcr).toBeCloseTo(2.3);
    expect(p.troveCount).toBe(279);
  });

  /** Radar fallback with a configurable rank() error (J3 F3): same stub as the timeout test, only the thrown error differs. */
  async function radarFallbackWithRankError(rankError: string) {
    const ctx = stubContext(
      {
        readContract: ({ functionName }) => {
          switch (functionName) {
            case "fetchPrice":
              return 64_451_357_300_000_000_000_000n;
            case "systemHealth":
              return [0n, 2_300_000_000_000_000_000n, false, 279n];
            case "frontier":
              return ["0x5eaA8bdc315608E8Cf873CFAbA05e42826f68C4d", 1_263_664_234_481_925_800n, 426_003_387_454_256_128_793_338_096n];
            case "rank":
              throw new Error(rankError);
            case "getPrev":
              return "0x0000000000000000000000000000000000000000";
            case "getCurrentICR":
              return 2_500_000_000_000_000_000n;
            case "getEntireDebtAndColl":
              return [0n, 100n, 0n, 0n, 0n, 0n];
            case "policy":
              return [2_500_000_000_000_000_000n, 1_600_000_000_000_000_000n, 2_000_000_000_000_000_000n, 1_000_000_000_000_000_000n, 0n, 20];
            case "status":
              return 1;
            default:
              throw new Error(`unexpected call ${functionName}`);
          }
        },
      },
      { STERNPOST_RADAR: "0x9Cd95A420e014da798dbFB74833b9D4DEe868be2" },
    );
    const res = await handleRadar(ctx, { account: ADDRESSES.governor });
    return JSON.parse(res.content[0].text) as { rankSource: string; rankNote: string };
  }

  it("radar fallback words a rank() revert distinctly, not as a timeout (J3 F3)", async () => {
    const p = await radarFallbackWithRankError("execution reverted: RankOutOfRange");
    expect(p.rankSource).toBe("walk");
    expect(p.rankNote).toBe("deployed Radar rank() reverted on-chain; fell back to the direct SortedTroves walk");
  });

  it("radar fallback words a rank() ABI-decode failure distinctly (J3 F3)", async () => {
    const p = await radarFallbackWithRankError('The contract function "rank" returned no data ("0x").');
    expect(p.rankSource).toBe("walk");
    expect(p.rankNote).toBe(
      "deployed Radar rank() returned data the Radar ABI could not decode (wrong address or ABI mismatch); fell back to the direct SortedTroves walk",
    );
  });

  it("radar fallback redacts a credential-bearing RPC URL from the logged error (J3 O3)", async () => {
    const logged: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args.join(" "));
    };
    try {
      const p = await radarFallbackWithRankError(
        "fetch failed: https://user:s3krit-pass@rpc.test.mezo.org/ — request timed out",
      );
      expect(p.rankSource).toBe("walk");
      expect(p.rankNote).toBe("deployed Radar rank() timed out; fell back to the direct SortedTroves walk");
    } finally {
      console.error = origError;
    }
    expect(logged).toHaveLength(1);
    expect(logged[0]).not.toContain("s3krit-pass");
    expect(logged[0]).toContain("[redacted-credentials]@");
    expect(logged[0]).toContain("timed out");
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

  it("mainnet is refused without STERNPOST_MAINNET_OK=1 (J1 F5: MAINNET_REFUSED is wired, not dead; J3 F4/d: pay, request_session, helpers too)", async () => {
    const ctx = createContext(
      loadEnv({ ...process.env, STERNPOST_NETWORK: "mainnet", STERNPOST_ACCOUNT: ADDRESSES.governor }),
    );
    await expect(handleBalance(ctx, {})).rejects.toThrow(/mainnet is never served unless STERNPOST_MAINNET_OK=1/);
    await expect(handleRadar(ctx, { network: "mainnet" })).rejects.toThrow(/mainnet is never served/);
    await expect(handlePay(ctx, { url: "https://demo.vativ.io/", dryRun: true })).rejects.toThrow(
      /mainnet is never served/,
    );
    await expect(
      handleRequestSession(ctx, { account: ADDRESSES.governor, purpose: "mainnet probe", budget: "1" }),
    ).rejects.toThrow(/mainnet is never served/);
    await expect(
      handlePreviewDraw(ctx, { app: ADDRESSES.spendWallet, amountMusd: "10", payee: ADDRESSES.spendWallet }),
    ).rejects.toThrow(/mainnet is never served/);
    await expect(handleGovernorStatus(ctx, {})).rejects.toThrow(/mainnet is never served/);
    await expect(handleX402Quote(ctx, { route: "radar" })).rejects.toThrow(/mainnet is never served/);
  });
});

describe("pay (offline, local 402 server + stub chain)", () => {
  const fixtureHeader = async () => {
    const fixture = JSON.parse(
      await readFile(new URL("./fixtures/demo-vativ-402.json", import.meta.url), "utf8"),
    ) as { paymentRequiredHeader: string };
    return fixture.paymentRequiredHeader;
  };

  async function with402Server(headerValue: string, run: (url: string) => Promise<void>) {
    const server = createServer((_req, res) => {
      res.writeHead(402, { "payment-required": headerValue, "content-type": "application/json" });
      res.end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      await run(`http://127.0.0.1:${port}/`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it("dryRun parses the real demo.vativ.io 402 and runs previewDraw only (no tx)", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "sternpost-mcp-test-"));
    try {
      const env = loadEnv({
        ...process.env,
        STERNPOST_ACCOUNT: ADDRESSES.governor,
        STERNPOST_AGENT_KEY_FILE: join(tmp, "agent.json"),
        STERNPOST_API: "http://127.0.0.1:9",
      });
      const { key } = await loadOrCreateAgentKey(env);
      const ctx = createContext(env);
      const stubClient = {
        readContract: async ({ functionName }: { functionName: string }) => {
          if (functionName === "previewDraw") return [true, 0, 2_600_000_000_000_000_000n, 1_000_000_000_000_000n];
          throw new Error(`unexpected call ${functionName}`);
        },
        getChainId: async () => 31611,
        getBytecode: async () => "0x1234",
        getBalance: async () => 0n,
      };
      const ctxStub = { ...ctx, client: stubClient as unknown as typeof ctx.client };
      await with402Server(await fixtureHeader(), async (url) => {
        const res = await handlePay(ctxStub, { url, dryRun: true });
        const p = JSON.parse(res.content[0].text);
        expect(p.status).toBe("dry_run");
        expect(p.amount).toBe("0.001");
        expect(p.payTo).toBe("0xC3376296a18ef364eA19287203EEd7a87f18e738");
        expect(p.network).toBe("eip155:31611");
        expect(p.refillTx).toBeNull();
        expect(p.settleTx).toBeNull();
        expect(p.responseStatus).toBe(402);
        expect(p.preview.allowed).toBe(true);
        expect(p.preview.reason).toBe("");
        expect(p).not.toHaveProperty("privateKey");
        expect(JSON.stringify(p)).not.toContain(key.privateKey);
      });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("dryRun refuses OVER_MAX when the 402 asks for more than maxAmount", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "sternpost-mcp-test-"));
    try {
      const env = loadEnv({
        ...process.env,
        STERNPOST_ACCOUNT: ADDRESSES.governor,
        STERNPOST_AGENT_KEY_FILE: join(tmp, "agent.json"),
      });
      await loadOrCreateAgentKey(env);
      const ctx = createContext(env);
      const stubClient = {
        readContract: async () => {
          throw new Error("previewDraw must not run on an OVER_MAX refusal");
        },
        getChainId: async () => 31611,
      };
      const ctxStub = { ...ctx, client: stubClient as unknown as typeof ctx.client };
      await with402Server(await fixtureHeader(), async (url) => {
        const res = await handlePay(ctxStub, { url, dryRun: true, maxAmount: "0.0001" });
        const p = JSON.parse(res.content[0].text);
        expect(p.status).toBe("refused");
        expect(p.reason).toBe("OVER_MAX");
      });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("pay refuses without an account, and without an agent key", async () => {
    const noAccount = createContext(loadEnv({ ...process.env, STERNPOST_ACCOUNT: undefined }));
    const res = await handlePay(noAccount, { url: "https://demo.vativ.io/", dryRun: true });
    expect(JSON.parse(res.content[0].text).reason).toBe("ACCOUNT_NOT_SET");
    const tmp = await mkdtemp(join(tmpdir(), "sternpost-mcp-test-"));
    try {
      const noKey = createContext(
        loadEnv({ ...process.env, STERNPOST_ACCOUNT: ADDRESSES.governor, STERNPOST_AGENT_KEY_FILE: join(tmp, "nope.json") }),
      );
      const res2 = await handlePay(noKey, { url: "https://demo.vativ.io/", dryRun: true });
      expect(JSON.parse(res2.content[0].text).reason).toBe("SESSION_INACTIVE");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  /**
   * Full-pay harness (J3 F7): a stub chain + an injected stub wallet, so
   * the refill branch runs without a live account. The local 402 server
   * answers 402 for every request (including the retry), so a run that
   * reaches the payment step ends SETTLE_FAILED — the assertions below
   * are about the refill, which happens before that. The facilitator
   * /verify call is the only live call left; it is answered locally.
   * The x402 Permit2 payload path only signs typed data (no chain reads),
   * so the stub readContract only needs previewDraw + balanceOf.
   */
  async function withFullPayHarness(
    opts: {
      balanceOf: bigint;
      /** previewDraw result for the refill leg (payee = account); null = allowed. */
      refillPreview: [boolean, number, bigint, bigint] | null;
      receiptStatus: "success" | "reverted";
      /** When true, waitForTransactionReceipt throws instead of returning a receipt (J3 F5). */
      receiptThrows?: boolean;
    },
    run: (
      url: string,
      ctxStub: ReturnType<typeof createContext>,
      draws: unknown[],
    ) => Promise<void>,
  ) {
    const tmp = await mkdtemp(join(tmpdir(), "sternpost-mcp-test-"));
    try {
      const env = loadEnv({
        ...process.env,
        STERNPOST_ACCOUNT: ADDRESSES.governor,
        STERNPOST_AGENT_KEY_FILE: join(tmp, "agent.json"),
        STERNPOST_API: "http://127.0.0.1:9",
      });
      await loadOrCreateAgentKey(env);
      const ctx = createContext(env);
      const draws: unknown[] = [];
      const stubClient = {
        readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
          if (functionName === "previewDraw") {
            const payee = (args as unknown[])[1] as string;
            // Refill leg = the draw pays the account itself.
            if (opts.refillPreview && payee.toLowerCase() === (ADDRESSES.governor as string).toLowerCase()) {
              return opts.refillPreview;
            }
            return [true, 0, 2_600_000_000_000_000_000n, 1_000_000_000_000_000n];
          }
          if (functionName === "balanceOf") return opts.balanceOf;
          if (functionName === "allowance" || functionName === "nonces") return 0n;
          throw new Error(`unexpected call ${functionName}`);
        },
        getChainId: async () => 31611,
        getBytecode: async () => "0x1234",
        getBalance: async () => 0n,
        waitForTransactionReceipt: async () => {
          if (opts.receiptThrows) throw new Error("Timed out while waiting for transaction receipt");
          return { status: opts.receiptStatus };
        },
      };
      const stubWallet = {
        chain: { id: 31611 },
        writeContract: async (args: unknown) => {
          draws.push(args);
          return "0x1111111111111111111111111111111111111111111111111111111111111111";
        },
      };
      const ctxStub = {
        ...ctx,
        client: stubClient as unknown as typeof ctx.client,
        agentWallet: stubWallet as unknown as NonNullable<typeof ctx.agentWallet>,
      } as unknown as typeof ctx;
      const realFetch = globalThis.fetch;
      globalThis.fetch = (async (input: unknown, init?: unknown) => {
        if (String(input).startsWith("https://facilitator.vativ.io/verify")) {
          return new Response(JSON.stringify({ valid: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return realFetch(input as never, init as never);
      }) as typeof fetch;
      try {
        await with402Server(await fixtureHeader(), async (url) => run(url, ctxStub, draws));
      } finally {
        globalThis.fetch = realFetch;
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  it("pay draws the FULL amount when the balance is partial (0 < balance < amount) (J3 F7a)", async () => {
    await withFullPayHarness(
      { balanceOf: 500_000_000_000_000n, refillPreview: null, receiptStatus: "success" },
      async (url, ctxStub, draws) => {
        const res = await handlePay(ctxStub, { url });
        const p = JSON.parse(res.content[0].text);
        // The retry still 402s (local server), so the payment is refused —
        // but the refill already happened, for the FULL amount.
        expect(p.status).toBe("refused");
        expect(p.reason).toBe("SETTLE_FAILED");
        expect(p.refillTx).toBe("0x1111111111111111111111111111111111111111111111111111111111111111");
        expect(draws).toHaveLength(1);
        const draw = draws[0] as { functionName: string; args: unknown[] };
        expect(draw.functionName).toBe("draw");
        expect(draw.args[0]).toBe(ADDRESSES.governor);
        expect(draw.args[1]).toBe(1_000_000_000_000_000n); // full 0.001 MUSD, NOT the 0.0005 shortfall
      },
    );
  });

  it("pay reports REFILL_FAILED when the refill draw reverts on-chain (J3 F7b)", async () => {
    await withFullPayHarness(
      { balanceOf: 0n, refillPreview: null, receiptStatus: "reverted" },
      async (url, ctxStub, draws) => {
        const res = await handlePay(ctxStub, { url });
        const p = JSON.parse(res.content[0].text);
        expect(p.status).toBe("refused");
        expect(p.reason).toBe("REFILL_FAILED");
        expect(p.refillTx).toBe("0x1111111111111111111111111111111111111111111111111111111111111111");
        expect(p.settleTx).toBeNull();
        expect(p.detail).toMatch(/reverted on-chain/);
        expect(draws).toHaveLength(1);
      },
    );
  });

  it("pay returns REFILL_FAILED with the sent hash when the receipt wait throws (J3 F5)", async () => {
    await withFullPayHarness(
      { balanceOf: 0n, refillPreview: null, receiptStatus: "success", receiptThrows: true },
      async (url, ctxStub, draws) => {
        const res = await handlePay(ctxStub, { url });
        const p = JSON.parse(res.content[0].text);
        expect(p.status).toBe("refused");
        expect(p.reason).toBe("REFILL_FAILED");
        // The draw WAS sent: the hash is kept, not discarded — it may still
        // confirm on-chain, so the response must not claim nothing was paid.
        expect(p.refillTx).toBe("0x1111111111111111111111111111111111111111111111111111111111111111");
        expect(p.settleTx).toBeNull();
        expect(p.detail).toMatch(/may still confirm on-chain/);
        expect(draws).toHaveLength(1);
      },
    );
  });

  it("pay refuses PAYEE_NOT_ALLOWED when the refill leg preview fails (J3 F7b)", async () => {
    await withFullPayHarness(
      {
        balanceOf: 0n,
        refillPreview: [false, 2, 2_600_000_000_000_000_000n, 1_000_000_000_000_000n],
        receiptStatus: "success",
      },
      async (url, ctxStub, draws) => {
        const res = await handlePay(ctxStub, { url });
        const p = JSON.parse(res.content[0].text);
        expect(p.status).toBe("refused");
        expect(p.reason).toBe("PAYEE_NOT_ALLOWED");
        expect(p.refillTx).toBeNull();
        expect(p.detail).toMatch(/refill leg/);
        expect(draws).toHaveLength(0);
      },
    );
  });
});

describe("request_session (offline, temp key file, unreachable API)", () => {
  it("generates a chmod-600 agent key, returns a pending request id + approval link, never the key", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "sternpost-mcp-test-"));
    try {
      const keyPath = join(tmp, "agent.json");
      const env = loadEnv({
        ...process.env,
        STERNPOST_AGENT_KEY_FILE: keyPath,
        STERNPOST_API: "http://127.0.0.1:9",
      });
      const ctx = createContext(env);
      const res = await handleRequestSession(ctx, {
        account: ADDRESSES.governor,
        purpose: "pay for radar",
        budget: "10",
      });
      const p = JSON.parse(res.content[0].text);
      expect(p.ok).toBe(true);
      expect(p.requestId).toMatch(/^req_[0-9a-f]{16}$/);
      expect(p.agent).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(p.status).toBe("pending");
      expect(p.approveUrl).toBe(`https://sternpost-pink.vercel.app/app/crew?request=${p.requestId}`);
      expect(p.telegram).toBe("not_linked");
      expect(p.sandbox).toBe(false);
      expect(p.keyFileCreated).toBe(true);
      const keyRaw = await readFile(keyPath, "utf8");
      const keyJson = JSON.parse(keyRaw) as { privateKey: string; address: string };
      expect(keyJson.address.toLowerCase()).toBe(p.agent.toLowerCase());
      expect(res.content[0].text).not.toContain(keyJson.privateKey);
      expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
      const stored = JSON.parse(await readFile(join(tmp, "requests", `${p.requestId}.json`), "utf8")) as { status: string };
      expect(stored.status).toBe("pending");
      // A second request reuses the same agent key.
      const res2 = await handleRequestSession(ctx, {
        account: ADDRESSES.governor,
        purpose: "second",
        budget: "5",
        sandbox: true,
      });
      const p2 = JSON.parse(res2.content[0].text);
      expect(p2.agent).toBe(p.agent);
      expect(p2.keyFileCreated).toBe(false);
      expect(p2.sandbox).toBe(true);
      expect(p2.note).toMatch(/5 MUSD\/day/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("key never returned", () => {
  const SENTINEL = "sk-test-sentinel-key-never-returned-9f27";

  it("rejects every credential-shaped input field (all 11 blocked fields)", () => {
    for (const field of ALL_CREDENTIAL_FIELDS) {
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

  it("guardOutput throws if the agent private key would leak into a response (J3 obs c)", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "sternpost-mcp-test-"));
    try {
      const keyPath = join(tmp, "agent.json");
      const env = loadEnv({ ...process.env, STERNPOST_AGENT_KEY_FILE: keyPath });
      const { key } = await loadOrCreateAgentKey(env);
      const prev = process.env.STERNPOST_AGENT_KEY_FILE;
      process.env.STERNPOST_AGENT_KEY_FILE = keyPath;
      try {
        expect(() => guardOutput(JSON.stringify({ agent: key.privateKey }))).toThrow(/agent private key/);
        expect(() => guardOutput(JSON.stringify({ ok: true }))).not.toThrow();
      } finally {
        if (prev === undefined) delete process.env.STERNPOST_AGENT_KEY_FILE;
        else process.env.STERNPOST_AGENT_KEY_FILE = prev;
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("guardOutput picks up an in-place key replacement at the same path (J3 F4)", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "sternpost-mcp-test-"));
    try {
      const keyPath = join(tmp, "agent.json");
      const env = loadEnv({ ...process.env, STERNPOST_AGENT_KEY_FILE: keyPath });
      const { key: key1 } = await loadOrCreateAgentKey(env);
      const prev = process.env.STERNPOST_AGENT_KEY_FILE;
      process.env.STERNPOST_AGENT_KEY_FILE = keyPath;
      try {
        // Prime the cache: the first key is scanned for.
        expect(() => guardOutput(JSON.stringify({ agent: key1.privateKey }))).toThrow(/agent private key/);
        // Replace the file in place with a fresh key (same path, same size).
        const key2 = generatePrivateKey();
        await writeFile(
          keyPath,
          JSON.stringify({ address: privateKeyToAccount(key2).address, privateKey: key2 }, null, 2) + "\n",
        );
        // Force a distinct mtime so the change is visible even on a coarse filesystem.
        const later = new Date(Date.now() + 2000);
        await utimes(keyPath, later, later);
        // The stale key is no longer scanned for; the new key is.
        expect(() => guardOutput(JSON.stringify({ agent: key1.privateKey }))).not.toThrow();
        expect(() => guardOutput(JSON.stringify({ agent: key2 }))).toThrow(/agent private key/);
        expect(() => guardOutput(JSON.stringify({ ok: true }))).not.toThrow();
      } finally {
        if (prev === undefined) delete process.env.STERNPOST_AGENT_KEY_FILE;
        else process.env.STERNPOST_AGENT_KEY_FILE = prev;
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("fail() scans thrown errors through the same guard", () => {
    const prev = process.env.STERNPOST_API_KEY;
    process.env.STERNPOST_API_KEY = SENTINEL;
    try {
      expect(() => fail(new Error(`boom ${SENTINEL}`))).toThrow(/secret/);
      const plain = fail(new Error("plain failure"));
      expect(JSON.parse(plain.content[0].text)).toEqual({ ok: false, error: "plain failure" });
    } finally {
      if (prev === undefined) delete process.env.STERNPOST_API_KEY;
      else process.env.STERNPOST_API_KEY = prev;
    }
  });

  it("snapshot: no tool output contains the configured key (x402_quote, offline path)", async () => {
    const prev = process.env.STERNPOST_API_KEY;
    process.env.STERNPOST_API_KEY = SENTINEL;
    try {
      const ctx = stubContext({ getChainId: async () => 31611 });
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

  it("snapshot: balance output contains no key material", async () => {
    const prev = process.env.STERNPOST_API_KEY;
    process.env.STERNPOST_API_KEY = SENTINEL;
    try {
      const ctx = stubContext({
        readContract: ({ functionName }) => {
          switch (functionName) {
            case "policy":
              return [2_500_000_000_000_000_000n, 1_600_000_000_000_000_000n, 2_000_000_000_000_000_000n, 1_000_000_000_000_000_000n, 0n, 20];
            case "status":
              return 1;
            case "balanceOf":
              return 0n;
            case "fetchPrice":
              return 64_451_357_300_000_000_000_000n;
            case "getCurrentICR":
              return 0n;
            case "checkRecoveryMode":
              return false;
            default:
              throw new Error(`unexpected call ${functionName}`);
          }
        },
      });
      const res = await handleBalance(ctx, { account: ADDRESSES.governor });
      const text = res.content[0].text;
      expect(text).not.toContain(SENTINEL);
      expect(text).not.toMatch(/private[_-]?key|seed[_-]?phrase|mnemonic/i);
    } finally {
      if (prev === undefined) delete process.env.STERNPOST_API_KEY;
      else process.env.STERNPOST_API_KEY = prev;
    }
  });
});
