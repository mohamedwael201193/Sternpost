import { describe, expect, it, vi } from 'vitest'

/**
 * Round-4 L-c + L-d: the factories list in shared/deployments/testnet.json is
 * read at import time by lib/chain.ts. A float block used to be accepted
 * (`typeof 16803285.5 === 'number'`) and then BigInt(16803285.5) threw a
 * RangeError inside the ACCOUNT_FACTORIES IIFE — taking the whole app down at
 * import. A duplicated factory address used to silently drop the earlier
 * range (scannedTo is keyed by address). Both are fixed in accountFactory /
 * the ACCOUNT_FACTORIES IIFE; this file mocks the deployments JSON with a
 * float block AND a duplicate address and asserts the import survives.
 */
vi.mock('../../../shared/deployments/testnet.json', () => ({
  default: {
    sternpost: {
      SternpostFactory: { address: '0x39779A8678424CF78c841F9AfEa1EAFF3Cf7F6d8', block: 16794393 },
      governor: '0x1bF45cFE654a397F4FF3B33bC1b157c88Ee71F38',
      spendWallet: '0x4F878203175B1BB6C63Ec02CEEBE1af4A7c9Ee4a',
    },
    accounts: {
      implementation: { address: '0x02Dda72b052fe7b28214C09743d6Ed0DE813F0B8', block: 16804465 },
      factory: { address: '0x46442898c022e1fAa2BD05a23600C1Ec89DcA200', block: 16804466 },
      radar: { address: '0xfe74C8e67f0499e4426DD71D6bdf48A9A557DC6C' },
      batcher: { address: '0x0000000000000000000000000000000000000001' },
      factories: [
        // L-c: a float block — must be warned about and skipped, never BigInt()'d.
        { address: '0xfb4EFE7953AF18DBCaa1124DA721cD3FB8fD85C3', block: 16803285.5 },
        { address: '0x46442898c022e1fAa2BD05a23600C1Ec89DcA200', block: 16804466 },
        // L-d: same address again with an EARLIER block — the earliest wins.
        { address: '0x46442898c022e1fAa2BD05a23600C1Ec89DcA200', block: 16803285 },
      ],
    },
  },
}))

describe('L-c + L-d — float block skipped, duplicated address keeps the earliest block', () => {
  it('imports without throwing, skips the float entry, and dedupes to the earliest block', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      // NOTE: the module imports once per test file (vitest caches it), so
      // both warns are asserted here, on the single import.
      const chain = await import('./chain')
      expect(chain.ACCOUNT_FACTORIES).toHaveLength(1)
      expect(chain.ACCOUNT_FACTORIES[0].address.toLowerCase()).toBe(
        '0x46442898c022e1faa2bd05a23600c1ec89dca200',
      )
      expect(chain.ACCOUNT_FACTORIES[0].deployBlock).toBe(16803285n)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('non-integer'))
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('duplicate factory address'))
    } finally {
      warnSpy.mockRestore()
    }
  })
})
