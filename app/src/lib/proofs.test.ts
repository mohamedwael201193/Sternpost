import { describe, expect, it } from 'vitest'
import { PROOFS, txUrl } from './proofs'

describe('proof ledger', () => {
  it('only lists full 32-byte tx hashes', () => {
    for (const p of PROOFS) expect(p.hash).toMatch(/^0x[0-9a-f]{64}$/)
  })
  it('has unique ids and hashes', () => {
    expect(new Set(PROOFS.map((p) => p.hash)).size).toBe(PROOFS.length)
    expect(new Set(PROOFS.map((p) => p.id)).size).toBe(PROOFS.length)
  })
  it('links to the Mezo testnet explorer', () => {
    expect(txUrl(PROOFS[0].hash)).toBe(`https://explorer.test.mezo.org/tx/${PROOFS[0].hash}`)
  })
})
