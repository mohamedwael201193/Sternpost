import { hashTypedData, type Address, type Hex } from "viem";
import { accountDomain, drawIntentTypes } from "./typed.js";

/**
 * EIP-712 DrawIntent for TroveAccount.drawBySig (plan §5.2, §3.5).
 *
 * The agent signs `DrawIntent(agent, payee, amount, nonce, deadline)` under
 * the account's domain ({name: "SternpostTroveAccount", version: "1"}); the
 * nonce is the account's per-agent `intentNonce(agent)`, so intents of
 * different agents never conflict, and ANYONE (a Batcher, a relayer) may
 * submit the signed intent. The owner signs nothing.
 *
 * The domain name is "SternpostTroveAccount" on the PRODUCTION contract.
 * The lab prototypes used "TroveAccountV3" — do not use that name here.
 * The on-chain `domainSeparator()` / `intentDigest()` views are the ground
 * truth; `intentDigest()` below must equal the contract's digest for the
 * same fields (checked in the live example and in tests).
 */

export type IntentSigner = {
  address: Address;
  signTypedData: (args: {
    domain: ReturnType<typeof accountDomain>;
    types: typeof drawIntentTypes;
    primaryType: "DrawIntent";
    message: { agent: Address; payee: Address; amount: bigint; nonce: bigint; deadline: bigint };
  }) => Promise<Hex>;
};

export type DrawIntent = {
  agent: Address;
  payee: Address;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
  sig: Hex;
};

/** Pure EIP-712 digest of a DrawIntent (== TroveAccount.intentDigest). */
export function intentDigest(
  chainId: number,
  account: Address,
  agent: Address,
  payee: Address,
  amount: bigint,
  nonce: bigint,
  deadline: bigint,
): Hex {
  return hashTypedData({
    domain: accountDomain(chainId, account),
    types: drawIntentTypes,
    primaryType: "DrawIntent",
    message: { agent, payee, amount, nonce, deadline },
  });
}

/**
 * Sign a draw intent with the agent key. `readNonce` supplies the account's
 * current `intentNonce(agent)` (the caller reads it on chain); the nonce is
 * consumed only when the intent is submitted, so a signed-but-unsubmitted
 * intent stays valid until its deadline.
 */
export async function signIntent(opts: {
  chainId: number;
  account: Address;
  agent: IntentSigner;
  payee: Address;
  amount: bigint;
  readNonce: () => Promise<bigint>;
  /** Seconds from now until the intent expires. Default 120 (plan §5.2). */
  deadlineSec?: number;
}): Promise<DrawIntent> {
  const nonce = await opts.readNonce();
  const deadline = BigInt(Math.floor(Date.now() / 1000) + (opts.deadlineSec ?? 120));
  const sig = await opts.agent.signTypedData({
    domain: accountDomain(opts.chainId, opts.account),
    types: drawIntentTypes,
    primaryType: "DrawIntent",
    message: { agent: opts.agent.address, payee: opts.payee, amount: opts.amount, nonce, deadline },
  });
  return { agent: opts.agent.address, payee: opts.payee, amount: opts.amount, nonce, deadline, sig };
}
