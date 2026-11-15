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

/** Read-only chain access used by the bot. Every approval decision is read back from here, never trusted from chat. */
export interface ChainReader {
  governorOf(borrower: Hex): Promise<Hex | null>;
  status(governor: Hex): Promise<GovernorStatus>;
  allowance(governor: Hex, app: Hex): Promise<AppAllowance>;
  balances(owner: Hex): Promise<{ musd: bigint; mezo: bigint }>;
  now(): Promise<bigint>;
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

export function viemChain(client: PublicClient, a: { factory: Hex; musd: Hex; mezo: Hex }): ChainReader {
  const read = (address: Hex, abi: any, functionName: string, args: unknown[] = []) =>
    client.readContract({ address, abi, functionName, args } as any) as Promise<any>;
  return {
    async governorOf(b) {
      const g = (await read(a.factory, factoryAbi, "governorOf", [b])) as Hex;
      return g.toLowerCase() === ZERO ? null : (g.toLowerCase() as Hex);
    },
    async status(g) {
      const [icr, floor, defend, frozen, buffer, sb] = await Promise.all(
        ["icr", "floorICR", "defendICR", "frozen", "buffer", "standby"].map((fn) => read(g, govAbi, fn)),
      );
      return { icr, floor, defend, frozen, buffer, standbyLive: (sb as readonly [bigint, bigint, bigint, boolean])[3], standbyDeadline: (sb as readonly [bigint, bigint, bigint, boolean])[1] };
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
  };
}
