import { parseAbi, type Address, type PublicClient } from "viem";

/**
 * On-chain reads behind the gateway routes (plan §5.3, §3.8).
 *
 * Testnet only: every address here is a Mezo testnet (31611) contract. The
 * Radar contract is the Shield-redeploy one from
 * `shared/deployments/testnet.json` (`accounts.radar`). Ranks on testnet are
 * synthetic — the frontier is whale-dominated (§3.8) — so callers must
 * label them as such; `readRadar` reports `synthetic: true`.
 */

export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

const radarAbi = parseAbi([
  "function systemHealth() view returns (uint256 price, uint256 tcr, bool recoveryMode, uint256 troveCount)",
  "function frontier() view returns (address trove, uint256 icr, uint256 debt)",
  "function rank(address trove, uint256 maxSteps) view returns (uint256 rankOut, uint256 debtAhead, uint256 steps, bool complete)",
]);

const troveAccountAbi = parseAbi([
  "function previewDraw(address agent, address payee, uint256 amount) view returns (bool ok, uint8 reasonCode, uint256 icrAfter, uint256 fee)",
  "function policy() view returns (uint256 floorICR, uint256 shieldICR, uint256 targetICR, uint256 bounty, uint256 minDebtAhead, uint256 cooldownBlocks)",
  "function status() view returns (uint8)",
]);

const mezoAbi = parseAbi([
  "function fetchPrice() view returns (uint256)",
  "function getCurrentICR(address borrower, uint256 price) view returns (uint256)",
  "function getTCR(uint256 price) view returns (uint256)",
  "function checkRecoveryMode(uint256 price) view returns (bool)",
]);

/** TCR below this → shield trigger reason 3 (`TroveAccount.TCR_SHIELD_THRESHOLD`). */
export const TCR_SHIELD_THRESHOLD = 1_550_000_000_000_000_000n;

export type RadarSnapshot = {
  network: "testnet";
  /** True on testnet: ranks are synthetic (whale-dominated frontier, plan §3.8). */
  synthetic: true;
  price: bigint;
  tcr: bigint;
  recoveryMode: boolean;
  troveCount: bigint;
  frontier: { trove: Address; icr: bigint; debt: bigint } | null;
  /** Null when the rank walk does not resolve (incomplete) or reverts. */
  rank: { rank: bigint; debtAhead: bigint; steps: bigint; complete: boolean } | null;
};

export type PreviewDrawResult = {
  ok: boolean;
  reasonCode: number;
  icrAfter: bigint;
  fee: bigint;
};

export type RiskData = {
  account: Address;
  status: number;
  icr: bigint;
  price: bigint;
  tcr: bigint;
  recoveryMode: boolean;
  troveCount: bigint;
  rank: RadarSnapshot["rank"];
  policy: {
    floorICR: bigint;
    shieldICR: bigint;
    targetICR: bigint;
    bounty: bigint;
    minDebtAhead: bigint;
    cooldownBlocks: bigint;
  };
  /** True when the account's shield would fire (ICR < shield, or TCR < threshold). */
  shieldWanted: boolean;
  shieldReasons: string[];
};

export interface GatewayChainReader {
  readRadar(account: Address): Promise<RadarSnapshot>;
  readPreviewDraw(account: Address, agent: Address, payee: Address, amount: bigint): Promise<PreviewDrawResult>;
  readRisk(account: Address): Promise<RiskData>;
}

export interface GatewayChainAddresses {
  radar: Address;
  troveManager: Address;
  priceFeed: Address;
}

type CallResult<T> = { status: "success"; result: T } | { status: "failure"; error?: unknown };
const ok = <T>(r: CallResult<T> | undefined): T | undefined => (r?.status === "success" ? r.result : undefined);

export function createGatewayChainReader(
  client: Pick<PublicClient, "multicall" | "readContract">,
  addrs: GatewayChainAddresses,
): GatewayChainReader {
  async function readRadar(account: Address): Promise<RadarSnapshot> {
    const results = await client.multicall({
      contracts: [
        { address: addrs.radar, abi: radarAbi, functionName: "systemHealth" },
        { address: addrs.radar, abi: radarAbi, functionName: "frontier" },
        { address: addrs.radar, abi: radarAbi, functionName: "rank", args: [account, 300n] },
      ],
      allowFailure: true,
      multicallAddress: MULTICALL3_ADDRESS,
    });
    const [health, frontierR, rankR] = results as unknown as [
      CallResult<readonly [bigint, bigint, boolean, bigint]>,
      CallResult<readonly [Address, bigint, bigint]>,
      CallResult<readonly [bigint, bigint, bigint, boolean]>,
    ];
    const h = ok(health);
    if (!h) throw new Error("Radar systemHealth read failed");
    const f = ok(frontierR);
    const r = ok(rankR);
    return {
      network: "testnet",
      synthetic: true,
      price: h[0],
      tcr: h[1],
      recoveryMode: h[2],
      troveCount: h[3],
      frontier:
        f && f[0] !== "0x0000000000000000000000000000000000000000"
          ? { trove: f[0], icr: f[1], debt: f[2] }
          : null,
      rank: r ? { rank: r[0], debtAhead: r[1], steps: r[2], complete: r[3] } : null,
    };
  }

  async function readPreviewDraw(
    account: Address,
    agent: Address,
    payee: Address,
    amount: bigint,
  ): Promise<PreviewDrawResult> {
    const [isOk, reasonCode, icrAfter, fee] = await client.readContract({
      address: account,
      abi: troveAccountAbi,
      functionName: "previewDraw",
      args: [agent, payee, amount],
    });
    return { ok: isOk, reasonCode, icrAfter, fee };
  }

  async function readRisk(account: Address): Promise<RiskData> {
    const price = await client.readContract({
      address: addrs.priceFeed,
      abi: mezoAbi,
      functionName: "fetchPrice",
    });
    const [icr, tcr, recoveryMode, status, policy, radar] = await Promise.all([
      client.readContract({ address: addrs.troveManager, abi: mezoAbi, functionName: "getCurrentICR", args: [account, price] }),
      client.readContract({ address: addrs.troveManager, abi: mezoAbi, functionName: "getTCR", args: [price] }),
      client.readContract({ address: addrs.troveManager, abi: mezoAbi, functionName: "checkRecoveryMode", args: [price] }),
      client.readContract({ address: account, abi: troveAccountAbi, functionName: "status" }),
      client.readContract({ address: account, abi: troveAccountAbi, functionName: "policy" }),
      readRadar(account).catch(() => null),
    ]);
    const [floorICR, shieldICR, targetICR, bounty, minDebtAhead, cooldownBlocks] = policy;
    const shieldReasons: string[] = [];
    if (icr < shieldICR) shieldReasons.push("below_shield");
    if (tcr < TCR_SHIELD_THRESHOLD) shieldReasons.push("tcr_near_recovery");
    return {
      account,
      status,
      icr,
      price,
      tcr,
      recoveryMode,
      troveCount: radar?.troveCount ?? 0n,
      rank: radar?.rank ?? null,
      policy: { floorICR, shieldICR, targetICR, bounty, minDebtAhead, cooldownBlocks },
      shieldWanted: shieldReasons.length > 0,
      shieldReasons,
    };
  }

  return { readRadar, readPreviewDraw, readRisk };
}
