import { createPublicClient, http, parseAbi, type Address, type PublicClient } from "viem";
import { CHAIN_ID, EXPLORER_URL, rpcUrl, type McpEnv } from "./config.js";

/** Minimal view-only fragments. No sends are possible through this client: it only exposes readContract/getBalance. */
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

export function createClient(env: McpEnv): PublicClient {
  return createPublicClient({
    chain: {
      id: CHAIN_ID,
      name: "Mezo Testnet",
      nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl(env)] } },
      blockExplorers: { default: { name: "Mezo Explorer", url: EXPLORER_URL } },
      testnet: true,
    },
    transport: http(rpcUrl(env)),
  }) as PublicClient;
}

/** Refuses to serve if the RPC does not report chain 31611 (e.g. a mainnet URL was injected). */
export async function assertTestnet(client: PublicClient): Promise<number> {
  const id = await client.getChainId();
  if (id !== CHAIN_ID) {
    throw new Error(
      `refused: RPC reports chain ${id}, this server only serves Mezo testnet (${CHAIN_ID})`,
    );
  }
  return id;
}

export const explorerAddress = (a: Address) => `${EXPLORER_URL}/address/${a}`;
export const explorerTx = (h: string) => `${EXPLORER_URL}/tx/${h}`;

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
