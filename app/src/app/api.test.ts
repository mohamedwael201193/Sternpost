import { describe, it, expect, vi, afterEach } from 'vitest'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { verifyMessage } from 'viem'

vi.mock('../lib/chain', () => ({ API_URL: 'https://api.test' }))
const { setRequestStatus, requestStatusMessage } = await import('./api')

afterEach(() => vi.unstubAllGlobals())

describe('setRequestStatus', () => {
  it('signs the exact backend message and PATCHes status, expiry and signature', async () => {
    const acct = privateKeyToAccount(generatePrivateKey())
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const ok = await setRequestStatus(7, 'rejected', acct.address, (message) => acct.signMessage({ message }))
    expect(ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.test/v1/requests/7')
    expect(init.method).toBe('PATCH')
    const body = JSON.parse(init.body as string)
    expect(body.status).toBe('rejected')
    expect(body.expiry - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(300)
    expect(await verifyMessage({ address: acct.address, message: requestStatusMessage(7, 'rejected', acct.address, body.expiry), signature: body.signature })).toBe(true)
  })
  it('matches the backend message format', () => {
    expect(requestStatusMessage(3, 'approved', '0xABCdef0000000000000000000000000000000001', 99))
      .toBe('Sternpost: mark draw request #3 approved\nBorrower: 0xabcdef0000000000000000000000000000000001\nExpires: 99')
  })
  it('returns false on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
    expect(await setRequestStatus(1, 'approved', '0x0000000000000000000000000000000000000001', async () => '0x00')).toBe(false)
  })
})
