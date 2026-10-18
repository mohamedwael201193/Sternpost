import { describe, expect, it } from 'vitest'
import { encodeType } from './test-eip712'
import { addCollTypes, drawMessages, burnMessage, repayTypes, withdrawTypes, DRAW_WINDOW_S } from './sig'

const B = '0x00000000000000000000000000000000000000b0' as const
const G = '0x00000000000000000000000000000000000000c0' as const

describe('mezo typed data', () => {
  it('matches the Solidity type strings Mezo hashes', () => {
    expect(encodeType('WithdrawMUSD', withdrawTypes.WithdrawMUSD)).toBe(
      'WithdrawMUSD(uint256 amount,address borrower,address recipient,uint256 nonce,uint256 deadline)')
    expect(encodeType('RepayMUSD', repayTypes.RepayMUSD)).toBe(
      'RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline)')
    expect(encodeType('AddColl', addCollTypes.AddColl)).toBe(
      'AddColl(uint256 assetAmount,address borrower,uint256 nonce,uint256 deadline)')
  })
  it('always sends the withdrawal to the Governor and arms heal at nonce+1', () => {
    const m = drawMessages({ amount: 5n, borrower: B, governor: G, nonce: 7n, now: 1000n })
    expect(m.withdraw.recipient).toBe(G)
    expect(m.withdraw.nonce).toBe(7n)
    expect(m.heal.nonce).toBe(8n)
    expect(m.withdraw.deadline - 1000n).toBeLessThanOrEqual(120n)
    expect(DRAW_WINDOW_S).toBeLessThan(120n)
  })
  it('burns the current nonce with a 1-wei AddColl', () => {
    expect(burnMessage({ borrower: B, nonce: 3n, now: 0n })).toMatchObject({ assetAmount: 1n, nonce: 3n })
  })
})
