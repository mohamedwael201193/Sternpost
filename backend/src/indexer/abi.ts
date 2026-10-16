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
