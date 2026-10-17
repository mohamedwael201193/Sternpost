import type { Address } from "viem";

/** EIP-712 shapes used by Mezo's BorrowerOperationsSignatures (name "BorrowerOperationsSignatures", version "1"). */
export const domain = (chainId: number, verifyingContract: Address) =>
  ({ name: "BorrowerOperationsSignatures", version: "1", chainId, verifyingContract }) as const;

export const withdrawTypes = {
  WithdrawMUSD: [
    { name: "amount", type: "uint256" },
    { name: "borrower", type: "address" },
    { name: "recipient", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const repayTypes = {
  RepayMUSD: [
    { name: "amount", type: "uint256" },
    { name: "borrower", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const addCollTypes = {
  AddColl: [
    { name: "assetAmount", type: "uint256" },
    { name: "borrower", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** The governor rejects withdraw signatures that live longer than this. */
export const MAX_WINDOW = 120n;
