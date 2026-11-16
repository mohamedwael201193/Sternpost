import { parseAbi, type Address, type Chain, type Hex, type PublicClient, type WalletClient } from "viem";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount, type LocalAccount } from "viem/accounts";
import { troveAccountAbi, troveAccountFactoryAbi } from "./abi.js";
import { mezoTestnet, MULTICALL3_ADDRESS, testnetAddresses } from "./chain.js";
import type { ReadClient } from "./read-client.js";
import { signIntent, type DrawIntent } from "./intent.js";
import { payByBorrow, type PayResult } from "./pay.js";
import { reasonFromCode, type ReasonCode } from "./reasons.js";

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

// ============================================================================
// AccountClient — plan §5.2 (@sternpost/sdk additions, task 2.2)
// ============================================================================

export type Network = "testnet" | "mainnet";

/** TroveAccount Policy tuple (factory + account `policy()`). Units: ICRs 1e18, MUSD 1e18, cooldown in blocks. */
export type Policy = {
  floorICR: bigint;
  shieldICR: bigint;
  targetICR: bigint;
  bounty: bigint;
  minDebtAhead: bigint;
  cooldownBlocks: number;
};

/** A live agent session on a TroveAccount (sessions(agent) + derived remaining). */
export type Session = {
  agent: Address;
  budget: bigint;
  spent: bigint;
  /** budget - spent. */
  remaining: bigint;
  perTx: bigint;
  dailyLimit: bigint;
  daySpent: bigint;
  expiry: bigint;
  dayStart: bigint;
  epoch: number;
  gen: number;
  anyPayee: boolean;
  canSignX402: boolean;
  active: boolean;
};

export type PreviewDrawResult = {
  ok: boolean;
  reason: ReasonCode;
  reasonCode: number;
  icrAfter: bigint;
  fee: bigint;
};

/** readAccount snapshot plus system health (plan §5.2 read()). */
export type AccountHealth = AccountSnapshot & { tcr: bigint; recoveryMode: boolean };

const troveManagerHealthAbi = parseAbi([
  "function getTCR(uint256 price) view returns (uint256)",
  "function checkRecoveryMode(uint256 price) view returns (bool)",
]);

const hintHelpersAbi = parseAbi([
  "function computeNominalCR(uint256 coll, uint256 debt) view returns (uint256)",
  "function getApproxHint(uint256 nicr, uint256 numTrials, uint256 seed) view returns (address hintAddress, uint256 diff, uint256 latestRandomSeed)",
]);

const sortedTrovesHintsAbi = parseAbi([
  "function findInsertPosition(uint256 nicr, address prevId, address nextId) view returns (address, address)",
]);

const factoryViewAbi = parseAbi([
  "function predict(address owner, bytes32 salt, (uint64 floorICR, uint64 shieldICR, uint64 targetICR, uint128 bounty, uint128 minDebtAhead, uint32 cooldownBlocks) p) view returns (address)",
  "function isAccount(address) view returns (bool)",
]);

const erc20BalanceAbi = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

/** Mezo under-estimates gas (and enforces the EIP-7623 calldata floor): pad every estimate. */
const GAS_PAD_NUM = 3n; // est * 3/2 + 50k
const GAS_PAD_ADD = 50_000n;
/** Minimum gas per method (Mezo trove ops are heavy; block limit 10M). */
const MIN_GAS = { open: 6_000_000n, draw: 1_500_000n, shield: 2_000_000n, create: 1_000_000n, other: 500_000n } as const;

type ViemPublic = PublicClient;
type ViemWallet = WalletClient;

async function writePadded(
  publicClient: ViemPublic,
  wallet: ViemWallet,
  req: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[]; value?: bigint },
  minGas: bigint,
): Promise<Hex> {
  const est = await publicClient.estimateContractGas({ ...req, account: wallet.account } as never);
  const gas = [est + est / 2n + GAS_PAD_ADD, minGas].reduce((a, b) => (a > b ? a : b));
  return wallet.writeContract({ ...req, gas } as never);
}

/**
 * Predict a TroveAccount address (CREATE2) for (owner, salt, policy).
 * The factory binds the POLICY into the salt, so the policy is a required
 * input — the plan's shorthand `predictAccount(owner, salt, network)` omits
 * it, but an address predicted without the policy would be a different
 * account. Mainnet has no Sternpost factory yet (shared/deployments/mainnet.json:
 * all null) and refuses loudly.
 */
export async function predictAccount(
  publicClient: ViemPublic,
  owner: Address,
  salt: Hex,
  policy: Policy,
  network: Network = "testnet",
): Promise<Address> {
  if (network !== "testnet") throw new Error("predictAccount: no Sternpost factory on mainnet yet (pilot not started)");
  return publicClient.readContract({
    address: testnetAddresses.accountFactory,
    abi: factoryViewAbi,
    functionName: "predict",
    args: [owner, salt, policy],
  }) as Promise<Address>;
}

/**
 * Neighbour hints for opening a trove at (collateral, debt): HintHelpers
 * getApproxHint + SortedTroves findInsertPosition (LAB_METHODS §3, proven
 * on testnet). `rpc` is a URL or a viem public client. numTrials defaults
 * to 250 with seed 42 (the lab-proven call); pass numTrials ~ 15*sqrt(troveCount)
 * for a production hint. Zero debt returns (0, 0) — there is no position to place.
 */
export async function computeHints(
  collateral: bigint,
  debt: bigint,
  rpc: string | ViemPublic,
  opts: { numTrials?: number; seed?: number } = {},
): Promise<{ up: Address; lo: Address }> {
  if (debt === 0n) return { up: "0x0000000000000000000000000000000000000000", lo: "0x0000000000000000000000000000000000000000" };
  const publicClient =
    typeof rpc === "string"
      ? createPublicClient({ chain: mezoTestnet, transport: http(rpc) })
      : rpc;
  const nicr = (await publicClient.readContract({
    address: testnetAddresses.hintHelpers,
    abi: hintHelpersAbi,
    functionName: "computeNominalCR",
    args: [collateral, debt],
  })) as bigint;
  const [hint] = (await publicClient.readContract({
    address: testnetAddresses.hintHelpers,
    abi: hintHelpersAbi,
    functionName: "getApproxHint",
    args: [nicr, BigInt(opts.numTrials ?? 250), BigInt(opts.seed ?? 42)],
  })) as readonly [Address, bigint, bigint];
  const [up, lo] = (await publicClient.readContract({
    address: testnetAddresses.sortedTroves,
    abi: sortedTrovesHintsAbi,
    functionName: "findInsertPosition",
    args: [nicr, hint, hint],
  })) as readonly [Address, Address];
  return { up, lo };
}

/**
 * BTC collateral (1e18) needed to open `debt` MUSD at `icr` (plain number,
 * e.g. 2.5) when the price is `price` (1e18 USD/BTC). The composite principal
 * is debt + 0.1% borrowing fee + 200 MUSD gas compensation (the lab's
 * 1800 MUSD open composites to 2001.8). NOTE: the plan's worked example
 * (1800 @250% @ $64,160 -> 0.07794 BTC) omits the 1.8 MUSD fee and computes
 * (1800+200)*2.5/64160; this function implements the stated formula and
 * returns 0.07800 BTC for those inputs. The 0.00006 BTC difference is the fee.
 */
export function collateralForICR(icr: number, debt: bigint, price: bigint): bigint {
  const composite = debt + debt / 1000n + 200n * 10n ** 18n;
  const icrScaled = BigInt(Math.round(icr * 1_000_000));
  // coll(BTC) = composite(MUSD) * icr / price(USD/BTC); the 1e18 factor
  // converts whole BTC to wei (composite and price are both 1e18-scaled,
  // so their ratio is unitless).
  return (composite * icrScaled * 10n ** 18n) / (price * 1_000_000n);
}

export type AccountClientConfig = {
  network: Network;
  account: Address;
  rpc?: string;
  /** Agent session key (hex). Needed for draw / signIntent / payByBorrow. */
  agentKey?: Hex;
  /** Owner key (hex). Needed for open / setSession / revoke / close / approveToken / setPayee. */
  ownerKey?: Hex;
  /** CREATE2 salt used when open() must create the account first. Default zero salt. */
  salt?: Hex;
  /** Policy used when open() must create the account first. Default: floor 2.5, shield 1.6, target 2.0, bounty 1 MUSD, minDebtAhead 0, cooldown 20. */
  policy?: Policy;
  /** Injectable clients (tests). */
  publicClient?: ViemPublic;
  /** Injectable wallet clients (tests; prefer agentKey/ownerKey in real use). */
  agentWallet?: ViemWallet;
  ownerWallet?: ViemWallet;
};

/** Default demo policy: floor 250%, shield 160%, target 200%, bounty 1 MUSD, no rank trigger, 20-block cooldown. */
export const DEFAULT_POLICY: Policy = {
  floorICR: 2_500_000_000_000_000_000n,
  shieldICR: 1_600_000_000_000_000_000n,
  targetICR: 2_000_000_000_000_000_000n,
  bounty: 1_000_000_000_000_000_000n,
  minDebtAhead: 0n,
  cooldownBlocks: 20,
};

export type AccountClient = {
  address: Address;
  network: Network;
  /** Full health snapshot: account + trove + policy + balances + system TCR / Recovery Mode. */
  read(): Promise<AccountHealth>;
  session(agent: Address): Promise<Session>;
  previewDraw(agent: Address, payee: Address, amount: bigint): Promise<PreviewDrawResult>;
  /** Owner: open the trove (creates the account first if it does not exist yet). */
  open(p: { debt: bigint; collateral: bigint; minDebtAhead?: bigint }): Promise<Hex>;
  /** Owner: deploy the clone for (owner, salt, policy) without opening. */
  createAccount(owner: Address, salt: Hex, policy: Policy): Promise<{ account: Address; hash: Hex }>;
  /** Owner: create + open in one tx (value = collateral). */
  createAndOpen(p: { salt: Hex; policy: Policy; debt: bigint; collateral: bigint; minDebtAhead?: bigint }): Promise<{ account: Address; hash: Hex }>;
  /** Owner: grant/replace an agent session. */
  setSession(agent: Address, s: { budget: bigint; perTx: bigint; dailyLimit: bigint; expiry: bigint; anyPayee?: boolean; canSignX402?: boolean }): Promise<Hex>;
  /** Owner: allow (or disallow) one payee for an agent. */
  setPayee(agent: Address, payee: Address, ok: boolean): Promise<Hex>;
  /** Owner: approve a spender (e.g. Permit2) to pull MUSD from the account. */
  approveToken(spender: Address, amount: bigint): Promise<Hex>;
  /** Owner: move the account's MUSD balance to the owner. */
  sweepMusd(amount: bigint): Promise<Hex>;
  /** Owner: move the account's native BTC balance to the owner. */
  sweepBtc(amount: bigint): Promise<Hex>;
  revokeSession(agent: Address): Promise<Hex>;
  revokeAll(): Promise<Hex>;
  closeAccount(): Promise<Hex>;
  /** Agent: borrow `amount` MUSD to `payee` (payee == account is the x402 refill). */
  draw(payee: Address, amount: bigint): Promise<Hex>;
  /** Agent: sign a DrawIntent (EIP-712) for later submission via drawBySig/Batcher. */
  signIntent(payee: Address, amount: bigint, opts?: { deadlineSec?: number }): Promise<DrawIntent>;
  /** Agent: pay an x402 resource by borrowing just in time. */
  payByBorrow(url: string, opts?: { maxAmount?: bigint; refillTarget?: bigint }): Promise<PayResult>;
  needed(): Promise<{ icr: bigint; repayWanted: bigint; collWanted: bigint; reason: number }>;
  /** Permissionless keeper shield (any key pays gas; the bounty goes to the caller). */
  shield(): Promise<Hex>;
  claimCollateral(): Promise<Hex>;
};

export function createAccountClient(cfg: AccountClientConfig): AccountClient {
  if (cfg.network !== "testnet") {
    throw new Error(
      "createAccountClient: no Sternpost deployment on mainnet yet (shared/deployments/mainnet.json: productionContracts all null — the pilot has not started). Refusing instead of pointing at a testnet address.",
    );
  }
  const chain: Chain = mezoTestnet;
  const rpc = cfg.rpc ?? "https://rpc.test.mezo.org";
  const publicClient: ViemPublic =
    cfg.publicClient ?? createPublicClient({ chain, transport: http(rpc) });
  const agentAccount: LocalAccount | undefined = cfg.agentKey ? privateKeyToAccount(cfg.agentKey) : undefined;
  const ownerAccount: LocalAccount | undefined = cfg.ownerKey ? privateKeyToAccount(cfg.ownerKey) : undefined;
  const agentWallet: ViemWallet | undefined =
    cfg.agentWallet ??
    (agentAccount ? createWalletClient({ chain, transport: http(rpc), account: agentAccount }) : undefined);
  const ownerWallet: ViemWallet | undefined =
    cfg.ownerWallet ??
    (ownerAccount ? createWalletClient({ chain, transport: http(rpc), account: ownerAccount }) : undefined);
  const account = cfg.account;
  const salt: Hex = cfg.salt ?? ("0x0000000000000000000000000000000000000000000000000000000000000000" as Hex);
  const policy: Policy = cfg.policy ?? DEFAULT_POLICY;

  // The signer for agent/owner calls: the key when given, else the injected
  // wallet's account (tests inject a wallet built from a real test key).
  const agentSigner: LocalAccount | undefined =
    agentAccount ?? (agentWallet?.account as LocalAccount | undefined);
  const ownerSigner: LocalAccount | undefined =
    ownerAccount ?? (ownerWallet?.account as LocalAccount | undefined);

  const needAgent = () => {
    if (!agentWallet || !agentSigner) throw new Error("this call needs an agent key (cfg.agentKey)");
    return { wallet: agentWallet, account: agentSigner };
  };
  const needOwner = () => {
    if (!ownerWallet || !ownerSigner) throw new Error("this call needs an owner key (cfg.ownerKey)");
    return { wallet: ownerWallet, account: ownerSigner };
  };
  const anyWallet = () => {
    if (agentWallet) return agentWallet;
    if (ownerWallet) return ownerWallet;
    throw new Error("shield/claimCollateral need a key to pay gas (cfg.agentKey or cfg.ownerKey)");
  };
  const readClient: ReadClient = {
    multicall: (a) => publicClient.multicall(a as never) as Promise<readonly unknown[]>,
    getBalance: (a) => publicClient.getBalance(a),
  };
  const musdBalance = () =>
    publicClient.readContract({
      address: testnetAddresses.musd,
      abi: erc20BalanceAbi,
      functionName: "balanceOf",
      args: [account],
    }) as Promise<bigint>;
  const isAccount = () =>
    publicClient.readContract({
      address: testnetAddresses.accountFactory,
      abi: factoryViewAbi,
      functionName: "isAccount",
      args: [account],
    }) as Promise<boolean>;

  const previewDraw = async (agent: Address, payee: Address, amount: bigint): Promise<PreviewDrawResult> => {
    const [ok, reasonCode, icrAfter, fee] = (await publicClient.readContract({
      address: account,
      abi: troveAccountAbi,
      functionName: "previewDraw",
      args: [agent, payee, amount],
    })) as readonly [boolean, number, bigint, bigint];
    return { ok, reason: reasonFromCode(reasonCode), reasonCode, icrAfter, fee };
  };

  const draw = async (payee: Address, amount: bigint): Promise<Hex> => {
    const { wallet } = needAgent();
    return writePadded(
      publicClient,
      wallet,
      { address: account, abi: troveAccountAbi, functionName: "draw", args: [payee, amount] },
      MIN_GAS.draw,
    );
  };

  return {
    address: account,
    network: cfg.network,

    async read(): Promise<AccountHealth> {
      const snap = await readAccount(readClient, account);
      const [tcr, recoveryMode] = await Promise.all([
        publicClient.readContract({
          address: testnetAddresses.troveManager,
          abi: troveManagerHealthAbi,
          functionName: "getTCR",
          args: [snap.price],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: testnetAddresses.troveManager,
          abi: troveManagerHealthAbi,
          functionName: "checkRecoveryMode",
          args: [snap.price],
        }) as Promise<boolean>,
      ]);
      return { ...snap, tcr, recoveryMode };
    },

    async session(agent: Address): Promise<Session> {
      const s = (await publicClient.readContract({
        address: account,
        abi: troveAccountAbi,
        functionName: "sessions",
        args: [agent],
      })) as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, number, number, boolean, boolean, boolean];
      const [budget, spent, perTx, dailyLimit, daySpent, expiry, dayStart, epoch, gen, anyPayee, canSignX402, active] = s;
      return { agent, budget, spent, remaining: budget - spent, perTx, dailyLimit, daySpent, expiry, dayStart, epoch, gen, anyPayee, canSignX402, active };
    },

    previewDraw,

    async open(p: { debt: bigint; collateral: bigint; minDebtAhead?: bigint }): Promise<Hex> {
      const { wallet, account: owner } = needOwner();
      if (!(await isAccount())) {
        await writePadded(
          publicClient,
          wallet,
          {
            address: testnetAddresses.accountFactory,
            abi: troveAccountFactoryAbi,
            functionName: "createAccount",
            args: [owner.address, salt, policy],
          },
          MIN_GAS.create,
        );
      }
      const composite = p.debt + p.debt / 1000n + 200n * 10n ** 18n;
      const { up, lo } = await computeHints(p.collateral, composite, publicClient);
      return writePadded(
        publicClient,
        wallet,
        {
          address: account,
          abi: troveAccountAbi,
          functionName: "open",
          args: [p.debt, up, lo, p.minDebtAhead ?? 0n],
          value: p.collateral,
        },
        MIN_GAS.open,
      );
    },

    async createAccount(owner: Address, saltArg: Hex, policyArg: Policy): Promise<{ account: Address; hash: Hex }> {
      const { wallet } = needOwner();
      const predicted = await predictAccount(publicClient, owner, saltArg, policyArg, cfg.network);
      const hash = await writePadded(
        publicClient,
        wallet,
        {
          address: testnetAddresses.accountFactory,
          abi: troveAccountFactoryAbi,
          functionName: "createAccount",
          args: [owner, saltArg, policyArg],
        },
        MIN_GAS.create,
      );
      return { account: predicted, hash };
    },

    async createAndOpen(p: { salt: Hex; policy: Policy; debt: bigint; collateral: bigint; minDebtAhead?: bigint }): Promise<{ account: Address; hash: Hex }> {
      const { wallet, account: owner } = needOwner();
      const predicted = await predictAccount(publicClient, owner.address, p.salt, p.policy, cfg.network);
      const composite = p.debt + p.debt / 1000n + 200n * 10n ** 18n;
      const { up, lo } = await computeHints(p.collateral, composite, publicClient);
      const hash = await writePadded(
        publicClient,
        wallet,
        {
          address: testnetAddresses.accountFactory,
          abi: troveAccountFactoryAbi,
          functionName: "createAndOpen",
          args: [p.salt, p.policy, p.debt, up, lo, p.minDebtAhead ?? 0n],
          value: p.collateral,
        },
        MIN_GAS.open,
      );
      return { account: predicted, hash };
    },

    async setSession(
      agent: Address,
      s: { budget: bigint; perTx: bigint; dailyLimit: bigint; expiry: bigint; anyPayee?: boolean; canSignX402?: boolean },
    ): Promise<Hex> {
      const { wallet } = needOwner();
      return writePadded(
        publicClient,
        wallet,
        {
          address: account,
          abi: troveAccountAbi,
          functionName: "setSession",
          args: [agent, s.budget, s.perTx, s.dailyLimit, s.expiry, s.anyPayee ?? false, s.canSignX402 ?? false],
        },
        MIN_GAS.other,
      );
    },

    async setPayee(agent: Address, payee: Address, ok: boolean): Promise<Hex> {
      const { wallet } = needOwner();
      return writePadded(
        publicClient,
        wallet,
        { address: account, abi: troveAccountAbi, functionName: "setPayee", args: [agent, payee, ok] },
        MIN_GAS.other,
      );
    },

    async approveToken(spender: Address, amount: bigint): Promise<Hex> {
      const { wallet } = needOwner();
      return writePadded(
        publicClient,
        wallet,
        { address: account, abi: troveAccountAbi, functionName: "approveToken", args: [spender, amount] },
        MIN_GAS.other,
      );
    },

    async sweepMusd(amount: bigint): Promise<Hex> {
      const { wallet } = needOwner();
      return writePadded(
        publicClient,
        wallet,
        { address: account, abi: troveAccountAbi, functionName: "sweepMusd", args: [amount] },
        MIN_GAS.other,
      );
    },

    async sweepBtc(amount: bigint): Promise<Hex> {
      const { wallet } = needOwner();
      return writePadded(
        publicClient,
        wallet,
        { address: account, abi: troveAccountAbi, functionName: "sweepBtc", args: [amount] },
        MIN_GAS.other,
      );
    },

    async revokeSession(agent: Address): Promise<Hex> {
      const { wallet } = needOwner();
      return writePadded(
        publicClient,
        wallet,
        { address: account, abi: troveAccountAbi, functionName: "revokeSession", args: [agent] },
        MIN_GAS.other,
      );
    },

    async revokeAll(): Promise<Hex> {
      const { wallet } = needOwner();
      return writePadded(
        publicClient,
        wallet,
        { address: account, abi: troveAccountAbi, functionName: "revokeAll", args: [] },
        MIN_GAS.other,
      );
    },

    async closeAccount(): Promise<Hex> {
      const { wallet } = needOwner();
      return writePadded(
        publicClient,
        wallet,
        { address: account, abi: troveAccountAbi, functionName: "closeAccount", args: [] },
        MIN_GAS.open,
      );
    },

    draw,

    async signIntent(payee: Address, amount: bigint, opts?: { deadlineSec?: number }): Promise<DrawIntent> {
      const { account: agent } = needAgent();
      return signIntent({
        chainId: 31611,
        account,
        agent: agent as never,
        payee,
        amount,
        readNonce: () =>
          publicClient.readContract({
            address: account,
            abi: troveAccountAbi,
            functionName: "intentNonce",
            args: [agent.address],
          }) as Promise<bigint>,
        deadlineSec: opts?.deadlineSec,
      });
    },

    async payByBorrow(url: string, opts?: { maxAmount?: bigint; refillTarget?: bigint }): Promise<PayResult> {
      const { account: agent } = needAgent();
      return payByBorrow(
        {
          chainId: 31611,
          network: cfg.network,
          account,
          agent: agent as never,
          publicClient: publicClient as never,
          musdBalance,
          previewDraw,
          draw,
          waitForReceipt: (hash: Hex) => publicClient.waitForTransactionReceipt({ hash }) as Promise<{ status: "success" | "reverted" }>,
        },
        url,
        opts,
      );
    },

    async needed(): Promise<{ icr: bigint; repayWanted: bigint; collWanted: bigint; reason: number }> {
      const [icr, repayWanted, collWanted, reason] = (await publicClient.readContract({
        address: account,
        abi: troveAccountAbi,
        functionName: "needed",
      })) as readonly [bigint, bigint, bigint, number];
      return { icr, repayWanted, collWanted, reason };
    },

    async shield(): Promise<Hex> {
      const wallet = anyWallet();
      return writePadded(
        publicClient,
        wallet,
        { address: account, abi: troveAccountAbi, functionName: "shield", args: [] },
        MIN_GAS.shield,
      );
    },

    async claimCollateral(): Promise<Hex> {
      const wallet = anyWallet();
      return writePadded(
        publicClient,
        wallet,
        { address: account, abi: troveAccountAbi, functionName: "claimCollateral", args: [] },
        MIN_GAS.other,
      );
    },
  };
}
