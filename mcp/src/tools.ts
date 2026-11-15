import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { Address, PublicClient, WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ADDRESSES,
  CHAIN_ID,
  X402_FACILITATOR_URL,
  addressSchema,
  apiBase,
  chainIdFor,
  loadEnv,
  musdAddress,
  resolveNetwork,
  x402PayTo,
  x402Price,
  type McpEnv,
  type NetworkName,
} from "./config.js";
import {
  assertNetwork,
  createAgentWallet,
  createClient,
  explorerAddress,
  explorerAddressFor,
  explorerTxFor,
  factoryAbi,
  formatUnits,
  governorAbi,
  mezoSystem,
  musdAbi,
  parseMusd,
  priceFeedAbi,
  radarAbi,
  requireMainnetGate,
  safeDeadline,
  sortedTrovesAbi,
  spendWalletAbi,
  troveAccountAbi,
  troveManagerAbi,
} from "./chain.js";
import { REFUSALS, explain, explainTrovePreview } from "./reasons.js";
import { X402_ROUTES, x402Challenge, type X402Route } from "./x402.js";
import { loadAgentAddress, loadAgentKey, loadOrCreateAgentKey, agentKeyPath } from "./agentKey.js";
import { newRequestId, storeSessionRequest } from "./store.js";

/**
 * KEY RULE: this server holds no private key in any tool result, accepts no
 * key as input, and never returns one. Defence in depth, two layers:
 * (1) over real MCP transport the SDK parses args against the zod schemas
 * below, so unknown/credential fields are dropped by the transport and never
 * reach a handler (verified by the stdio transport test in the smoke
 * script); (2) handlers called directly still run rejectCredentialFields
 * below, and every serialized response — success or error — is scanned for
 * the value of STERNPOST_API_KEY (if set) before it leaves the server.
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

/**
 * Throws if the serialized output contains a configured secret value.
 * Scans STERNPOST_API_KEY (if set) AND the local agent private key (if a
 * key file exists) — defence in depth: no handler emits the agent key
 * today, but a future output path must not be able to leak it either.
 * The key is read lazily and cached per path (a missing file is re-checked
 * on every call, so a key created later — e.g. by request_session — is
 * picked up); only the 0x + 64-hex value is ever compared, never logged.
 * The cache is keyed on a sha256 of the file BYTES, so an in-place key
 * replacement is detected even when the file's mtime and size are
 * unchanged (a fixed-format JSON key file keeps the same size on
 * rotation, and mtime alone can be preserved or coarse) — the guard
 * then scans for the NEW key, not the stale one. A server restart is
 * not needed for rotation — replacing the file is enough. (Round 4:
 * the old mtimeMs+size key only invalidated on an mtime change.)
 */
let cachedAgentKey: { path: string; key: string; hash: string } | null = null;
function agentPrivateKeyValue(): string | null {
  let path: string;
  try {
    path = agentKeyPath(loadEnv());
  } catch {
    path = join(homedir(), ".sternpost", "agent.json");
  }
  // One read: the bytes are hashed AND parsed from the same buffer, so
  // there is no stat→read window for a swap to slip through between the
  // check and the read.
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    // File gone (or unreadable): drop any cached key — a deleted key
    // must not keep being scanned for — and re-check on every call so a
    // key created later is picked up.
    cachedAgentKey = null;
    return null;
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (cachedAgentKey && cachedAgentKey.path === path && cachedAgentKey.hash === hash) {
    return cachedAgentKey.key;
  }
  try {
    const parsed = JSON.parse(bytes.toString("utf8")) as { privateKey?: unknown };
    if (typeof parsed.privateKey === "string" && /^0x[0-9a-fA-F]{64}$/.test(parsed.privateKey)) {
      cachedAgentKey = { path, key: parsed.privateKey, hash };
      return parsed.privateKey;
    }
  } catch {
    // Malformed or unreadable — nothing to scan for. Never throw from
    // the guard: a missing key must not break responses.
  }
  cachedAgentKey = null;
  return null;
}

export function guardOutput(text: string): void {
  const apiKey = process.env.STERNPOST_API_KEY;
  if (apiKey && apiKey.length >= 8 && text.includes(apiKey)) {
    throw new Error("refused: response would contain a configured secret value");
  }
  const agentKey = agentPrivateKeyValue();
  if (agentKey && text.includes(agentKey)) {
    throw new Error("refused: response would contain the agent private key");
  }
}

export function ok(result: unknown): {
  content: { type: "text"; text: string }[];
} {
  const text = JSON.stringify(result, null, 2);
  guardOutput(text);
  return { content: [{ type: "text", text }] };
}

/** Error path: the same output scan applies to thrown errors (J3 F2).
 * The message is redacted first (round 4, J3 F3): a thrown viem error
 * can carry the configured RPC URL, and a keyed RPC URL (path-key or
 * ?api_key= style) would otherwise leak to the MCP client — fail() is
 * the one error path redactCredentials was never applied to. */
export function fail(err: unknown): { content: { type: "text"; text: string }[] } {
  const message = redactCredentials(err instanceof Error ? err.message : String(err));
  guardOutput(message);
  return ok({ ok: false, error: message });
}

export function refusal(reason: string, detail?: string) {
  return ok({ ok: false, refused: true, reason, ...(detail ? { detail } : {}) });
}

const amountPattern = /^(\d+)(\.\d{1,18})?$/;

/**
 * Zod raw shapes for McpServer.registerTool. These four — and only these
 * four — are the plan §5.1 tool set (balance, pay, request_session, radar).
 * preview_draw / governor_status / x402_quote live on as internal helpers
 * (used by `pay` and by the tests) but are NOT registered tools.
 */
export const toolSchemas = {
  balance: {
    account: addressSchema.optional().describe("TroveAccount address; defaults to STERNPOST_ACCOUNT"),
  },
  pay: {
    url: z.string().url().describe("x402-protected HTTP resource to pay for"),
    method: z.enum(["GET", "POST"]).default("GET"),
    body: z.string().optional().describe("POST body"),
    maxAmount: z
      .string()
      .regex(amountPattern, "decimal MUSD amount, e.g. \"0.01\"")
      .optional()
      .describe("MUSD ceiling; the call fails with OVER_MAX if the 402 asks for more"),
    dryRun: z.boolean().default(false).describe("Parse the 402 and run previewDraw only; no tx, no payment"),
  },
  request_session: {
    account: addressSchema.describe("TroveAccount address to request a session on"),
    purpose: z.string().max(200).describe("What the agent will spend on (max 200 chars)"),
    budget: z.string().regex(amountPattern, "decimal MUSD amount").describe("MUSD requested"),
    perTx: z.string().regex(amountPattern, "decimal MUSD amount").optional(),
    days: z.number().int().min(1).max(90).default(7),
    payees: z.array(addressSchema).max(10).optional(),
    sandbox: z
      .boolean()
      .default(false)
      .describe("Request a small, labelled sandbox session on the Sternpost team account (Lane B). Auto-approved up to 5 MUSD/day per agent."),
  },
  radar: {
    account: addressSchema.optional().describe("Trove address to rank (defaults to the session account)"),
    network: z.enum(["testnet", "mainnet"]).optional().describe("Defaults to STERNPOST_NETWORK"),
  },
  // Internal helpers (NOT registered tools): Classic 0.9 governor reads.
  preview_draw: {
    governor: addressSchema.optional().describe("Governor to preview against; defaults to the live 0.9 governor"),
    app: addressSchema.describe("App (agent) address whose credit line is previewed"),
    amountMusd: z.string().regex(amountPattern, "decimal MUSD amount, e.g. \"10.5\"").describe("Draw amount in MUSD (decimal string)"),
    payee: addressSchema.describe("Payee address the draw would pay"),
  },
  governor_status: {
    governor: addressSchema.optional().describe("Governor to inspect; defaults to the live 0.9 governor"),
  },
  x402_quote: {
    route: z.enum(["radar", "brief", "muster"]).describe("Priced route to quote an x402 payment for"),
    app: addressSchema.optional().describe("Optional app address: when given, the quote also previews whether this draw can pay it"),
    payee: addressSchema.optional().describe("Optional payee for the preview; defaults to the x402 payee"),
  },
} as const;

export type BalanceArgs = z.infer<z.ZodObject<typeof toolSchemas.balance>>;
export type PayArgs = z.infer<z.ZodObject<typeof toolSchemas.pay>>;
export type RequestSessionArgs = z.infer<z.ZodObject<typeof toolSchemas.request_session>>;
export type RadarArgs = z.infer<z.ZodObject<typeof toolSchemas.radar>>;
export type PreviewDrawArgs = z.infer<z.ZodObject<typeof toolSchemas.preview_draw>>;
export type GovernorStatusArgs = z.infer<z.ZodObject<typeof toolSchemas.governor_status>>;
export type X402QuoteArgs = z.infer<z.ZodObject<typeof toolSchemas.x402_quote>>;

export interface ToolContext {
  client: PublicClient;
  env: McpEnv;
  network: NetworkName;
  /** Test seam: an injected signing client for `pay`'s refill draw. Production always builds one from the agent key via createAgentWallet. */
  agentWallet?: WalletClient;
}

export function createContext(env: McpEnv = loadEnv(), network?: NetworkName): ToolContext {
  const resolved = network ?? resolveNetwork(env);
  return { client: createClient(env, resolved), env, network: resolved };
}

/** Chain-gate every read: the RPC must report the configured chain. */
async function checkedClient(ctx: ToolContext, network: NetworkName = ctx.network): Promise<PublicClient> {
  const client = network === ctx.network ? ctx.client : createClient(ctx.env, network);
  await assertNetwork(client, chainIdFor(network));
  return client;
}

function resolveAccount(ctx: ToolContext, arg?: string): Address | null {
  return ((arg ?? ctx.env.STERNPOST_ACCOUNT) as Address | undefined) ?? null;
}

function truncate(text: string, max = 8192): string {
  return text.length > max ? text.slice(0, max) + `…[truncated ${text.length - max} chars]` : text;
}

/**
 * Strip credential-looking substrings from a message before it is logged
 * (or echoed in a rankNote): userinfo in a URL (`https://user:pass@host`,
 * or a bare token as the userinfo), and api-key/token/secret/password
 * query params — including bare `?key=`, `?access_token=` and `?auth=`
 * params (round 4, J3 F3: a keyed RPC URL carries the key exactly that
 * way). Path-key RPC URLs (round 5, J3 F3b): providers such as Alchemy
 * (`/v2/<32-hex>`) and Infura (`/v3/<32-hex>`) carry the key as a path
 * segment, which neither rule above matches — so a segment of 20+
 * key-like characters after /v2/ or /v3/ is redacted too, but only when
 * it mixes letters and digits, so ordinary RPC paths (e.g.
 * /v2/getBlockByNumber, all letters, or a numeric id, all digits)
 * survive untouched. Round 6 (J3 F1): the /v[23]/ anchor was too
 * narrow — real provider forms put the key elsewhere, so ANY
 * `/`-delimited segment of 20+ mixed letter+digit characters is now
 * redacted, whatever precedes it: a bare first segment (QuickNode
 * `https://<subdomain>.quiknode.pro/<32-hex>/`, Blast
 * `https://eth-mainnet.blastapi.io/<project-id>`, GetBlock
 * `https://eth.getblock.io/<key>/mainnet/`), a provider prefix
 * (Ankr `/eth/<key>`, `/api/`, `/rpc/`, `/v1/`, `/v4/`), or the old
 * `/v2/`/`/v3/` forms. The mixed letter+digit guard is kept, so
 * all-letters method names (e.g. getTransactionReceipt, 20 chars)
 * and all-digits numeric segments (e.g. a 20-digit id) still survive
 * untouched; the all-letters/all-digits key edge and sub-20-char
 * keys are documented trade-offs and are NOT covered (widening
 * would false-positive on ordinary paths). Accepted nit: a non-secret
 * 20+ mixed segment (e.g. a bare 40-hex address) is redacted too.
 * The query rule also covers `dkey` (dRPC `?dkey=<key>`), which the
 * old `key|api_key|…` alternation did not match. The rest of the
 * message is kept intact so the log stays useful for debugging; only
 * the credential-shaped part is replaced.
 */
function redactCredentials(text: string): string {
  return text
    .replace(/(https?:\/\/)[^\s/@]+@/g, "$1[redacted-credentials]@")
    .replace(/([?&](?:dkey|api[_-]?key|key|token|secret|password|access_token|auth)=)[^\s&]*/gi, "$1[redacted]")
    // (?<!\/) keeps the `://` of the scheme out of the match: the
    // second slash of `://` must not redact a long mixed subdomain.
    .replace(/(?<!\/)\/(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}/g, "/[redacted]");
}

const TROVE_STATUS = ["none", "active", "closedByOwner", "closedByLiquidation", "closedByRedemption"] as const;

/* ------------------------------------------------------------------ */
/* 1. balance — plan §5.1: session + health + account MUSD              */
/* ------------------------------------------------------------------ */

/**
 * balance — the agent's session on its Sternpost trove account: remaining
 * budget, per-tx cap, daily limit, expiry, account health (ICR, floor,
 * Recovery Mode) and MUSD held by the account. Read-only.
 */
export async function handleBalance(ctx: ToolContext, rawArgs: unknown) {
  rejectCredentialFields(rawArgs);
  const args = z.object(toolSchemas.balance).strict().parse(rawArgs);
  if (ctx.network === "mainnet") await requireMainnetGate(ctx.env, args.account ?? ctx.env.STERNPOST_ACCOUNT);
  const account = resolveAccount(ctx, args.account);
  if (!account) return refusal("ACCOUNT_NOT_SET", REFUSALS.ACCOUNT_NOT_SET);
  const client = await checkedClient(ctx);
  const code = await client.getBytecode({ address: account });
  if (!code) return refusal("ACCOUNT_NOT_DEPLOYED", REFUSALS.ACCOUNT_NOT_DEPLOYED);
  const agent = await loadAgentAddress(ctx.env);
  const sys = mezoSystem(ctx.network);
  let session: {
    active: boolean;
    budget: string;
    spent: string;
    remaining: string;
    perTx: string;
    dailyRemaining: string | null;
    expiry: string | null;
    canSignX402: boolean;
  };
  let policy: { floorICR: bigint };
  let status: number;
  let accountMusd: bigint;
  try {
    const [policyRaw, statusRaw, musdRaw] = await Promise.all([
      client.readContract({ address: account, abi: troveAccountAbi, functionName: "policy" }),
      client.readContract({ address: account, abi: troveAccountAbi, functionName: "status" }),
      client.readContract({ address: sys.musd as Address, abi: musdAbi, functionName: "balanceOf", args: [account] }),
    ]);
    policy = { floorICR: (policyRaw as [bigint, bigint, bigint, bigint, bigint, number])[0] };
    status = statusRaw as number;
    accountMusd = musdRaw as bigint;
    if (agent) {
      const [s, epoch] = await Promise.all([
        client.readContract({ address: account, abi: troveAccountAbi, functionName: "sessions", args: [agent] }),
        client.readContract({ address: account, abi: troveAccountAbi, functionName: "sessionEpoch" }),
      ]);
      const [budget, spent, perTx, dailyLimit, daySpent, expiry, dayStart, sessEpoch, , , canSignX402, active] =
        s as unknown as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, number, number, boolean, boolean, boolean];
      const now = BigInt(Math.floor(Date.now() / 1000));
      const daySpentNow = now >= dayStart + 86400n ? 0n : daySpent;
      const dailyRemaining =
        dailyLimit === 0n ? null : formatUnits(dailyLimit > daySpentNow ? dailyLimit - daySpentNow : 0n, 18);
      session = {
        active: active && sessEpoch === epoch && expiry > now,
        budget: formatUnits(budget, 18),
        spent: formatUnits(spent, 18),
        remaining: formatUnits(budget > spent ? budget - spent : 0n, 18),
        perTx: formatUnits(perTx, 18),
        dailyRemaining,
        expiry: expiry === 0n ? null : new Date(Number(expiry) * 1000).toISOString(),
        canSignX402,
      };
    } else {
      session = {
        active: false,
        budget: "0",
        spent: "0",
        remaining: "0",
        perTx: "0",
        dailyRemaining: null,
        expiry: null,
        canSignX402: false,
      };
    }
  } catch {
    return refusal("ACCOUNT_NOT_DEPLOYED", REFUSALS.ACCOUNT_NOT_DEPLOYED);
  }
  // Health: live price + ICR + Recovery Mode (needs the Mezo system contracts).
  let icr: number | null;
  let recoveryMode = false;
  try {
    const price = await client.readContract({
      address: sys.priceFeed as Address,
      abi: priceFeedAbi,
      functionName: "fetchPrice",
    });
    const [icrRaw, rm] = await Promise.all([
      client.readContract({
        address: sys.troveManager as Address,
        abi: troveManagerAbi,
        functionName: "getCurrentICR",
        args: [account, price],
      }),
      client.readContract({
        address: sys.troveManager as Address,
        abi: troveManagerAbi,
        functionName: "checkRecoveryMode",
        args: [price],
      }),
    ]);
    const icrWei = icrRaw as bigint;
    // No trove yet (or a closed one): ICR is not meaningful.
    icr = status === 1 ? Number.parseFloat(formatUnits(icrWei, 18)) : null;
    recoveryMode = rm as boolean;
  } catch {
    icr = null;
  }
  return ok({
    ok: true,
    tool: "balance",
    network: ctx.network,
    account,
    agent,
    session,
    health: {
      icr,
      floor: Number.parseFloat(formatUnits(policy.floorICR, 18)),
      recoveryMode,
      troveStatus: TROVE_STATUS[status] ?? `unknown_${status}`,
    },
    accountMusd: formatUnits(accountMusd, 18),
    explorer: explorerAddressFor(ctx.network, account),
  });
}

/* ------------------------------------------------------------------ */
/* 2. pay — plan §5.1: pay-by-borrow x402 (spends real budget)          */
/* ------------------------------------------------------------------ */

interface X402Accept {
  scheme?: string;
  network?: string;
  amount?: string;
  asset?: string;
  payTo?: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

function parse402(status: number, headers: Headers, bodyText: string): { doc: Record<string, unknown>; accepts: X402Accept[] } | null {
  if (status !== 402) return null;
  const header = headers.get("payment-required");
  if (header) {
    try {
      const doc = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as Record<string, unknown>;
      const accepts = (doc.accepts as X402Accept[] | undefined) ?? [];
      return { doc, accepts };
    } catch {
      return null;
    }
  }
  try {
    const doc = JSON.parse(bodyText) as Record<string, unknown>;
    const accepts = (doc.accepts as X402Accept[] | undefined) ?? [];
    return { doc, accepts };
  } catch {
    return null;
  }
}

/**
 * pay — pay an x402-protected HTTP resource in MUSD by borrowing exactly
 * that amount just in time against the owner's Bitcoin collateral, then
 * fetch the resource. SPENDS SESSION BUDGET (and the agent key pays gas
 * for the refill draw). `pay` always calls previewDraw first and refuses
 * with a reason code instead of sending a doomed tx.
 */
export async function handlePay(ctx: ToolContext, rawArgs: unknown) {
  rejectCredentialFields(rawArgs);
  const args = z.object(toolSchemas.pay).strict().parse(rawArgs);
  if (ctx.network === "mainnet") await requireMainnetGate(ctx.env, ctx.env.STERNPOST_ACCOUNT);
  const account = resolveAccount(ctx);
  if (!account) return refusal("ACCOUNT_NOT_SET", REFUSALS.ACCOUNT_NOT_SET);
  const agentKey = await loadAgentKey(ctx.env);
  if (!agentKey) return refusal("SESSION_INACTIVE", REFUSALS.NO_AGENT_KEY);
  const client = await checkedClient(ctx);
  const chainId = chainIdFor(ctx.network);
  const network = `eip155:${chainId}`;
  const musd = musdAddress(ctx.network);

  // (1) GET url → 402.
  const first = await fetch(args.url, {
    method: args.method,
    body: args.method === "POST" ? (args.body ?? "") : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const firstBody = await first.text();
  const parsed402 = parse402(first.status, first.headers, firstBody);
  if (!parsed402) {
    return ok({
      ok: true,
      tool: "pay",
      status: "refused",
      amount: null,
      payTo: null,
      network,
      refillTx: null,
      settleTx: null,
      responseStatus: first.status,
      responseBody: truncate(firstBody),
      reason: "NO_402",
      detail: "the resource did not answer 402 with an x402 challenge",
    });
  }
  const accepts = parsed402.accepts;
  const wanted = accepts.find((a) => a.network === network);
  if (!wanted) {
    return ok({
      ok: true,
      tool: "pay",
      status: "refused",
      amount: accepts[0]?.amount ? formatUnits(BigInt(accepts[0].amount), 18) : null,
      payTo: accepts[0]?.payTo ?? null,
      network,
      refillTx: null,
      settleTx: null,
      responseStatus: first.status,
      responseBody: truncate(firstBody),
      reason: "NETWORK_MISMATCH",
      detail: `no accepts entry for ${network}`,
    });
  }
  if (wanted.scheme !== "exact") {
    return ok({
      ok: true,
      tool: "pay",
      status: "refused",
      amount: wanted.amount ? formatUnits(BigInt(wanted.amount), 18) : null,
      payTo: wanted.payTo ?? null,
      network,
      refillTx: null,
      settleTx: null,
      responseStatus: first.status,
      responseBody: truncate(firstBody),
      reason: "SCHEME_MISMATCH",
      detail: `unsupported scheme ${String(wanted.scheme)} (only "exact" is supported)`,
    });
  }
  if (!wanted.asset || wanted.asset.toLowerCase() !== musd.toLowerCase()) {
    return ok({
      ok: true,
      tool: "pay",
      status: "refused",
      amount: wanted.amount ? formatUnits(BigInt(wanted.amount), 18) : null,
      payTo: wanted.payTo ?? null,
      network,
      refillTx: null,
      settleTx: null,
      responseStatus: first.status,
      responseBody: truncate(firstBody),
      reason: "ASSET_MISMATCH",
      detail: `asset ${String(wanted.asset)} is not MUSD ${musd}`,
    });
  }
  const amountWei = BigInt(wanted.amount ?? "0");
  const amount = formatUnits(amountWei, 18);
  const payTo = wanted.payTo as Address;
  if (args.maxAmount !== undefined && amountWei > parseMusd(args.maxAmount)) {
    return ok({
      ok: true,
      tool: "pay",
      status: "refused",
      amount,
      payTo,
      network,
      refillTx: null,
      settleTx: null,
      responseStatus: first.status,
      responseBody: truncate(firstBody),
      reason: "OVER_MAX",
      detail: `402 asks ${amount} MUSD, above maxAmount ${args.maxAmount}`,
    });
  }

  // (2) previewDraw first — never send a doomed tx.
  const [previewOk, reasonCode, icrAfter, fee] = (await client.readContract({
    address: account,
    abi: troveAccountAbi,
    functionName: "previewDraw",
    args: [agentKey.address, payTo, amountWei],
  })) as unknown as [boolean, number, bigint, bigint];
  const preview = {
    allowed: previewOk,
    ...explainTrovePreview(reasonCode),
    icrAfter: formatUnits(icrAfter, 18),
    fee: formatUnits(fee, 18),
  };
  if (!previewOk) {
    return ok({
      ok: true,
      tool: "pay",
      status: "refused",
      amount,
      payTo,
      network,
      refillTx: null,
      settleTx: null,
      responseStatus: first.status,
      responseBody: truncate(firstBody),
      reason: preview.reason,
      preview,
    });
  }
  if (args.dryRun) {
    return ok({
      ok: true,
      tool: "pay",
      status: "dry_run",
      amount,
      payTo,
      network,
      refillTx: null,
      settleTx: null,
      responseStatus: first.status,
      responseBody: truncate(firstBody),
      reason: null,
      preview,
    });
  }

  // (3) Refill: if the account's MUSD balance is below the amount, draw
  // the FULL amount with draw(payee = the account itself, amount) — plan
  // §5.2: draw(account, max(amount, refillTarget)); testnet refillTarget
  // is 0, so the draw is exactly `amount`, never just the shortfall (a
  // partial balance does not reduce the draw). The draw is signed by the
  // agent key, which pays gas.
  let refillTx: string | null = null;
  const balance = (await client.readContract({
    address: musd as Address,
    abi: musdAbi,
    functionName: "balanceOf",
    args: [account],
  })) as bigint;
  if (balance < amountWei) {
    // Refill-leg preview: the draw pays the account itself, so preview
    // (agent, account, amount) — the (agent, payTo, amount) preview above
    // never checks this leg. A PayeeNotAllowed(account) here is a clean
    // refusal (the account was never allowlisted as its own payee),
    // not a raw revert from the draw.
    const [refillOk, refillReasonCode, refillIcrAfter, refillFee] = (await client.readContract({
      address: account,
      abi: troveAccountAbi,
      functionName: "previewDraw",
      args: [agentKey.address, account, amountWei],
    })) as unknown as [boolean, number, bigint, bigint];
    if (!refillOk) {
      const refillPreview = {
        allowed: false,
        ...explainTrovePreview(refillReasonCode),
        icrAfter: formatUnits(refillIcrAfter, 18),
        fee: formatUnits(refillFee, 18),
      };
      return ok({
        ok: true,
        tool: "pay",
        status: "refused",
        amount,
        payTo,
        network,
        refillTx: null,
        settleTx: null,
        responseStatus: first.status,
        responseBody: truncate(firstBody),
        reason: refillPreview.reason,
        detail: `refill leg refused: draw(agent → account) preview failed (${refillPreview.reason}) — ${refillPreview.explanation}`,
        preview,
        refillPreview,
      });
    }
    // Send the draw, then CHECK the receipt: waitForTransactionReceipt
    // does not throw on a reverted tx, so a draw that reverts at execution
    // (price move, Recovery Mode flip, concurrent budget use) must not be
    // reported as a successful refill. The hash is hoisted outside the
    // try: if the receipt WAIT throws after the draw was sent, the
    // REFILL_FAILED response still carries the sent hash — the draw may
    // confirm on-chain later, so "nothing was paid" is not guaranteed
    // in that case and the hash is needed to check. If the SEND itself
    // throws (RPC timeout between broadcast and hash return), no hash
    // exists: the response says so plainly — send-outcome-unknown, the
    // draw may still confirm — and never claims it "failed before it
    // could settle" (round 4, J3 F2).
    let refillHash: string | null = null;
    try {
      const wallet = ctx.agentWallet ?? createAgentWallet(ctx.env, agentKey.privateKey, ctx.network);
      const hash = await wallet.writeContract({
        address: account,
        abi: troveAccountAbi,
        functionName: "draw",
        args: [account, amountWei],
        chain: wallet.chain,
        account: privateKeyToAccount(agentKey.privateKey),
      });
      refillHash = hash;
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status === "reverted") {
        return ok({
          ok: true,
          tool: "pay",
          status: "refused",
          amount,
          payTo,
          network,
          refillTx: hash,
          settleTx: null,
          responseStatus: first.status,
          responseBody: truncate(firstBody),
          reason: "REFILL_FAILED",
          detail: `refill draw tx ${hash} reverted on-chain (status 0) — price move, Recovery Mode flip, or concurrent budget use; nothing was paid`,
          preview,
        });
      }
      refillTx = hash;
    } catch (err) {
      return ok({
        ok: true,
        tool: "pay",
        status: "refused",
        amount,
        payTo,
        network,
        refillTx: refillHash,
        settleTx: null,
        responseStatus: first.status,
        responseBody: truncate(firstBody),
        reason: "REFILL_FAILED",
        detail:
          refillHash !== null
            ? `refill draw tx ${refillHash} was sent but its receipt could not be confirmed: ${truncate(redactCredentials(err instanceof Error ? err.message : String(err)), 500)} — the draw may still confirm on-chain; check the hash before retrying`
            : `refill draw could not be confirmed as sent (no hash returned) — the draw may still confirm on-chain; check the account nonce/balance before retrying: ${truncate(redactCredentials(err instanceof Error ? err.message : String(err)), 500)}`,
        preview,
      });
    }
  }

  // (4) Sign the x402 v2 ExactEvmScheme payment (Permit2, payer = account,
  // signed by the agent key via the account's EIP-1271 signature).
  const requirements = {
    scheme: "exact",
    network,
    asset: musd as Address,
    amount: amountWei.toString(),
    payTo,
    maxTimeoutSeconds: wanted.maxTimeoutSeconds ?? 300,
    extra: { name: "Mezo USD", version: "1", assetTransferMethod: "permit2" },
  };
  // (4)-(6) run inside a catch wrapper (round 5, J3 observation): if
  // signing, the facilitator verify, or the retry throws AFTER a
  // confirmed refill, the response still carries refillTx — otherwise
  // the throw would reach fail() and the sent draw's hash would be
  // undiscoverable from the response. A retry after this skips the
  // refill block (the balance now covers the amount), so surfacing the
  // hash cannot double-draw.
  let settleTx: string | null = null;
  try {
    const agentAccount = privateKeyToAccount(agentKey.privateKey);
    const signer = {
      address: account,
      signTypedData: (a: Parameters<typeof agentAccount.signTypedData>[0]) => agentAccount.signTypedData(a),
      readContract: (a: never) => client.readContract(a),
    };
    const paymentPayload = await new ExactEvmScheme(signer as never).createPaymentPayload(2, requirements as never);
    const payload = { accepted: requirements, resource: { url: args.url, description: "Sternpost x402", mimeType: "application/json" }, ...paymentPayload, x402Version: 2 };

    // (4b) Verify through the facilitator before retrying (diagnostic: a bad
    // signature is refused here instead of burning the retry).
    const verifyRes = await fetch(`${X402_FACILITATOR_URL}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements }),
      signal: AbortSignal.timeout(30_000),
    });
    const verifyJson = (await verifyRes.json().catch(() => ({}))) as { valid?: boolean; invalidReason?: string };
    if (verifyJson.valid !== true) {
      return ok({
        ok: true,
        tool: "pay",
        status: "refused",
        amount,
        payTo,
        network,
        refillTx,
        settleTx: null,
        responseStatus: first.status,
        responseBody: truncate(firstBody),
        reason: "VERIFY_FAILED",
        detail: `facilitator verify rejected the payment: ${truncate(JSON.stringify(verifyJson), 500)}`,
        preview,
      });
    }

    // (5) Retry with PAYMENT-SIGNATURE; (6) read payment-response for the settle hash.
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
    const retry = await fetch(args.url, {
      method: args.method,
      body: args.method === "POST" ? (args.body ?? "") : undefined,
      headers: { "PAYMENT-SIGNATURE": encoded, "X-PAYMENT": encoded },
      signal: AbortSignal.timeout(30_000),
    });
    const retryBody = await retry.text();
    const paymentResponse = retry.headers.get("payment-response");
    if (paymentResponse) {
      try {
        const pr = JSON.parse(Buffer.from(paymentResponse, "base64").toString("utf8")) as Record<string, unknown>;
        settleTx = (pr.transaction as string | undefined) ?? (pr.txHash as string | undefined) ?? (pr.settleTx as string | undefined) ?? null;
      } catch {
        settleTx = null;
      }
    }
    if (retry.status === 402) {
      return ok({
        ok: true,
        tool: "pay",
        status: "refused",
        amount,
        payTo,
        network,
        refillTx,
        settleTx,
        responseStatus: retry.status,
        responseBody: truncate(retryBody),
        reason: "SETTLE_FAILED",
        detail: "the resource still answers 402 after payment (settlement did not go through on its side)",
        preview,
      });
    }
    return ok({
      ok: true,
      tool: "pay",
      status: "paid",
      amount,
      payTo,
      network,
      refillTx,
      settleTx,
      responseStatus: retry.status,
      responseBody: truncate(retryBody),
      reason: null,
      preview,
      ...(settleTx ? { explorer: explorerTxFor(ctx.network, settleTx) } : {}),
    });
  } catch (err) {
    return ok({
      ok: true,
      tool: "pay",
      status: "refused",
      amount,
      payTo,
      network,
      refillTx,
      settleTx,
      responseStatus: first.status,
      responseBody: truncate(firstBody),
      reason: "PAYMENT_FAILED",
      detail:
        refillTx !== null
          ? `payment step failed after a confirmed refill (refill tx ${refillTx}): ${truncate(redactCredentials(err instanceof Error ? err.message : String(err)), 500)} — the refill draw may already be on-chain; check the hash before retrying`
          : `payment step failed before any refill was sent: ${truncate(redactCredentials(err instanceof Error ? err.message : String(err)), 500)}`,
      preview,
    });
  }
}

/* ------------------------------------------------------------------ */
/* 3. request_session — plan §5.1: ask the owner for budget             */
/* ------------------------------------------------------------------ */

/**
 * request_session — ask the account owner for a spending session.
 * Generates a local agent key if needed (STERNPOST_AGENT_KEY_FILE, chmod
 * 600; the key is never returned — only the agent address is) and sends
 * the owner an approval request. Returns a request id and the approval
 * link; poll with `balance`.
 *
 * Backend note: sandbox auto-approval (Lane B, plan §9.3) runs through the
 * backend, which has no /v1/sessions/request endpoint yet (the API answers
 * 404 for it today). Until it exists, EVERY request — sandbox or not — is
 * recorded locally and returned `pending` for the owner to approve in Crew;
 * the tool never claims `sandbox_granted` it did not receive.
 */
export async function handleRequestSession(ctx: ToolContext, rawArgs: unknown) {
  rejectCredentialFields(rawArgs);
  const args = z.object(toolSchemas.request_session).strict().parse(rawArgs);
  if (ctx.network === "mainnet") await requireMainnetGate(ctx.env, args.account);
  const { key: agentKey, created: keyCreated } = await loadOrCreateAgentKey(ctx.env);
  const requestId = newRequestId();
  const approveUrl = `https://sternpost-pink.vercel.app/app/crew?request=${requestId}`;
  let status: "pending" | "approved" | "denied" | "sandbox_granted" = "pending";
  let telegram: "sent" | "not_linked" = "not_linked";
  let backend: "accepted" | "unavailable" = "unavailable";
  try {
    const res = await fetch(`${apiBase(ctx.env)}/v1/sessions/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId,
        account: args.account,
        agent: agentKey.address,
        purpose: args.purpose,
        budget: args.budget,
        perTx: args.perTx ?? null,
        days: args.days,
        payees: args.payees ?? [],
        sandbox: args.sandbox,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as { status?: string; telegram?: string };
      backend = "accepted";
      if (json.status === "sandbox_granted" || json.status === "approved" || json.status === "denied") {
        status = json.status;
      }
      if (json.telegram === "sent") telegram = "sent";
    }
  } catch {
    backend = "unavailable";
  }
  const record = {
    requestId,
    account: args.account,
    agent: agentKey.address,
    purpose: args.purpose,
    budget: args.budget,
    perTx: args.perTx ?? null,
    days: args.days,
    payees: args.payees ?? [],
    sandbox: args.sandbox,
    status,
    approveUrl,
    telegram,
    createdAt: new Date().toISOString(),
  };
  await storeSessionRequest(ctx.env, record);
  return ok({
    ok: true,
    tool: "request_session",
    requestId,
    agent: agentKey.address,
    status,
    approveUrl,
    telegram,
    account: args.account,
    purpose: args.purpose,
    budget: args.budget,
    perTx: args.perTx ?? null,
    days: args.days,
    payees: args.payees ?? [],
    sandbox: args.sandbox,
    keyFileCreated: keyCreated,
    backend,
    ...(args.sandbox
      ? { note: "Sandbox sessions are capped at 5 MUSD/day per agent at approval; auto-approval needs the Lane B backend, which is not live yet — this request is pending owner approval." }
      : {}),
  });
}

/* ------------------------------------------------------------------ */
/* 4. radar — plan §5.1: Redemption Radar                               */
/* ------------------------------------------------------------------ */

const MCR = 1_100_000_000_000_000_000n; // 1.1e18
const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Word a deployed-Radar rank() failure by its kind: a timeout is not a
 * wrong address is not a revert. The old bare `catch {}` labelled every
 * failure a timeout. The fallback below is the same in every case (direct
 * walk, rankSource "walk"); only the note — and the logged error — change.
 */
function classifyRankError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  if (/timeout|timed out|ETIMEDOUT/i.test(msg) || /Timeout/i.test(name)) return "timed out";
  if (/revert/i.test(msg)) return "reverted on-chain";
  if (/returned no data|no data was returned|abi|could not decode|decode/i.test(msg)) {
    return "returned data the Radar ABI could not decode (wrong address or ABI mismatch)";
  }
  return `failed (${truncate(redactCredentials(msg), 120)})`;
}

/**
 * radar — Redemption Radar for a trove account or any trove address: rank
 * from the redemption frontier, MUSD of debt ahead, ICR, system TCR vs the
 * 150% Recovery Mode line. Network is labelled; testnet ranks are
 * synthetic (the plan's label: testnet troves are play money).
 * Read-only. Reads Mezo SortedTroves + TroveManager + PriceFeed directly,
 * or the deployed Radar contract when STERNPOST_RADAR is set.
 */
export async function handleRadar(ctx: ToolContext, rawArgs: unknown) {
  rejectCredentialFields(rawArgs);
  const args = z.object(toolSchemas.radar).strict().parse(rawArgs);
  const network = args.network ?? ctx.network;
  if (network === "mainnet") await requireMainnetGate(ctx.env, args.account);
  const client = await checkedClient(ctx, network);
  const sys = mezoSystem(network);
  const account = (args.account ?? ctx.env.STERNPOST_ACCOUNT ?? null) as Address | null;
  const maxSteps = 300;

  // One live price read, shared by every ICR/TCR call below.
  const price = (await client.readContract({
    address: sys.priceFeed as Address,
    abi: priceFeedAbi,
    functionName: "fetchPrice",
  })) as bigint;

  let tcr: bigint;
  let recoveryMode: boolean;
  let troveCount: bigint;
  let frontierTrove: Address;
  let frontierIcr: bigint;
  let frontierDebt: bigint;
  if (ctx.env.STERNPOST_RADAR) {
    const radar = ctx.env.STERNPOST_RADAR as Address;
    const [, tcrRaw, rm, n] = (await client.readContract({
      address: radar,
      abi: radarAbi,
      functionName: "systemHealth",
    })) as unknown as [bigint, bigint, boolean, bigint];
    tcr = tcrRaw;
    recoveryMode = rm;
    troveCount = n;
    const [fTro, fIcr, fDebt] = (await client.readContract({
      address: radar,
      abi: radarAbi,
      functionName: "frontier",
    })) as unknown as [Address, bigint, bigint];
    frontierTrove = fTro;
    frontierIcr = fIcr;
    frontierDebt = fDebt;
  } else {
    const [tcrRaw, rm, n] = await Promise.all([
      client.readContract({ address: sys.troveManager as Address, abi: troveManagerAbi, functionName: "getTCR", args: [price] }),
      client.readContract({ address: sys.troveManager as Address, abi: troveManagerAbi, functionName: "checkRecoveryMode", args: [price] }),
      client.readContract({ address: sys.sortedTroves as Address, abi: sortedTrovesAbi, functionName: "getSize" }),
    ]);
    tcr = tcrRaw as bigint;
    recoveryMode = rm as boolean;
    troveCount = n as bigint;
    frontierTrove = (await client.readContract({
      address: sys.sortedTroves as Address,
      abi: sortedTrovesAbi,
      functionName: "getLast",
    })) as Address;
    if (frontierTrove === ZERO) {
      frontierIcr = 0n;
      frontierDebt = 0n;
    } else {
      const [fIcr, fDebt] = await Promise.all([
        client.readContract({ address: sys.troveManager as Address, abi: troveManagerAbi, functionName: "getCurrentICR", args: [frontierTrove, price] }),
        client.readContract({ address: sys.troveManager as Address, abi: troveManagerAbi, functionName: "getEntireDebtAndColl", args: [frontierTrove] }),
      ]);
      frontierIcr = fIcr as bigint;
      const [, principal, interest] = fDebt as unknown as [bigint, bigint, bigint, bigint, bigint, bigint];
      frontierDebt = principal + interest;
    }
  }

  let rank = 0;
  let debtAhead = 0n;
  let icr: number | null = null;
  let complete = true;
  let steps = 0;
  let rankSource: "radar" | "walk" | null = null;
  let rankNote: string | null = null;
  if (account && account !== ZERO) {
    // Direct walk: frontier → getPrev, redeemable troves only (ICR >= MCR).
    // Ground truth for the rank; also the fallback when the deployed
    // Radar's single heavy rank() call times out (see below).
    const walkRank = async (): Promise<{ rank: number; debtAhead: bigint; icr: number | null; complete: boolean; steps: number }> => {
      const chain: Address[] = [];
      let cursor = frontierTrove;
      while (cursor !== ZERO && chain.length < maxSteps) {
        chain.push(cursor);
        cursor = (await client.readContract({
          address: sys.sortedTroves as Address,
          abi: sortedTrovesAbi,
          functionName: "getPrev",
          args: [cursor],
        })) as Address;
      }
      let wComplete = cursor === ZERO;
      const wSteps = chain.length;
      const reads: { trove: Address; icr: bigint; debt: bigint }[] = [];
      // Small batches + a pause between them: the public testnet RPC
      // rate-limits bursts (a 50-wide batch throttled it mid-walk on
      // 2026-11-15 and poisoned the following tests with eth_chainId
      // timeouts). 10-wide batches stay under the limit.
      for (let i = 0; i < chain.length; i += 10) {
        const chunk = chain.slice(i, i + 10);
        const chunkReads = await Promise.all(
          chunk.map(async (trove) => {
            const [icrRaw, entire] = await Promise.all([
              client.readContract({ address: sys.troveManager as Address, abi: troveManagerAbi, functionName: "getCurrentICR", args: [trove, price] }),
              client.readContract({ address: sys.troveManager as Address, abi: troveManagerAbi, functionName: "getEntireDebtAndColl", args: [trove] }),
            ]);
            const [, principal, interest] = entire as unknown as [bigint, bigint, bigint, bigint, bigint, bigint];
            return { trove, icr: icrRaw as bigint, debt: principal + interest };
          }),
        );
        reads.push(...chunkReads);
        if (i + 10 < chain.length) await new Promise((r) => setTimeout(r, 100));
      }
      let wRank = 0;
      let wDebtAhead = 0n;
      let wIcr: number | null = null;
      let redeemableSeen = 0;
      for (const r of reads) {
        const redeemable = r.icr >= MCR;
        if (r.trove.toLowerCase() === account.toLowerCase()) {
          wIcr = Number.parseFloat(formatUnits(r.icr, 18));
          wRank = redeemable ? redeemableSeen + 1 : 0;
          break;
        }
        if (redeemable) {
          redeemableSeen += 1;
          wDebtAhead += r.debt;
        }
      }
      if (wIcr === null) {
        // Target not found in the walked prefix (or no troves at all).
        wComplete = false;
        try {
          const icrRaw = (await client.readContract({
            address: sys.troveManager as Address,
            abi: troveManagerAbi,
            functionName: "getCurrentICR",
            args: [account, price],
          })) as bigint;
          wIcr = Number.parseFloat(formatUnits(icrRaw, 18));
        } catch {
          wIcr = null;
        }
      }
      return { rank: wRank, debtAhead: wDebtAhead, icr: wIcr, complete: wComplete, steps: wSteps };
    };
    if (ctx.env.STERNPOST_RADAR) {
      // rank() and the post-rank getCurrentICR read are separate steps
      // with separate catches (round 4, J3 O2): the old shared catch
      // labelled a getCurrentICR failure "deployed Radar rank() …" even
      // though rank() had already succeeded. Each failure is now named
      // for the read that actually threw; both fall back to the walk.
      let radarRankOk = false;
      try {
        const [r, d, s, c] = (await client.readContract({
          address: ctx.env.STERNPOST_RADAR as Address,
          abi: radarAbi,
          functionName: "rank",
          args: [account, BigInt(maxSteps)],
        })) as unknown as [bigint, bigint, bigint, boolean];
        rank = Number(r);
        debtAhead = d;
        steps = Number(s);
        complete = c;
        radarRankOk = true;
      } catch (err) {
        // The deployed Radar's rank() is one heavy eth_call: on an anvil
        // fork (remote state fetched per slot through the public RPC) or
        // a slow RPC it times out even though the Radar is fine — the
        // fork run hit this on 2026-11-15. Fall back to the direct walk
        // (same ground truth, one call at a time) and say what happened.
        const kind = classifyRankError(err);
        console.error(
          `[sternpost radar] deployed Radar rank() ${kind}: ${truncate(redactCredentials(err instanceof Error ? err.message : String(err)), 300)}`,
        );
        const w = await walkRank();
        rank = w.rank;
        debtAhead = w.debtAhead;
        icr = w.icr;
        complete = w.complete;
        steps = w.steps;
        rankSource = "walk";
        rankNote = `deployed Radar rank() ${kind}; fell back to the direct SortedTroves walk`;
      }
      if (radarRankOk) {
        try {
          const icrRaw = (await client.readContract({
            address: sys.troveManager as Address,
            abi: troveManagerAbi,
            functionName: "getCurrentICR",
            args: [account, price],
          })) as bigint;
          icr = Number.parseFloat(formatUnits(icrRaw, 18));
          rankSource = "radar";
        } catch (err) {
          // rank() SUCCEEDED — only the ICR read after it failed. The
          // walk re-derives rank/debtAhead/icr from the same ground
          // truth; the note names the ICR read, not rank().
          const kind = classifyRankError(err);
          console.error(
            `[sternpost radar] post-rank getCurrentICR read ${kind}: ${truncate(redactCredentials(err instanceof Error ? err.message : String(err)), 300)}`,
          );
          const w = await walkRank();
          rank = w.rank;
          debtAhead = w.debtAhead;
          icr = w.icr;
          complete = w.complete;
          steps = w.steps;
          rankSource = "walk";
          rankNote = `deployed Radar rank() succeeded but the post-rank getCurrentICR read ${kind}; fell back to the direct SortedTroves walk`;
        }
      }
    } else {
      const w = await walkRank();
      rank = w.rank;
      debtAhead = w.debtAhead;
      icr = w.icr;
      complete = w.complete;
      steps = w.steps;
      rankSource = "walk";
    }
  }

  // Shield: only a TroveAccount has a policy to report.
  let shield: { armed: boolean; triggers: string[] } = { armed: false, triggers: [] };
  if (account && account !== ZERO) {
    try {
      const code = await client.getBytecode({ address: account });
      if (code) {
        const policyRaw = (await client.readContract({
          address: account,
          abi: troveAccountAbi,
          functionName: "policy",
        })) as unknown as [bigint, bigint, bigint, bigint, bigint, number];
        const [floorICR, shieldICR, , , minDebtAhead] = policyRaw;
        void floorICR;
        const status = (await client.readContract({
          address: account,
          abi: troveAccountAbi,
          functionName: "status",
        })) as number;
        const triggers: string[] = [];
        if (shieldICR > 0n) triggers.push(`ICR<${formatUnits(shieldICR, 18)}`);
        if (minDebtAhead > 0n) triggers.push("RANK");
        shield = { armed: status === 1 && triggers.length > 0, triggers };
      }
    } catch {
      shield = { armed: false, triggers: [] };
    }
  }

  return ok({
    ok: true,
    tool: "radar",
    network,
    synthetic: network === "testnet",
    tcr: Number.parseFloat(formatUnits(tcr, 18)),
    recoveryMode,
    troveCount: Number(troveCount),
    rank,
    of: Number(troveCount),
    debtAheadMusd: formatUnits(debtAhead, 18),
    icr,
    frontierIcr: Number.parseFloat(formatUnits(frontierIcr, 18)),
    frontierTrove,
    frontierDebtMusd: formatUnits(frontierDebt, 18),
    shield,
    ...(account ? { account, complete, steps, ...(rankSource ? { rankSource } : {}), ...(rankNote ? { rankNote } : {}) } : {}),
  });
}

/* ------------------------------------------------------------------ */
/* Internal helpers (NOT registered tools): Classic 0.9 governor reads  */
/* ------------------------------------------------------------------ */

/**
 * preview_draw — Governor.previewDraw(app, amount, payee): the exact
 * allow/refuse verdict for a draw, with the on-chain reason code and a
 * human explanation. Never sends anything. Internal helper: `pay` calls
 * the TroveAccount previewDraw directly; this Classic helper stays for
 * the live 0.9 governor and for tests.
 */
export async function handlePreviewDraw(ctx: ToolContext, rawArgs: unknown) {
  rejectCredentialFields(rawArgs);
  const args = z.object(toolSchemas.preview_draw).strict().parse(rawArgs);
  if (ctx.network === "mainnet") await requireMainnetGate(ctx.env, (args.governor ?? ADDRESSES.governor) as string);
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
  if (ctx.network === "mainnet") await requireMainnetGate(ctx.env, (args.governor ?? ADDRESSES.governor) as string);
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
  const { deadline, deadlineISO } = safeDeadline(standbyDeadline);
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
      deadline,
      deadlineISO,
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
  if (ctx.network === "mainnet") await requireMainnetGate(ctx.env, ADDRESSES.governor);
  // Chain-gated even on the no-app path (J3 F3): a quote for the wrong
  // chain must never be served.
  const client = await checkedClient(ctx);
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
  if (ctx.network === "mainnet") await requireMainnetGate(ctx.env, wallet);
  const client = await checkedClient(ctx);
  const [agent, agentExpiry, owner, musdBalance] = await Promise.all([
    client.readContract({ address: wallet, abi: spendWalletAbi, functionName: "agent" }),
    client.readContract({ address: wallet, abi: spendWalletAbi, functionName: "agentExpiry" }),
    client.readContract({ address: wallet, abi: spendWalletAbi, functionName: "owner" }),
    client.readContract({ address: ADDRESSES.musd as Address, abi: musdAbi, functionName: "balanceOf", args: [wallet] }),
  ]);
  return { wallet, agent, agentExpiry: Number(agentExpiry), owner, musdBalanceWei: musdBalance.toString() };
}
