import type { Address } from "viem";

/**
 * Minimal read-only client surface the SDK's `read()` functions need.
 *
 * Deliberately NOT viem's `PublicClient`: the app bundles its own viem copy,
 * and two viem copies produce structurally incompatible `PublicClient` types
 * (their branded EIP-1193 request types differ), so passing a client across
 * the package boundary fails typecheck even though the calls are identical.
 * A structural interface with only the methods used (`multicall`,
 * `getBalance`) accepts any viem client, and keeps the SDK unit-testable
 * with plain mock objects. The multicall result is typed `unknown[]` on
 * purpose: viem's `multicall` is generic over the contracts, and a generic
 * call through this interface infers `unknown[]` — callers cast the slots
 * they asked for (see `readAccount` / `readRadar`).
 */
export type ReadClient = {
  multicall(args: {
    contracts: readonly unknown[];
    allowFailure: boolean;
    multicallAddress?: Address;
  }): Promise<readonly unknown[]>;
  getBalance(args: { address: Address }): Promise<bigint>;
};
