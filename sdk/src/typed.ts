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

/**
 * EIP-712 domain of a production TroveAccount (TroveAccount.sol:
 * DOMAIN_NAME_HASH = keccak256("SternpostTroveAccount"), version "1").
 * The verifyingContract is the account clone, NOT the factory.
 * NOTE: the lab prototypes used domain name "TroveAccountV3" — the
 * production contract renamed it. Always use this helper for production
 * accounts; the on-chain domainSeparator() is the ground truth.
 */
export const accountDomain = (chainId: number, account: Address) =>
  ({ name: "SternpostTroveAccount", version: "1", chainId, verifyingContract: account }) as const;

/** DrawIntent(agent, payee, amount, nonce, deadline) — TroveAccount.drawBySig. */
export const drawIntentTypes = {
  DrawIntent: [
    { name: "agent", type: "address" },
    { name: "payee", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
