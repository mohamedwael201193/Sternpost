import { describe, it, expect, vi } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createAccountClient,
  predictAccount,
  computeHints,
  collateralForICR,
  DEFAULT_POLICY,
  type Policy,
} from "../src/account.js";
import { testnetAddresses } from "../src/chain.js";
import { accountDomain, drawIntentTypes } from "../src/typed.js";
import type { Address, Hex } from "viem";

// Public anvil test vectors (valueless).
const AGENT_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f3ff80";
const agent = privateKeyToAccount(AGENT_KEY);
const owner = privateKeyToAccount(OWNER_KEY);
const ACCOUNT = "0x2222222222222222222222222222222222222222" as Address;
const PAYEE = "0xC3376296a18ef364eA19287203EEd7a87f18e738" as Address;
const SALT = "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex;
const POLICY: Policy = { ...DEFAULT_POLICY };

const TX = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex;

/** A mock viem public client dispatching on functionName. */
function mockPublic(impl: Record<string, (args: never) => unknown>) {
  return {
    readContract: vi.fn(async (a: { functionName: string }) => impl[a.functionName]?.(a as never)),
    multicall: vi.fn(async () => []),
    getBalance: vi.fn(async () => 0n),
    estimateContractGas: vi.fn(async () => 100_000n),
    waitForTransactionReceipt: vi.fn(async () => ({ status: "success" as const })),
  };
}

function mockWallet(account: { address: Address }) {
  return { account, writeContract: vi.fn(async () => TX) };
}

describe("createAccountClient guards", () => {
  it("refuses mainnet: no Sternpost deployment exists there yet", () => {
    expect(() => createAccountClient({ network: "mainnet", account: ACCOUNT })).toThrow("no Sternpost deployment on mainnet");
  });

  it("draw/signIntent/payByBorrow need an agent key", async () => {
    const c = createAccountClient({ network: "testnet", account: ACCOUNT, publicClient: mockPublic({}) as never });
    await expect(c.draw(PAYEE, 1n)).rejects.toThrow("agent key");
    await expect(c.signIntent(PAYEE, 1n)).rejects.toThrow("agent key");
    await expect(c.payByBorrow("https://demo.vativ.io/")).rejects.toThrow("agent key");
  });

  it("owner calls need an owner key", async () => {
    const c = createAccountClient({
      network: "testnet",
      account: ACCOUNT,
      publicClient: mockPublic({}) as never,
      agentWallet: mockWallet(agent) as never,
    });
    await expect(c.setSession(agent.address, { budget: 1n, perTx: 1n, dailyLimit: 0n, expiry: 1n })).rejects.toThrow("owner key");
    await expect(c.open({ debt: 1n, collateral: 1n })).rejects.toThrow("owner key");
    await expect(c.closeAccount()).rejects.toThrow("owner key");
  });
});

describe("predictAccount", () => {
  it("reads the factory predict() with (owner, salt, policy)", async () => {
    const predicted = "0x3333333333333333333333333333333333333333" as Address;
    const pub = mockPublic({ predict: async () => predicted });
    const out = await predictAccount(pub as never, owner.address, SALT, POLICY);
    expect(out).toBe(predicted);
    const call = (pub.readContract as ReturnType<typeof vi.fn>).mock.calls[0][0] as { address: Address; functionName: string; args: unknown[] };
    expect(call.address.toLowerCase()).toBe(testnetAddresses.accountFactory.toLowerCase());
    expect(call.functionName).toBe("predict");
    expect(call.args[0]).toBe(owner.address);
    expect(call.args[1]).toBe(SALT);
    expect(call.args[2]).toEqual(POLICY);
  });
});

describe("computeHints", () => {
  it("calls HintHelpers then SortedTroves and returns the insertion neighbours", async () => {
    const pub = mockPublic({
      computeNominalCR: async () => 1_500_000_000_000_000_000_000n,
      getApproxHint: async () => ["0x4444444444444444444444444444444444444444" as Address, 0n, 42n],
      findInsertPosition: async () => ["0x5555555555555555555555555555555555555555" as Address, "0x6666666666666666666666666666666666666666" as Address],
    });
    const hints = await computeHints(1_000_000_000_000_000_000n, 1_000_000_000_000_000_000_000n, pub as never);
    expect(hints).toEqual({ up: "0x5555555555555555555555555555555555555555", lo: "0x6666666666666666666666666666666666666666" });
    const calls = (pub.readContract as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as { address: string; functionName: string }).functionName);
    expect(calls).toEqual(["computeNominalCR", "getApproxHint", "findInsertPosition"]);
    const addrs = (pub.readContract as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as { address: string }).address.toLowerCase());
    expect(addrs[0]).toBe(testnetAddresses.hintHelpers.toLowerCase());
    expect(addrs[2]).toBe(testnetAddresses.sortedTroves.toLowerCase());
  });

  it("returns (0, 0) for zero debt without any RPC call", async () => {
    const pub = mockPublic({});
    expect(await computeHints(1n, 0n, pub as never)).toEqual({
      up: "0x0000000000000000000000000000000000000000",
      lo: "0x0000000000000000000000000000000000000000",
    });
    expect(pub.readContract).not.toHaveBeenCalled();
  });
});

describe("collateralForICR (pure)", () => {
  it("1800 MUSD @250% @ $64,160 -> 0.07800 BTC (composite 2001.8 incl. the 1.8 fee)", () => {
    // The plan's worked example says 0.07794 BTC, but that arithmetic omits
    // the 1.8 MUSD borrowing fee: (1800+200)*2.5/64160 = 0.07793. The
    // stated formula (debt + 0.1% fee + 200) composites to 2001.8, which is
    // the on-chain principal the lab measured, and gives 0.07800 BTC.
    expect(collateralForICR(2.5, 1_800n * 10n ** 18n, 64_160n * 10n ** 18n)).toBe(78_000_311_720_698_254n);
  });

  it("zero debt needs only the 200 MUSD gas-comp collateral", () => {
    expect(collateralForICR(2.5, 0n, 64_160n * 10n ** 18n)).toBe(7_793_017_456_359_102n);
  });

  it("scales linearly with the ICR", () => {
    const at25 = collateralForICR(2.5, 1_800n * 10n ** 18n, 64_160n * 10n ** 18n);
    const at125 = collateralForICR(1.25, 1_800n * 10n ** 18n, 64_160n * 10n ** 18n);
    expect(at25).toBe(at125 * 2n);
  });
});

describe("session / previewDraw mapping", () => {
  it("session() maps the tuple and derives remaining", async () => {
    const pub = mockPublic({
      sessions: async () => [10n * 10n ** 18n, 3n * 10n ** 18n, 5n * 10n ** 18n, 4n * 10n ** 18n, 1n * 10n ** 18n, 1_800_000_000n, 1_700_000_000n, 2, 1, true, true, true],
    });
    const c = createAccountClient({ network: "testnet", account: ACCOUNT, publicClient: pub as never });
    const s = await c.session(agent.address);
    expect(s.budget).toBe(10n * 10n ** 18n);
    expect(s.spent).toBe(3n * 10n ** 18n);
    expect(s.remaining).toBe(7n * 10n ** 18n);
    expect(s.perTx).toBe(5n * 10n ** 18n);
    expect(s.anyPayee).toBe(true);
    expect(s.canSignX402).toBe(true);
    expect(s.active).toBe(true);
  });

  it("previewDraw() maps reasonCode 6 to BELOW_FLOOR", async () => {
    const pub = mockPublic({ previewDraw: async () => [false, 6, 1_100_000_000_000_000_000n, 1_000_000_000_000n] });
    const c = createAccountClient({ network: "testnet", account: ACCOUNT, publicClient: pub as never });
    const p = await c.previewDraw(agent.address, PAYEE, 1n);
    expect(p).toEqual({ ok: false, reason: "BELOW_FLOOR", reasonCode: 6, icrAfter: 1_100_000_000_000_000_000n, fee: 1_000_000_000_000n });
  });
});

describe("write paths (mocked chain)", () => {
  it("draw() pads gas to the 1.5M minimum and targets the account", async () => {
    const pub = mockPublic({});
    const wallet = mockWallet(agent);
    const c = createAccountClient({
      network: "testnet",
      account: ACCOUNT,
      publicClient: pub as never,
      agentWallet: wallet as never,
    });
    const hash = await c.draw(ACCOUNT, 1_000_000_000_000_000n);
    expect(hash).toBe(TX);
    const call = (wallet.writeContract as ReturnType<typeof vi.fn>).mock.calls[0][0] as { address: Address; functionName: string; args: unknown[]; gas: bigint };
    expect(call.address).toBe(ACCOUNT);
    expect(call.functionName).toBe("draw");
    expect(call.args).toEqual([ACCOUNT, 1_000_000_000_000_000n]);
    expect(call.gas).toBe(1_500_000n); // estimate 100k padded (200k) < 1.5M minimum
  });

  it("draw() uses estimate*1.5+50k when it exceeds the minimum", async () => {
    const pub = mockPublic({});
    (pub.estimateContractGas as ReturnType<typeof vi.fn>).mockResolvedValue(2_000_000n);
    const wallet = mockWallet(agent);
    const c = createAccountClient({
      network: "testnet",
      account: ACCOUNT,
      publicClient: pub as never,
      agentWallet: wallet as never,
    });
    await c.draw(ACCOUNT, 1n);
    const call = (wallet.writeContract as ReturnType<typeof vi.fn>).mock.calls[0][0] as { gas: bigint };
    expect(call.gas).toBe(3_050_000n); // 2M + 1M + 50k
  });

  it("setSession() passes the args in contract order with defaults", async () => {
    const pub = mockPublic({});
    const wallet = mockWallet(owner);
    const c = createAccountClient({
      network: "testnet",
      account: ACCOUNT,
      publicClient: pub as never,
      ownerWallet: wallet as never,
    });
    await c.setSession(agent.address, { budget: 10n, perTx: 5n, dailyLimit: 0n, expiry: 99n });
    const call = (wallet.writeContract as ReturnType<typeof vi.fn>).mock.calls[0][0] as { functionName: string; args: unknown[] };
    expect(call.functionName).toBe("setSession");
    expect(call.args).toEqual([agent.address, 10n, 5n, 0n, 99n, false, false]);
  });

  it("signIntent() via the client reads intentNonce and recovers to the agent", async () => {
    const pub = mockPublic({ intentNonce: async () => 3n });
    const c = createAccountClient({
      network: "testnet",
      account: ACCOUNT,
      publicClient: pub as never,
      agentWallet: mockWallet(agent) as never,
    });
    const intent = await c.signIntent(PAYEE, 1_000_000_000_000_000n);
    expect(intent.nonce).toBe(3n);
    expect(
      await recoverTypedDataAddress({
        domain: accountDomain(31611, ACCOUNT),
        types: drawIntentTypes,
        primaryType: "DrawIntent",
        message: { agent: intent.agent, payee: intent.payee, amount: intent.amount, nonce: intent.nonce, deadline: intent.deadline },
        signature: intent.sig,
      }),
    ).toBe(agent.address);
  });

  it("open() creates the account first when isAccount() is false, then opens with value", async () => {
    const pub = mockPublic({
      isAccount: async () => false,
      computeNominalCR: async () => 1_200_000_000_000_000_000_000n,
      getApproxHint: async () => ["0x4444444444444444444444444444444444444444" as Address, 0n, 42n],
      findInsertPosition: async () => ["0x5555555555555555555555555555555555555555" as Address, "0x6666666666666666666666666666666666666666" as Address],
    });
    const wallet = mockWallet(owner);
    const c = createAccountClient({
      network: "testnet",
      account: ACCOUNT,
      publicClient: pub as never,
      ownerWallet: wallet as never,
      salt: SALT,
      policy: POLICY,
    });
    await c.open({ debt: 1_800n * 10n ** 18n, collateral: 40_000_000_000_000_000n });
    const calls = (wallet.writeContract as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => (call[0] as { functionName: string }).functionName,
    );
    expect(calls).toEqual(["createAccount", "open"]);
    const openCall = (wallet.writeContract as ReturnType<typeof vi.fn>).mock.calls[1][0] as {
      address: Address;
      functionName: string;
      args: unknown[];
      value: bigint;
      gas: bigint;
    };
    expect(openCall.address).toBe(ACCOUNT);
    expect(openCall.value).toBe(40_000_000_000_000_000n);
    expect(openCall.gas).toBe(6_000_000n);
    expect(openCall.args[0]).toBe(1_800n * 10n ** 18n);
  });
});
