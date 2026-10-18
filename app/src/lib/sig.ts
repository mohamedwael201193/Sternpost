import type { Address } from 'viem'
import { MEZO, mezoTestnet } from './chain'

/** EIP-712 domain of Mezo's BorrowerOperationsSignatures (the contract every Sternpost signature targets). */
export const mezoDomain = (chainId: number = mezoTestnet.id, verifyingContract: Address = MEZO.signatures) =>
  ({ name: 'BorrowerOperationsSignatures', version: '1', chainId, verifyingContract }) as const

export const withdrawTypes = {
  WithdrawMUSD: [
    { name: 'amount', type: 'uint256' },
    { name: 'borrower', type: 'address' },
    { name: 'recipient', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

export const repayTypes = {
  RepayMUSD: [
    { name: 'amount', type: 'uint256' },
    { name: 'borrower', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

export const addCollTypes = {
  AddColl: [
    { name: 'assetAmount', type: 'uint256' },
    { name: 'borrower', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

/** Governor rejects withdraw windows longer than MAX_WINDOW (120 s). Keep a margin. */
export const DRAW_WINDOW_S = 110n
export const deadlineIn = (s: bigint, now = BigInt(Math.floor(Date.now() / 1000))) => now + s

/**
 * A draw needs two signatures from the borrower: the withdraw at nonce n (recipient = Governor,
 * never anything else) and a standby RepayMUSD at nonce n+1 that heal()/defend() can use.
 */
export function drawMessages(p: { amount: bigint; borrower: Address; governor: Address; nonce: bigint; now?: bigint }) {
  const deadline = deadlineIn(DRAW_WINDOW_S, p.now)
  return {
    withdraw: { amount: p.amount, borrower: p.borrower, recipient: p.governor, nonce: p.nonce, deadline },
    heal: { amount: p.amount, borrower: p.borrower, nonce: p.nonce + 1n, deadline: deadlineIn(3600n * 24n, p.now) },
  }
}

/** Burning the nonce = signing a 1-wei AddColl at the current nonce; Governor.revoke submits it. */
export function burnMessage(p: { borrower: Address; nonce: bigint; now?: bigint }) {
  return { assetAmount: 1n, borrower: p.borrower, nonce: p.nonce, deadline: deadlineIn(DRAW_WINDOW_S, p.now) }
}
