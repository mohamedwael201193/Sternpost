import { parseAbi, type PublicClient } from "viem";

export type Hex = `0x${string}`;
export const ZERO = "0x0000000000000000000000000000000000000000";

export interface GovernorStatus {
  icr: bigint;
  floor: bigint;
  defend: bigint;
  frozen: boolean;
  buffer: bigint;
  /** standby().live: false means defend() is disarmed (expired, nonce moved, or never armed). */
  standbyLive: boolean;
  /** standby().deadline, unix seconds — shown as "armed until". */
  standbyDeadline: bigint;
}
export interface AppAllowance { remaining: bigint; perDrawMax: bigint; expiry: bigint }

/** Minimum collateral ratio: troves below this ICR are skipped by redemptions. */
export const MCR = 11n * 10n ** 17n; // 1.1e18
/** Troves walked from the redemption frontier when ranking a trove. A bounded
    walk: the live list has ~279 troves and one RPC round-trip costs ~0.1s, so a
    full walk would take ~90s. Past the window the rank is reported honestly as
    "deeper than N" with debtAhead as a lower bound (Radar.sol `complete=false`
    semantics). */
export const RADAR_MAX_STEPS = 20;

export interface RadarFrontier { trove: Hex; icr: bigint; debt: bigint }
export interface RadarReading {
  price: bigint;
  tcr: bigint;
  recoveryMode: boolean;
  troveCount: bigint;
  frontier: RadarFrontier | null;
  mine: { status: number; icr: bigint; debt: bigint; coll: bigint };
  /** 1-based redeemable rank from the frontier; 0 = not ranked in the walked window. */
  rank: number;
  /** Redeemable MUSD debt strictly ahead of the trove within the walked window. */
  debtAhead: bigint;
  steps: number;
  /** True iff the borrower's trove was found inside the walked window. */
  found: boolean;
  /** True iff the rank is resolved: found, or the list ended (borrower not in it). */
  complete: boolean;
  /** True iff the walk ran off the end of the list (borrower trove not in it). */
  exhausted: boolean;
}
export interface CrewWallet { address: Hex; agent: Hex; agentExpiry: bigint; musd: bigint }
export interface CrewReading { governor: Hex | null; govStatus: GovernorStatus | null; wallets: CrewWallet[] }

/** Read-only chain access used by the bot. Every approval decision is read back from here, never trusted from chat. */
export interface ChainReader {
  governorOf(borrower: Hex): Promise<Hex | null>;
  status(governor: Hex): Promise<GovernorStatus>;
  allowance(governor: Hex, app: Hex): Promise<AppAllowance>;
  balances(owner: Hex): Promise<{ musd: bigint; mezo: bigint }>;
  now(): Promise<bigint>;
  /** Live redemption radar: system health + frontier + the borrower's rank. */
  radar(borrower: Hex): Promise<RadarReading>;
  /** Live crew: the borrower's governor + spend wallets (agents). */
  crew(borrower: Hex): Promise<CrewReading>;
}

const factoryAbi = parseAbi(["function governorOf(address) view returns (address)"]);
const govAbi = parseAbi([
  "function icr() view returns (uint256)",
  "function floorICR() view returns (uint256)",
  "function defendICR() view returns (uint256)",
  "function frozen() view returns (bool)",
  "function buffer() view returns (uint256)",
  "function standby() view returns (uint256 amount, uint256 deadline, uint256 nonce, bool live)",
  "function appPolicy(address) view returns (uint128 budget, uint128 spent, uint128 perDrawMax, uint64 expiry, address payee)",
]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const troveManagerAbi = parseAbi([
  "function getCurrentICR(address borrower, uint256 price) view returns (uint256)",
  "function getEntireDebtAndColl(address borrower) view returns (uint256 coll, uint256 principal, uint256 interest, uint256 pendingCollateral, uint256 pendingPrincipal, uint256 pendingInterest)",
  "function getTCR(uint256 price) view returns (uint256)",
  "function checkRecoveryMode(uint256 price) view returns (bool)",
  "function getTroveStatus(address borrower) view returns (uint8)",
]);
const priceFeedAbi = parseAbi(["function fetchPrice() view returns (uint256)"]);
const sortedTrovesAbi = parseAbi([
  "function getLast() view returns (address)",
  "function getPrev(address trove) view returns (address)",
  "function getSize() view returns (uint256)",
]);
const spendWalletAbi = parseAbi([
  "function agent() view returns (address)",
  "function agentExpiry() view returns (uint64)",
]);
const factoryWalletsAbi = parseAbi(["function walletsOf(address owner) view returns (address[])"]);

export function viemChain(client: PublicClient, a: { factory: Hex; musd: Hex; mezo: Hex; troveManager: Hex; priceFeed: Hex; sortedTroves: Hex }): ChainReader {
  const read = (address: Hex, abi: any, functionName: string, args: unknown[] = []) =>
    client.readContract({ address, abi, functionName, args } as any) as Promise<any>;
  const entireDebt = async (trove: Hex): Promise<{ coll: bigint; debt: bigint }> => {
    const [coll, principal, interest]: [bigint, bigint, bigint] = await read(a.troveManager, troveManagerAbi, "getEntireDebtAndColl", [trove]);
    return { coll, debt: principal + interest };
  };
  const statusOf = async (g: Hex): Promise<GovernorStatus> => {
    const [icr, floor, defend, frozen, buffer, sb] = await Promise.all(
      ["icr", "floorICR", "defendICR", "frozen", "buffer", "standby"].map((fn) => read(g, govAbi, fn)),
    );
    return { icr, floor, defend, frozen, buffer, standbyLive: (sb as readonly [bigint, bigint, bigint, boolean])[3], standbyDeadline: (sb as readonly [bigint, bigint, bigint, boolean])[1] };
  };
  return {
    async governorOf(b) {
      const g = (await read(a.factory, factoryAbi, "governorOf", [b])) as Hex;
      return g.toLowerCase() === ZERO ? null : (g.toLowerCase() as Hex);
    },
    async status(g) {
      return statusOf(g);
    },
    async allowance(g, app) {
      const [budget, spent, perDrawMax, expiry]: [bigint, bigint, bigint, bigint] = await read(g, govAbi, "appPolicy", [app]);
      return { remaining: budget - spent, perDrawMax, expiry: BigInt(expiry) };
    },
    async balances(o) {
      const [musd, mezo] = await Promise.all([read(a.musd, erc20, "balanceOf", [o]), read(a.mezo, erc20, "balanceOf", [o])]);
      return { musd, mezo };
    },
    async now() {
      return (await client.getBlock()).timestamp;
    },
    async radar(borrower) {
      const price = (await read(a.priceFeed, priceFeedAbi, "fetchPrice")) as bigint;
      const [tcr, recoveryMode, troveCount, mineStatus, mineIcr, mine] = await Promise.all([
        read(a.troveManager, troveManagerAbi, "getTCR", [price]) as Promise<bigint>,
        read(a.troveManager, troveManagerAbi, "checkRecoveryMode", [price]) as Promise<boolean>,
        read(a.sortedTroves, sortedTrovesAbi, "getSize") as Promise<bigint>,
        read(a.troveManager, troveManagerAbi, "getTroveStatus", [borrower]) as Promise<number>,
        read(a.troveManager, troveManagerAbi, "getCurrentICR", [borrower, price]) as Promise<bigint>,
        entireDebt(borrower),
      ]);
      // Walk the address chain first (one call per step, cheapest), then read
      // ICR + debt for the collected troves in parallel.
      const addrs: Hex[] = [];
      let cur = (await read(a.sortedTroves, sortedTrovesAbi, "getLast")) as Hex;
      let exhausted = false;
      while (cur.toLowerCase() !== ZERO && addrs.length < RADAR_MAX_STEPS) {
        addrs.push(cur.toLowerCase() as Hex);
        if (cur.toLowerCase() === borrower.toLowerCase()) break;
        cur = (await read(a.sortedTroves, sortedTrovesAbi, "getPrev", [cur])) as Hex;
      }
      if (cur.toLowerCase() === ZERO) exhausted = true;
      const reads = await Promise.all(
        addrs.map(async (t) => {
          const [icr, d] = await Promise.all([
            read(a.troveManager, troveManagerAbi, "getCurrentICR", [t, price]) as Promise<bigint>,
            entireDebt(t),
          ]);
          return { trove: t, icr, debt: d.debt };
        }),
      );
      const target = borrower.toLowerCase();
      let rank = 0, debtAhead = 0n, found = false;
      let redeemableSeen = 0;
      for (const r of reads) {
        const redeemable = r.icr >= MCR;
        if (r.trove === target) {
          rank = redeemable ? redeemableSeen + 1 : 0;
          found = true;
          break;
        }
        if (redeemable) {
          redeemableSeen += 1;
          debtAhead += r.debt;
        }
      }
      const complete = found || exhausted; // list ended: borrower trove is not in it
      const frontier = reads.length
        ? { trove: reads[0].trove, icr: reads[0].icr, debt: reads[0].debt }
        : null;
      return {
        price, tcr, recoveryMode, troveCount, frontier,
        mine: { status: mineStatus, icr: mineIcr, debt: mine.debt, coll: mine.coll },
        rank, debtAhead, steps: reads.length, found, complete, exhausted,
      };
    },
    async crew(borrower) {
      const [governor, walletAddrs] = await Promise.all([
        (async () => {
          const g = (await read(a.factory, factoryAbi, "governorOf", [borrower])) as Hex;
          return g.toLowerCase() === ZERO ? null : (g.toLowerCase() as Hex);
        })(),
        read(a.factory, factoryWalletsAbi, "walletsOf", [borrower]) as Promise<Hex[]>,
      ]);
      const [govStatus, wallets] = await Promise.all([
        governor ? statusOf(governor) : Promise.resolve(null),
        Promise.all(
          walletAddrs.map(async (w) => {
            const [agent, agentExpiry, musd] = await Promise.all([
              read(w, spendWalletAbi, "agent") as Promise<Hex>,
              read(w, spendWalletAbi, "agentExpiry") as Promise<bigint>,
              read(a.musd, erc20, "balanceOf", [w]) as Promise<bigint>,
            ]);
            return { address: w.toLowerCase() as Hex, agent: agent.toLowerCase() as Hex, agentExpiry, musd };
          }),
        ),
      ]);
      return { governor, govStatus, wallets };
    },
  };
}
