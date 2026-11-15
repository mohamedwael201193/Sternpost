import { parseAbi, type PublicClient } from "viem";

/** Minimal TroveAccountFactory read surface: `isAccount` is the on-chain source of truth for "this Factory created this account". */
export const accountFactoryAbi = parseAbi(["function isAccount(address account) view returns (bool)"]);

export type FactoryChecker = (account: `0x${string}`) => Promise<boolean>;

/**
 * Build an `isAccount` checker against a deployed TroveAccountFactory.
 * Fails CLOSED (returns false) on any RPC error: a relay must never be
 * sponsored for an account whose provenance cannot be proven.
 */
export function createFactoryChecker(client: PublicClient, factory: `0x${string}`): FactoryChecker {
  return async (account) => {
    try {
      return await client.readContract({
        address: factory,
        abi: accountFactoryAbi,
        functionName: "isAccount",
        args: [account],
      });
    } catch {
      return false;
    }
  };
}
