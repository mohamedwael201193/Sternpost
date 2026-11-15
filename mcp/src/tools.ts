import { z } from "zod";
import type { Address, PublicClient } from "viem";
import {
  ADDRESSES,
  CHAIN_ID,
  addressSchema,
  loadEnv,
  sandboxSchema,
  x402PayTo,
  x402Price,
  type McpEnv,
} from "./config.js";
import {
  assertTestnet,
  createClient,
  explorerAddress,
  factoryAbi,
  formatUnits,
  governorAbi,
  musdAbi,
  parseMusd,
  spendWalletAbi,
} from "./chain.js";
import { REFUSALS, explain } from "./reasons.js";
import { X402_ROUTES, x402Challenge, type X402Route } from "./x402.js";

/**
 * KEY RULE: this server holds no private key, accepts no key as input, and
 * never returns one. Tool inputs are rejected if they carry any
 * credential-shaped field, and every serialized response is scanned for the
 * value of STERNPOST_API_KEY (if set) before it leaves the server.
 */
const FORBIDDEN_INPUT_FIELDS = [
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

export function rejectCredentialFields(args: unknown): void {
  if (args !== null && typeof args === "object") {
    for (const k of Object.keys(args as Record<string, unknown>)) {
      if (FORBIDDEN_INPUT_FIELDS.includes(k)) {
        throw new Error(
          `refused: field "${k}" is never accepted by this server (no keys are taken or returned)`,
        );
      }
    }
  }
}

/** Throws if the serialized output contains a configured secret value. */
export function guardOutput(text: string): void {
  const secret = process.env.STERNPOST_API_KEY;
  if (secret && secret.length >= 8 && text.includes(secret)) {
    throw new Error("refused: response would contain a configured secret value");
  }
}

export function ok(result: unknown): {
  content: { type: "text"; text: string }[];
} {
  const text = JSON.stringify(result, null, 2);
  guardOutput(text);
  return { content: [{ type: "text", text }] };
}

export function refusal(reason: string, detail?: string) {
  return ok({ ok: false, refused: true, reason, ...(detail ? { detail } : {}) });
}

function requireSandbox(args: { sandbox?: boolean }) {
  if (args.sandbox === false) return refusal("SANDBOX_REQUIRED", REFUSALS.SANDBOX_REQUIRED);
  return null;
}

/** Zod raw shapes for McpServer.registerTool (strict: unknown fields rejected by the handler guard). */
export const toolSchemas = {
  balance: {
    address: addressSchema.describe("Address to read balances for (0x, Mezo testnet)"),
    sandbox: sandboxSchema.describe("Must be true: this server only serves the Mezo testnet sandbox (chain 31611)"),
  },
  preview_draw: {
    governor: addressSchema.optional().describe("Governor to preview against; defaults to the live 0.9 governor"),
    app: addressSchema.describe("App (agent) address whose credit line is previewed"),
    amountMusd: z.string().regex(/^\d+(\.\d{1,18})?$/, "decimal MUSD amount, e.g. \"10.5\"").describe("Draw amount in MUSD (decimal string)"),
    payee: addressSchema.describe("Payee address the draw would pay"),
    sandbox: sandboxSchema.describe("Must be true: testnet sandbox only"),
  },
  governor_status: {
    governor: addressSchema.optional().describe("Governor to inspect; defaults to the live 0.9 governor"),
    sandbox: sandboxSchema.describe("Must be true: testnet sandbox only"),
  },
  x402_quote: {
    route: z.enum(["radar", "brief", "muster"]).describe("Priced route to quote an x402 payment for"),
    app: addressSchema.optional().describe("Optional app address: when given, the quote also previews whether this draw can pay it"),
    payee: addressSchema.optional().describe("Optional payee for the preview; defaults to the x402 payee"),
    sandbox: sandboxSchema.describe("Must be true: testnet sandbox only"),
  },
} as const;

export type BalanceArgs = z.infer<z.ZodObject<typeof toolSchemas.balance>>;
export type PreviewDrawArgs = z.infer<z.ZodObject<typeof toolSchemas.preview_draw>>;
export type GovernorStatusArgs = z.infer<z.ZodObject<typeof toolSchemas.governor_status>>;
export type X402QuoteArgs = z.infer<z.ZodObject<typeof toolSchemas.x402_quote>>;

export interface ToolContext {
  client: PublicClient;
  env: McpEnv;
}

export function createContext(env: McpEnv = loadEnv()): ToolContext {
  return { client: createClient(env), env };
}

async function checkedClient(ctx: ToolContext): Promise<PublicClient> {
  await assertTestnet(ctx.client);
  return ctx.client;
}

/**
 * balance — MUSD + native BTC balance of an address on Mezo testnet.
 * Real reads: MUSD.balanceOf, MUSD.decimals, MUSD.symbol, eth_getBalance.
 */
export async function handleBalance(ctx: ToolContext, rawArgs: unknown) {
  rejectCredentialFields(rawArgs);
  const args = z.object(toolSchemas.balance).strict().parse(rawArgs);
  const sandboxRefusal = requireSandbox(args);
  if (sandboxRefusal) return sandboxRefusal;
  const client = await checkedClient(ctx);
  const address = args.address as Address;
  const [musdBalance, decimals, symbol, btcBalance] = await Promise.all([
    client.readContract({ address: ADDRESSES.musd as Address, abi: musdAbi, functionName: "balanceOf", args: [address] }),
    client.readContract({ address: ADDRESSES.musd as Address, abi: musdAbi, functionName: "decimals" }),
    client.readContract({ address: ADDRESSES.musd as Address, abi: musdAbi, functionName: "symbol" }),
    client.getBalance({ address }),
  ]);
  return ok({
    ok: true,
    tool: "balance",
    address,
    chainId: CHAIN_ID,
    network: "Mezo testnet",
    musd: { balanceWei: musdBalance.toString(), balance: formatUnits(musdBalance, decimals), symbol },
    btc: { balanceWei: btcBalance.toString(), balance: formatUnits(btcBalance, 18) },
    explorer: explorerAddress(address),
  });
}

/**
 * preview_draw — Governor.previewDraw(app, amount, payee): the exact
 * allow/refuse verdict for a draw, with the on-chain reason code and a
 * human explanation. Never sends anything.
 */
export async function handlePreviewDraw(ctx: ToolContext, rawArgs: unknown) {
  rejectCredentialFields(rawArgs);
  const args = z.object(toolSchemas.preview_draw).strict().parse(rawArgs);
  const sandboxRefusal = requireSandbox(args);
  if (sandboxRefusal) return sandboxRefusal;
  const client = await checkedClient(ctx);
  const governor = (args.governor ?? ADDRESSES.governor) as Address;
  const amountWei = parseMusd(args.amountMusd);
  const [allowed, reason, icrAfter] = await client.readContract({
    address: governor,
    abi: governorAbi,
    functionName: "previewDraw",
    args: [args.app as Address, amountWei, args.payee as Address],
  });
  const [floorICR, remainingBudget] = await Promise.all([
    client.readContract({ address: governor, abi: governorAbi, functionName: "floorICR" }),
    client.readContract({ address: governor, abi: governorAbi, functionName: "remainingBudget", args: [args.app as Address] }),
  ]);
  return ok({
    ok: true,
    tool: "preview_draw",
    governor,
    app: args.app,
    payee: args.payee,
    amountMusd: args.amountMusd,
    amountWei: amountWei.toString(),
    allowed,
    reason,
    explanation: explain(reason),
    icrAfterWei: icrAfter.toString(),
    icrAfter: formatUnits(icrAfter, 18),
    floorICRWei: floorICR.toString(),
    floorICR: formatUnits(floorICR, 18),
    remainingBudgetWei: remainingBudget.toString(),
    remainingBudgetMusd: formatUnits(remainingBudget, 18),
    explorer: explorerAddress(governor),
  });
}

/**
 * governor_status — floor/defend ICR, frozen flag, buffer, standby
 * (amount/deadline/nonce/live), live ICR, fee, borrower. All live reads.
 */
export async function handleGovernorStatus(ctx: ToolContext, rawArgs: unknown) {
  rejectCredentialFields(rawArgs);
  const args = z.object(toolSchemas.governor_status).strict().parse(rawArgs);
  const sandboxRefusal = requireSandbox(args);
  if (sandboxRefusal) return sandboxRefusal;
  const client = await checkedClient(ctx);
  const governor = (args.governor ?? ADDRESSES.governor) as Address;
  const [borrower, floorICR, defendICR, frozen, buffer, standby, icr, feeBps, feeRecipient, musd] =
    await Promise.all([
      client.readContract({ address: governor, abi: governorAbi, functionName: "borrower" }),
      client.readContract({ address: governor, abi: governorAbi, functionName: "floorICR" }),
      client.readContract({ address: governor, abi: governorAbi, functionName: "defendICR" }),
      client.readContract({ address: governor, abi: governorAbi, functionName: "frozen" }),
      client.readContract({ address: governor, abi: governorAbi, functionName: "buffer" }),
      client.readContract({ address: governor, abi: governorAbi, functionName: "standby" }),
      client.readContract({ address: governor, abi: governorAbi, functionName: "icr" }),
      client.readContract({ address: governor, abi: governorAbi, functionName: "feeBps" }),
      client.readContract({ address: governor, abi: governorAbi, functionName: "feeRecipient" }),
      client.readContract({ address: governor, abi: governorAbi, functionName: "musd" }),
    ]);
  const [standbyAmount, standbyDeadline, standbyNonce, standbyLive] = standby as unknown as [bigint, bigint, bigint, boolean];
  // Integrity check: the factory must recognise this governor for its borrower.
  const recognised = await client
    .readContract({
      address: ADDRESSES.factory as Address,
      abi: factoryAbi,
      functionName: "governorOf",
      args: [borrower],
    })
    .then((g) => g.toLowerCase() === governor.toLowerCase())
    .catch(() => false);
  return ok({
    ok: true,
    tool: "governor_status",
    governor,
    chainId: CHAIN_ID,
    network: "Mezo testnet",
    factoryRecognised: recognised,
    borrower,
    floorICRWei: floorICR.toString(),
    floorICR: formatUnits(floorICR, 18),
    defendICRWei: defendICR.toString(),
    defendICR: formatUnits(defendICR, 18),
    frozen,
    bufferWei: buffer.toString(),
    bufferMusd: formatUnits(buffer, 18),
    standby: {
      amountWei: standbyAmount.toString(),
      amountMusd: formatUnits(standbyAmount, 18),
      deadline: Number(standbyDeadline),
      deadlineISO: new Date(Number(standbyDeadline) * 1000).toISOString(),
      nonce: standbyNonce.toString(),
      live: standbyLive,
    },
    icrWei: icr.toString(),
    icr: formatUnits(icr, 18),
    feeBps,
    feeRecipient,
    musd,
    explorer: explorerAddress(governor),
  });
}

/**
 * x402_quote — the exact x402 v2 402 challenge for a priced route
 * (same shape as backend/src/x402/paywall.ts), plus — when `app` is given —
 * a live previewDraw verdict for paying that price. Quote only: never
 * verifies, settles, or sends.
 */
export async function handleX402Quote(ctx: ToolContext, rawArgs: unknown) {
  rejectCredentialFields(rawArgs);
  const args = z.object(toolSchemas.x402_quote).strict().parse(rawArgs);
  const sandboxRefusal = requireSandbox(args);
  if (sandboxRefusal) return sandboxRefusal;
  const route = args.route as X402Route;
  const meta = X402_ROUTES[route];
  const priceWei = x402Price(ctx.env);
  const challenge = x402Challenge(
    ctx.env,
    `https://sternpost-api.vercel.app${meta.resource}`,
    meta.description,
  );
  let payable: unknown = null;
  if (args.app) {
    const client = await checkedClient(ctx);
    const payee = (args.payee ?? x402PayTo(ctx.env)) as Address;
    const [allowed, reason, icrAfter] = await client.readContract({
      address: ADDRESSES.governor as Address,
      abi: governorAbi,
      functionName: "previewDraw",
      args: [args.app as Address, BigInt(priceWei), payee],
    });
    payable = {
      app: args.app,
      payee,
      allowed,
      reason,
      explanation: explain(reason),
      icrAfter: formatUnits(icrAfter, 18),
    };
  }
  return ok({
    ok: true,
    tool: "x402_quote",
    route,
    amountWei: priceWei,
    amountMusd: formatUnits(BigInt(priceWei), 18),
    asset: ADDRESSES.musd,
    payTo: x402PayTo(ctx.env),
    network: `eip155:${CHAIN_ID}`,
    facilitator: "https://facilitator.vativ.io",
    challenge,
    payable,
    note: "Quote only. This tool never verifies, settles, or sends a payment.",
  });
}

/** SpendWallet read helper (used by the smoke test, not a tool: the 4 tools are the plan's set). */
export async function readSpendWallet(ctx: ToolContext, wallet: Address) {
  const client = await checkedClient(ctx);
  const [agent, agentExpiry, owner, musdBalance] = await Promise.all([
    client.readContract({ address: wallet, abi: spendWalletAbi, functionName: "agent" }),
    client.readContract({ address: wallet, abi: spendWalletAbi, functionName: "agentExpiry" }),
    client.readContract({ address: wallet, abi: spendWalletAbi, functionName: "owner" }),
    client.readContract({ address: ADDRESSES.musd as Address, abi: musdAbi, functionName: "balanceOf", args: [wallet] }),
  ]);
  return { wallet, agent, agentExpiry: Number(agentExpiry), owner, musdBalanceWei: musdBalance.toString() };
}
