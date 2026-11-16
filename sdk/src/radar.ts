import { parseAbi, type Address } from "viem";
import { MULTICALL3_ADDRESS } from "./chain.js";
import type { ReadClient } from "./read-client.js";

/**
 * Redemption Radar reads (plan §6.2/§6.3 data layer).
 *
 * Testnet: the deployed Radar contract (one Multicall3 batch) answers
 * system health, the redemption frontier and the viewed account's rank.
 * `rank` walks SortedTroves from the frontier; testnet holds ~277 troves
 * and a 300-step walk resolves in ~2 s on the public RPC (verified live
 * 2026-11-16: demo account rank #181, complete). A walk that does not
 * resolve is reported as `complete: false` and the UI must label the rank
 * as unresolved, never as safe.
 *
 * Mainnet: no Radar contract is deployed (pilot not started), so health is
 * read straight from Mezo's mainnet TroveManager / PriceFeed / SortedTroves
 * proxies (addresses verified against the official docs + release table).
 * Mainnet rank is not offered: the walk needs the Radar contract.
 */

const radarAbi = parseAbi([
  "function systemHealth() view returns (uint256 price, uint256 tcr, bool recoveryMode, uint256 troveCount)",
  "function frontier() view returns (address trove, uint256 icr, uint256 debt)",
  "function rank(address trove, uint256 maxSteps) view returns (uint256 rankOut, uint256 debtAhead, uint256 steps, bool complete)",
]);

const mainnetMezoAbi = parseAbi([
  "function fetchPrice() view returns (uint256)",
  "function getTCR(uint256 price) view returns (uint256)",
  "function checkRecoveryMode(uint256 price) view returns (bool)",
  "function getSize() view returns (uint256)",
]);

/** Mezo mainnet (31612) proxies, verified against official docs + release table (MEZO_RESOURCES.md). */
export const mainnetAddresses = {
  troveManager: "0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193",
  priceFeed: "0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88",
  sortedTroves: "0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f",
  musd: "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186",
} as const;

/** Lab-documented working mainnet RPC; rpc.mezo.org does not resolve (LAB_METHODS.md). */
export const MAINNET_RPC_URL = "https://rpc-http.mezo.boar.network";

export type RadarSnapshot = {
  network: "testnet" | "mainnet";
  price: bigint;
  tcr: bigint;
  recoveryMode: boolean;
  troveCount: bigint;
  frontier: { trove: Address; icr: bigint; debt: bigint } | null;
  /** Null on mainnet (no Radar contract) or when no account was asked for. */
  rank: { rank: bigint; debtAhead: bigint; steps: bigint; complete: boolean } | null;
};

type CallResult<T> = { status: "success"; result: T } | { status: "failure"; error?: unknown };

function ok<T>(r: CallResult<T> | undefined): T | undefined {
  return r?.status === "success" ? r.result : undefined;
}

/** Testnet Radar read: system health + frontier + rank of `account` (when given). */
export async function readRadar(
  client: ReadClient,
  radarAddress: Address,
  account?: Address,
  maxSteps = 300n,
): Promise<RadarSnapshot> {
  type RadarCall =
    | { address: Address; abi: typeof radarAbi; functionName: "systemHealth" }
    | { address: Address; abi: typeof radarAbi; functionName: "frontier" }
    | { address: Address; abi: typeof radarAbi; functionName: "rank"; args: readonly [Address, bigint] };
  const contracts: RadarCall[] = [
    { address: radarAddress, abi: radarAbi, functionName: "systemHealth" },
    { address: radarAddress, abi: radarAbi, functionName: "frontier" },
    ...(account ? [{ address: radarAddress, abi: radarAbi, functionName: "rank", args: [account, maxSteps] } as const] : []),
  ];
  const results = await client.multicall({
    contracts,
    allowFailure: true,
    multicallAddress: MULTICALL3_ADDRESS,
  });
  const [health, frontierR, rankR] = results as unknown as [
    CallResult<readonly [bigint, bigint, boolean, bigint]>,
    CallResult<readonly [Address, bigint, bigint]>,
    CallResult<readonly [bigint, bigint, bigint, boolean]> | undefined,
  ];
  const h = ok(health);
  const f = ok(frontierR);
  const r = account ? ok(rankR) : undefined;
  if (!h) throw new Error("Radar systemHealth read failed");
  return {
    network: "testnet",
    price: h[0],
    tcr: h[1],
    recoveryMode: h[2],
    troveCount: h[3],
    frontier: f && f[0] !== "0x0000000000000000000000000000000000000000" ? { trove: f[0], icr: f[1], debt: f[2] } : null,
    rank: r ? { rank: r[0], debtAhead: r[1], steps: r[2], complete: r[3] } : null,
  };
}

/** Mainnet system health, read straight from Mezo's mainnet contracts (no Radar deployed). */
export async function readMainnetHealth(client: ReadClient): Promise<RadarSnapshot> {
  // Two rounds: the price is an input to getTCR/checkRecoveryMode, so it is read first (one multicall),
  // then the three price-dependent reads run in a second batch.
  const [priceR] = await client.multicall({
    contracts: [{ address: mainnetAddresses.priceFeed, abi: mainnetMezoAbi, functionName: "fetchPrice" }],
    allowFailure: true,
    multicallAddress: MULTICALL3_ADDRESS,
  });
  const priceSlot = priceR as { status: string; result?: unknown } | undefined;
  const price = priceSlot?.status === "success" ? (priceSlot.result as bigint) : undefined;
  if (price === undefined) throw new Error("Mainnet PriceFeed read failed");
  const results = await client.multicall({
    contracts: [
      { address: mainnetAddresses.troveManager, abi: mainnetMezoAbi, functionName: "getTCR", args: [price] },
      { address: mainnetAddresses.troveManager, abi: mainnetMezoAbi, functionName: "checkRecoveryMode", args: [price] },
      { address: mainnetAddresses.sortedTroves, abi: mainnetMezoAbi, functionName: "getSize" },
    ],
    allowFailure: true,
    multicallAddress: MULTICALL3_ADDRESS,
  });
  const [tcrR, recoveryR, sizeR] = results as unknown as [
    { status: "success" | "failure"; result?: bigint },
    { status: "success" | "failure"; result?: boolean },
    { status: "success" | "failure"; result?: bigint },
  ];
  if (tcrR?.status !== "success" || recoveryR?.status !== "success" || sizeR?.status !== "success") {
    throw new Error("Mainnet system read failed");
  }
  return { network: "mainnet", price, tcr: tcrR.result!, recoveryMode: recoveryR.result!, troveCount: sizeR.result!, frontier: null, rank: null };
}
