import { parseAbi } from 'viem'

export const troveManagerAbi = parseAbi([
  'function getEntireDebtAndColl(address) view returns (uint256 coll, uint256 principal, uint256 interest, uint256 pendingColl, uint256 pendingPrincipal, uint256 pendingInterest)',
  'function getCurrentICR(address,uint256) view returns (uint256)',
])
export const priceFeedAbi = parseAbi(['function fetchPrice() view returns (uint256)'])
export const borrowerOpsAbi = parseAbi(['function getBorrowingFee(uint256) view returns (uint256)'])
export const erc20Abi = parseAbi(['function balanceOf(address) view returns (uint256)', 'event Transfer(address indexed from, address indexed to, uint256 value)'])
export const signaturesAbi = parseAbi(['function getNonce(address) view returns (uint256)'])

export const factoryAbi = parseAbi([
  'function governorOf(address) view returns (address)',
  'function createGovernor(uint256 floorICR, uint256 defendICR) returns (address)',
  'function walletsOf(address) view returns (address[])',
  'event GovernorCreated(address indexed borrower, address governor, uint256 floorICR, uint256 defendICR)',
])

export const governorAbi = parseAbi([
  'function borrower() view returns (address)',
  'function floorICR() view returns (uint256)',
  'function defendICR() view returns (uint256)',
  'function frozen() view returns (bool)',
  'function buffer() view returns (uint256)',
  'function icr() view returns (uint256)',
  'function projectedICR(uint256) view returns (uint256)',
  'function previewDraw(address app, uint256 amount, address payee) view returns (bool ok, string reason, uint256 icrAfter)',
  'function remainingBudget(address) view returns (uint256)',
  'function appPolicy(address) view returns (uint128 budget, uint128 spent, uint128 perDrawMax, uint64 expiry, address payee)',
  'function setPolicy(uint256 floorICR, uint256 defendICR)',
  'function authorizeApp(address app, uint128 budget, uint128 perDrawMax, uint64 expiry, address payee)',
  'function removeApp(address app)',
  'function revoke(uint256 burnDeadline, bytes burnSig) payable',
  'function unfreeze()',
  'function rearm(uint256 amount, uint256 deadline, bytes repaySig)',
  'function standby() view returns (uint256 amount, uint256 deadline, uint256 nonce, bool live)',
  'function draw(uint256 amount, address payee, uint256 withdrawDeadline, bytes withdrawSig, uint256 healDeadline, bytes healSig)',
  'event AppAuthorized(address indexed app, uint256 budget, uint256 perDrawMax, uint64 expiry, address payee)',
  'event AppRemoved(address indexed app)',
  'event Drawn(address indexed app, address indexed payee, uint256 amount, uint256 icrAfter, uint256 nonceUsed)',
  'event Revoked(bool nonceBurned, uint256 nonceAfter)',
  'event Unfrozen()',
  'event Armed(uint256 amount, uint256 nonce, uint256 deadline)',
  'event PolicySet(uint256 floorICR, uint256 defendICR)',
  'event Healed(address indexed caller, uint256 amount, uint256 icrBefore, uint256 icrAfter)',
])

import governorJson from '../../../shared/abis/SternpostGovernor.json'
/** Governor ABI plus its custom errors, so viem can decode reverts from simulate/eth_call. */
export const governorErrorsAbi = (governorJson as readonly any[]).filter((x) => x.type === 'error')
export const governorFullAbi = [...governorAbi, ...governorErrorsAbi] as unknown as typeof governorAbi

export const routerAbi = parseAbi([
  'struct Leg { uint256 amount; uint256 withdrawDeadline; bytes withdrawSig; uint256 healDeadline; bytes healSig; uint256 collAmount; uint256 addCollDeadline; bytes addCollSig; }',
  'function drawAndSave(address governor, uint256 amount, uint256 withdrawDeadline, bytes withdrawSig, uint256 healDeadline, bytes healSig) returns (uint256)',
  'function drawAndSwap(address governor, uint256 amount, uint256 minBtcOut, uint256 withdrawDeadline, bytes withdrawSig, uint256 healDeadline, bytes healSig) returns (uint256)',
  'function loop(address governor, Leg[] legs) returns (uint256)',
  'function setRoutes(uint8 mask)',
  'function quoteSwap(uint256 musdIn) view returns (uint256)',
  'function routesOf(address) view returns (uint8)',
])
