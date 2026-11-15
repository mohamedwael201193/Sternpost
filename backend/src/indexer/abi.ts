import { parseAbi } from "viem";

export const factoryEvents = parseAbi([
  "event GovernorCreated(address indexed borrower, address governor, uint256 floorICR, uint256 defendICR)",
  "event SpendWalletCreated(address indexed owner, address wallet, address agent, uint64 expiry)",
]);

export const governorEvents = parseAbi([
  "event PolicySet(uint256 floorICR, uint256 defendICR)",
  "event AppAuthorized(address indexed app, uint256 budget, uint256 perDrawMax, uint64 expiry, address payee)",
  "event AppRemoved(address indexed app)",
  "event Drawn(address indexed app, address indexed payee, uint256 amount, uint256 icrAfter, uint256 nonceUsed)",
  "event Healed(address indexed caller, uint256 amount, uint256 icrBefore, uint256 icrAfter)",
  "event Defended(address indexed caller, uint256 repaid, uint256 icrBefore, uint256 icrAfter)",
  "event Armed(uint256 amount, uint256 nonce, uint256 deadline)",
  "event Revoked(bool nonceBurned, uint256 nonceAfter)",
  "event Unfrozen()",
  "event Funded(uint256 amount)",
  "event BufferWithdrawn(uint256 amount)",
  "event ReserveParked(uint256 amount)",
  "event ReserveUnparked(uint256 amount)",
]);

export const walletEvents = parseAbi([
  "event AgentSet(address indexed agent, uint64 expiry)",
  "event AgentRevoked()",
  "event BudgetSet(address indexed token, uint256 amount)",
  "event Swept(address indexed token, uint256 amount)",
]);

export const allEvents = [...factoryEvents, ...governorEvents, ...walletEvents];

/** Wave 2 TroveAccountFactory (plan 3.2): the only source of account provenance. */
export const accountFactoryEvents = parseAbi([
  "event AccountCreated(address indexed owner, address indexed account, bytes32 salt, uint256 floorICR, uint256 shieldICR, uint256 targetICR)",
]);

/** Wave 2 TroveAccount events (plan 3.3). Same names as Classic events exist
 *  with different signatures (PolicySet, Drawn, Shielded); viem decodes by
 *  topic0 (the full signature hash), so both variants coexist in allEvents. */
export const accountEvents = parseAbi([
  "event TroveOpened(address indexed owner, uint256 coll, uint256 debt, uint256 icr)",
  "event PolicySet(uint256 floorICR, uint256 shieldICR, uint256 targetICR, uint256 bounty, uint256 minDebtAhead)",
  "event SessionOpened(address indexed agent, uint256 budget, uint256 perTx, uint256 dailyLimit, uint64 expiry, bool anyPayee, bool canSignX402)",
  "event SessionRevoked(address indexed agent)",
  "event AllSessionsRevoked(uint32 epoch)",
  "event Drawn(address indexed agent, address indexed payee, uint256 amount, uint256 fee, uint256 icrAfter)",
  "event Refilled(address indexed agent, uint256 amount)",
  "event OwnerBorrowed(address indexed to, uint256 amount, uint256 icrAfter)",
  "event Shielded(address indexed keeper, uint256 repaid, uint256 collAdded, uint256 icrBefore, uint256 icrAfter, uint8 reason, uint256 bountyPaid)",
  "event Parked(uint256 amount)",
  "event Unparked(uint256 amount)",
  "event YieldClaimed(uint256 amount)",
  "event CollateralClaimed(uint256 amount)",
  "event Checkpoint(uint8 status, uint256 icr, uint256 tcr, bool recoveryMode)",
  "event Closed(uint256 btcReturned, uint256 musdReturned)",
]);

/** Combined decode set: Classic + Account events (must come last). */
export const allAccountEvents = [...allEvents, ...accountFactoryEvents, ...accountEvents];
