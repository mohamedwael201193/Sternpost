import { parseAbi, type Address } from "viem";
import { troveAccountAbi } from "./abi.js";
import { MULTICALL3_ADDRESS, testnetAddresses } from "./chain.js";
import type { ReadClient } from "./read-client.js";

/**
 * Read-only snapshot of a TroveAccount (plan §6.2/§6.3 data layer).
 *
 * One Multicall3 batch (`0xcA11bde05977b3631167028862bE2a173976CA11`) reads the
 * account contract, the Mezo TroveManager, the PriceFeed and the MUSD/sMUSD
 * balances. Reads use a public RPC client; nothing here signs or sends.
 *
 * Two account generations exist on testnet, and the batch reads both shapes
 * with `allowFailure`: the production TroveAccount (v3, `policy()` tuple +
 * `status()` + 4-value `needed()`) and the lab TroveAccountV2 (separate
 * `floorICR()`/`shieldICR()`/`targetICR()`/`bounty()` getters + 3-value
 * `needed()`). Whichever shape answers decides `version`; an address that
 * answers neither is not an account contract, but its trove (if any) still
 * reads fine from the TroveManager.
 */

const troveManagerAbi = parseAbi([
  "function getEntireDebtAndColl(address borrower) view returns (uint256 coll, uint256 principal, uint256 interest, uint256 pendingCollateral, uint256 pendingPrincipal, uint256 pendingInterest)",
  "function getTroveStatus(address borrower) view returns (uint8)",
]);

const priceFeedAbi = parseAbi(["function fetchPrice() view returns (uint256)"]);

const erc20Abi = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

/** Lab TroveAccountV2 view surface (lab/src/TroveAccountV2.sol). */
const troveAccountV2Abi = parseAbi([
  "function owner() view returns (address)",
  "function floorICR() view returns (uint256)",
  "function shieldICR() view returns (uint256)",
  "function targetICR() view returns (uint256)",
  "function bounty() view returns (uint256)",
  "function needed() view returns (uint256 icr, uint256 repayWanted, uint256 collWanted)",
]);

export type ShieldNeed = {
  icr: bigint;
  repayWanted: bigint;
  collWanted: bigint;
  /** v3 only: 0 none, 1 ICR, 2 rank, 3 TCR. Null on v2 (no reason code). */
  reason: number | null;
};

export type AccountSnapshot = {
  account: Address;
  owner: Address | null;
  /** 'v3' production TroveAccount, 'v2' lab TroveAccountV2, null = not an account contract. */
  version: "v3" | "v2" | null;
  /** BTC collateral (1e18). */
  coll: bigint;
  /** Entire MUSD debt: principal + interest (1e18). Pending redistribution is already folded in by Mezo. */
  debt: bigint;
  /** BTC/USD price (1e18). */
  price: bigint;
  /** Collateral ratio (1e18); 2**255 when debt is zero (matches app icr()). */
  icr: bigint;
  /** Mezo trove status: 0 none, 1 active, 2 closedByOwner, 3 closedByLiquidation, 4 closedByRedemption. */
  troveStatus: number | null;
  floorICR: bigint | null;
  shieldICR: bigint | null;
  targetICR: bigint | null;
  bounty: bigint | null;
  minDebtAhead: bigint | null;
  cooldownBlocks: number | null;
  needed: ShieldNeed | null;
  pendingYield: bigint | null;
  /**
   * Round 7 + round 8: true when the address IS an account contract
   * (owner() answered) but the policy is unreadable — either NO policy
   * source answered (the v3 policy() tuple and all four v2 getters failed),
   * or a version IS established but one of floor/shield/target/bounty is
   * null (round 8, J3 L3: v3 policy() fails but one v2 getter succeeds —
   * the policy partially answered, so "Not configured" / "No policy"
   * would be a lie about a policy that is merely half-read). Without this
   * flag the UI renders "Not configured" / "No policy" about an unknown
   * policy. A plain trove (owner() reverts) is not an error: it simply has
   * no policy, so policyError is false there. A v2 account's failing v3
   * slots are expected, not an error.
   */
  policyError: boolean;
  /**
   * Token balances. Every balance is `null` when its read itself fails — a
   * failed read must render as "unreadable" in the UI, never as 0 (a 0 MUSD
   * balance on a funded account would be a fake fact). BTC was already
   * nullable for exactly this reason; MUSD/sMUSD used to fall back to 0n
   * on the theory that `balanceOf` never reverts for a real address — but
   * the type then promised a number the read had not produced, and the UI
   * could never render "unreadable" for them (round 9, J2 LOW-7).
   */
  balances: { btc: bigint | null; musd: bigint | null; smusd: bigint | null };
};

type CallResult<T> = { status: "success"; result: T } | { status: "failure"; error?: unknown };

function ok<T>(r: CallResult<T> | undefined): T | undefined {
  return r?.status === "success" ? r.result : undefined;
}

export async function readAccount(
  client: ReadClient,
  account: Address,
  addresses: typeof testnetAddresses = testnetAddresses,
): Promise<AccountSnapshot> {
  const results = await client.multicall({
    contracts: [
      { address: addresses.troveManager, abi: troveManagerAbi, functionName: "getEntireDebtAndColl", args: [account] },
      { address: addresses.troveManager, abi: troveManagerAbi, functionName: "getTroveStatus", args: [account] },
      { address: addresses.priceFeed, abi: priceFeedAbi, functionName: "fetchPrice" },
      { address: addresses.musd, abi: erc20Abi, functionName: "balanceOf", args: [account] },
      { address: addresses.smusd, abi: erc20Abi, functionName: "balanceOf", args: [account] },
      { address: account, abi: troveAccountAbi, functionName: "owner" },
      { address: account, abi: troveAccountAbi, functionName: "policy" },
      { address: account, abi: troveAccountAbi, functionName: "status" },
      { address: account, abi: troveAccountAbi, functionName: "needed" },
      { address: account, abi: troveAccountAbi, functionName: "pendingYield" },
      { address: account, abi: troveAccountV2Abi, functionName: "floorICR" },
      { address: account, abi: troveAccountV2Abi, functionName: "shieldICR" },
      { address: account, abi: troveAccountV2Abi, functionName: "targetICR" },
      { address: account, abi: troveAccountV2Abi, functionName: "bounty" },
      { address: account, abi: troveAccountV2Abi, functionName: "needed" },
    ],
    allowFailure: true,
    multicallAddress: MULTICALL3_ADDRESS,
  });
  const [tm, statusR, priceR, musdR, smusdR, ownerR, policyR, statusAccR, neededV3R, yieldR, floorV2R, shieldV2R, targetV2R, bountyV2R, neededV2R] =
    results as unknown as [
      CallResult<readonly [bigint, bigint, bigint, bigint, bigint, bigint]>,
      CallResult<number>,
      CallResult<bigint>,
      CallResult<bigint>,
      CallResult<bigint>,
      CallResult<Address>,
      CallResult<readonly [bigint, bigint, bigint, bigint, bigint, number]>,
      CallResult<number>,
      CallResult<readonly [bigint, bigint, bigint, number]>,
      CallResult<bigint>,
      CallResult<bigint>,
      CallResult<bigint>,
      CallResult<bigint>,
      CallResult<bigint>,
      CallResult<readonly [bigint, bigint, bigint]>,
    ];

  const totals = ok(tm);
  // A failed core read is an RPC/batch failure, NOT an empty trove: viem's
  // multicall with allowFailure:true returns a failure slot for EVERY
  // contract when the transport itself fails, so without this throw a dead
  // RPC would render as coll 0 / debt 0 / ICR 2**255 ("999%", "No debt").
  // getEntireDebtAndColl never reverts for a real address (it returns zeros
  // for a non-existent trove), and neither does fetchPrice on the live feed,
  // so a failure here can only mean the read itself broke.
  if (totals === undefined) throw new Error("TroveManager read failed");
  const price = ok(priceR);
  if (price === undefined) throw new Error("PriceFeed read failed");
  const coll = totals[0];
  // getEntireDebtAndColl already folds pending redistribution into principal/interest; never add the pending slots again.
  const debt = totals[1] + totals[2];
  const icr = debt === 0n ? 2n ** 255n : (coll * price) / debt;

  const policy = ok(policyR);
  const floorV2 = ok(floorV2R);
  const shieldV2 = ok(shieldV2R);
  const targetV2 = ok(targetV2R);
  const bountyV2 = ok(bountyV2R);
  const version: AccountSnapshot["version"] = policy !== undefined ? "v3" : floorV2 !== undefined ? "v2" : null;
  const floorICR = policy?.[0] ?? floorV2 ?? null;
  const shieldICR = policy?.[1] ?? shieldV2 ?? null;
  const targetICR = policy?.[2] ?? targetV2 ?? null;
  const bounty = policy?.[3] ?? bountyV2 ?? null;
  // Round 7: owner() answering proves this is an account contract, so a
  // policy that answers from NO source is a failed read, not an absent
  // policy. (A v2 account's v3 slots failing is expected — version is v2
  // then — and a plain trove's owner() failing means no policy exists.)
  // Round 8 (J3 L3): a version established but ANY of the four policy
  // values null is the same unknown — the policy partially answered, so
  // the missing value is unreadable, not "not configured".
  const noPolicySource =
    policy === undefined &&
    floorV2 === undefined &&
    shieldV2 === undefined &&
    targetV2 === undefined &&
    bountyV2 === undefined;
  const partialPolicy =
    version !== null && (floorICR === null || shieldICR === null || targetICR === null || bounty === null);
  const policyError = ok(ownerR) !== undefined && (noPolicySource || partialPolicy);

  const neededV3 = ok(neededV3R);
  const neededV2 = ok(neededV2R);
  const needed: ShieldNeed | null = neededV3
    ? { icr: neededV3[0], repayWanted: neededV3[1], collWanted: neededV3[2], reason: neededV3[3] }
    : neededV2
      ? { icr: neededV2[0], repayWanted: neededV2[1], collWanted: neededV2[2], reason: null }
      : null;

  // The BTC balance is a separate eth_getBalance call after the multicall
  // batch: a failure here must NOT silently become 0n — null lets the UI
  // render "unreadable". (A dead transport throws first, in the core slots
  // above, so a null here means the transport died between the two calls.)
  const btc = await client.getBalance({ address: account }).catch(() => null);

  return {
    account,
    owner: ok(ownerR) ?? null,
    version,
    coll,
    debt,
    price,
    icr,
    troveStatus: ok(statusR) ?? null,
    floorICR,
    shieldICR,
    targetICR,
    bounty,
    minDebtAhead: policy?.[4] ?? null,
    cooldownBlocks: policy?.[5] ?? null,
    needed,
    pendingYield: ok(yieldR) ?? null,
    policyError,
    balances: { btc, musd: ok(musdR) ?? null, smusd: ok(smusdR) ?? null },
  };
}
