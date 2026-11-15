import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CHAIN_ID,
  EXPLORER_URL,
  MEZO_MAINNET,
  MEZO_TESTNET,
  chainIdFor,
  explorerUrl,
  musdAddress,
  resolveNetwork,
  rpcUrl,
  type McpEnv,
  type NetworkName,
} from "./config.js";
import { REFUSALS } from "./reasons.js";

/** Minimal view-only fragments. No sends are possible through a public client: it only exposes readContract/getBalance. */
export const musdAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export const governorAbi = parseAbi([
  "function borrower() view returns (address)",
  "function buffer() view returns (uint256)",
  "function defendICR() view returns (uint256)",
  "function feeBps() view returns (uint16)",
  "function feeRecipient() view returns (address)",
  "function floorICR() view returns (uint256)",
  "function frozen() view returns (bool)",
  "function icr() view returns (uint256)",
  "function musd() view returns (address)",
  "function previewDraw(address app, uint256 amount, address payee) view returns (bool allowed, string reason, uint256 icrAfter)",
  "function remainingBudget(address app) view returns (uint256)",
  "function standby() view returns (uint256 amount, uint256 deadline, uint256 nonce, bool live)",
]);

export const factoryAbi = parseAbi([
  "function governorOf(address borrower) view returns (address)",
  "function walletsOf(address owner) view returns (address[])",
]);

export const spendWalletAbi = parseAbi([
  "function agent() view returns (address)",
  "function agentExpiry() view returns (uint64)",
  "function owner() view returns (address)",
]);

/**
 * TroveAccount (Wave 2 account system, plan §3.3/§5.1): the surface the MCP
 * tools need. `sessions` is the public mapping getter (12 fields, in
 * struct order); `previewDraw` returns the numeric reason code
 * (0 OK, 1 SESSION_INACTIVE, 2 PAYEE_NOT_ALLOWED, 3 OVER_PER_TX,
 * 4 OVER_BUDGET, 5 OVER_DAILY, 6 BELOW_FLOOR, 7 RECOVERY_MODE,
 * 8 TROVE_NOT_ACTIVE, 9 ZERO_AMOUNT).
 */
export const troveAccountAbi = parseAbi([
  "function owner() view returns (address)",
  "function policy() view returns (uint64 floorICR, uint64 shieldICR, uint64 targetICR, uint128 bounty, uint128 minDebtAhead, uint32 cooldownBlocks)",
  "function sessionEpoch() view returns (uint32)",
  "function sessions(address agent) view returns (uint128 budget, uint128 spent, uint128 perTx, uint128 dailyLimit, uint128 daySpent, uint64 expiry, uint64 dayStart, uint32 epoch, uint32 gen, bool anyPayee, bool canSignX402, bool active)",
  "function status() view returns (uint8)",
  "function previewDraw(address agent, address payee, uint256 amount) view returns (bool ok, uint8 reasonCode, uint256 icrAfter, uint256 fee)",
  "function needed() view returns (uint256 icr, uint256 repayWanted, uint256 collWanted, uint8 reason)",
  "function feeBps() view returns (uint16)",
  "function feeRecipient() view returns (address)",
  "function draw(address payee, uint256 amount)",
  "function intentNonce(address agent) view returns (uint256)",
]);

/** Mezo system reads the `radar` tool needs (direct calls; no Radar deployment required). */
export const priceFeedAbi = parseAbi(["function fetchPrice() view returns (uint256)"]);
export const troveManagerAbi = parseAbi([
  "function getCurrentICR(address borrower, uint256 price) view returns (uint256)",
  "function getEntireDebtAndColl(address borrower) view returns (uint256 coll, uint256 principal, uint256 interest, uint256 pendingCollateral, uint256 pendingPrincipal, uint256 pendingInterest)",
  "function getTCR(uint256 price) view returns (uint256)",
  "function checkRecoveryMode(uint256 price) view returns (bool)",
  "function getTroveStatus(address borrower) view returns (uint8)",
]);
export const sortedTrovesAbi = parseAbi([
  "function getLast() view returns (address)",
  "function getPrev(address trove) view returns (address)",
  "function getSize() view returns (uint256)",
]);

/** Radar contract (contracts/src/account/Radar.sol), used only when STERNPOST_RADAR is set. */
export const radarAbi = parseAbi([
  "function systemHealth() view returns (uint256 price, uint256 tcr, bool recoveryMode, uint256 troveCount)",
  "function frontier() view returns (address trove, uint256 icr, uint256 debt)",
  "function rank(address trove, uint256 maxSteps) view returns (uint256 rankOut, uint256 debtAhead, uint256 steps, bool complete)",
]);

export function createClient(env: McpEnv, network: NetworkName = resolveNetwork(env)): PublicClient {
  const chainId = chainIdFor(network);
  // 30 s per-request timeout (viem default is 10 s): the public testnet
  // RPC stalls under bursts and a 10 s timeout turns a slow read into a
  // failed one. Retries stay at the viem default.
  // STERNPOST_RPC_TIMEOUT_MS overrides it (fork runs use 300_000).
  const transport = http(rpcUrl(env, network), { timeout: env.STERNPOST_RPC_TIMEOUT_MS ?? 30_000 });
  return createPublicClient({
    chain: {
      id: chainId,
      name: network === "mainnet" ? "Mezo" : "Mezo Testnet",
      nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl(env, network)] } },
      blockExplorers: { default: { name: "Mezo Explorer", url: explorerUrl(network) } },
      testnet: network === "testnet",
    },
    transport,
  }) as PublicClient;
}

/** Signing client for the agent key (only used by `pay` for the refill draw). */
export function createAgentWallet(
  env: McpEnv,
  privateKey: `0x${string}`,
  network: NetworkName = resolveNetwork(env),
): WalletClient {
  const chainId = chainIdFor(network);
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: {
      id: chainId,
      name: network === "mainnet" ? "Mezo" : "Mezo Testnet",
      nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl(env, network)] } },
      blockExplorers: { default: { name: "Mezo Explorer", url: explorerUrl(network) } },
      testnet: network === "testnet",
    },
    transport: http(rpcUrl(env, network), { timeout: env.STERNPOST_RPC_TIMEOUT_MS ?? 30_000 }),
  });
}

/**
 * Mainnet gate (plan §5.1): mainnet is refused unless STERNPOST_MAINNET_OK=1
 * AND the account address is in the mainnet deployments file. That file
 * (shared/deployments/mainnet.json) does not exist yet, so mainnet is
 * refused outright today — the REFUSALS.MAINNET_REFUSED constant is wired
 * here (J1 F5 / J3 F7), not dead.
 */
export async function requireMainnetGate(env: McpEnv, account?: string): Promise<void> {
  if (env.STERNPOST_MAINNET_OK !== "1") {
    throw new Error(
      `${REFUSALS.MAINNET_REFUSED} Set STERNPOST_MAINNET_OK=1 to enable the mainnet path.`,
    );
  }
  let text: string;
  try {
    const { readFile } = await import("node:fs/promises");
    const url = new URL("../../shared/deployments/mainnet.json", import.meta.url);
    text = await readFile(url, "utf8");
  } catch {
    text = "";
  }
  if (!account || !text.toLowerCase().includes(account.toLowerCase())) {
    throw new Error(
      `${REFUSALS.MAINNET_REFUSED} No mainnet deployment records this account (shared/deployments/mainnet.json is missing or does not list it).`,
    );
  }
}

/** Refuses to serve if the RPC does not report the expected chain (e.g. a mainnet URL was injected while serving testnet). */
export async function assertNetwork(client: PublicClient, expectedChainId: number): Promise<number> {
  const id = await client.getChainId();
  if (id !== expectedChainId) {
    throw new Error(
      `refused: RPC reports chain ${id}, this server is configured for chain ${expectedChainId}`,
    );
  }
  return id;
}

/** Backwards-compatible name: the default (testnet) chain check. */
export async function assertTestnet(client: PublicClient): Promise<number> {
  return assertNetwork(client, CHAIN_ID);
}

export const explorerAddress = (a: Address) => `${EXPLORER_URL}/address/${a}`;
export const explorerTx = (h: string) => `${EXPLORER_URL}/tx/${h}`;
export const explorerAddressFor = (network: NetworkName, a: Address) =>
  `${explorerUrl(network)}/address/${a}`;
export const explorerTxFor = (network: NetworkName, h: string) =>
  `${explorerUrl(network)}/tx/${h}`;

/** Format a wei bigint as a decimal string with the given decimals (no float). */
export function formatUnits(value: bigint, decimals = 18): string {
  const s = value.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, -decimals).replace(/^0+(?=\d)/, "");
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

/** Parse a decimal MUSD string ("10.5") to wei. Rejects >18 decimals, negatives, non-numeric. */
export function parseMusd(value: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(value.trim());
  if (!m) throw new Error(`amountMusd must be a non-negative decimal string, got ${JSON.stringify(value)}`);
  const frac = (m[2] ?? "").padEnd(18, "0");
  return BigInt(m[1]) * 10n ** 18n + BigInt(frac || "0");
}

/**
 * Clamp a uint256 deadline (seconds) to an ISO string. Returns the raw
 * deadline as a string plus `deadlineISO: null` when the value is out of
 * Date range (e.g. uint256.max) instead of throwing RangeError (J3 F4).
 */
export function safeDeadline(deadline: bigint): { deadline: string; deadlineISO: string | null } {
  const raw = deadline.toString();
  // Date range is ±8.64e15 ms; seconds beyond that cannot be represented.
  const maxSeconds = 8_640_000_000_000n;
  if (deadline > maxSeconds) return { deadline: raw, deadlineISO: null };
  return { deadline: raw, deadlineISO: new Date(Number(deadline) * 1000).toISOString() };
}

/** Mezo system addresses for a network (mainnet: only MUSD is pinned; the rest come from the deployments file). */
export function mezoSystem(network: NetworkName): {
  musd: string;
  borrowerOperations?: string;
  troveManager?: string;
  priceFeed?: string;
  sortedTroves?: string;
  hintHelpers?: string;
} {
  if (network === "mainnet") return { musd: MEZO_MAINNET.musd };
  return {
    musd: MEZO_TESTNET.musd,
    borrowerOperations: MEZO_TESTNET.borrowerOperations,
    troveManager: MEZO_TESTNET.troveManager,
    priceFeed: MEZO_TESTNET.priceFeed,
    sortedTroves: MEZO_TESTNET.sortedTroves,
    hintHelpers: MEZO_TESTNET.hintHelpers,
  };
}

/** MUSD address for a network (re-export for tools). */
export const musdFor = musdAddress;
