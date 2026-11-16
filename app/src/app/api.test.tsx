import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { verifyMessage } from 'viem'
import { judgeDraw, REASONS, troveTotals } from '../lib/icr'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../lib/chain', () => ({ API_URL: 'https://api.test' }))
const { setRequestStatus, requestStatusMessage, useApiList } = await import('./api')

afterEach(() => vi.unstubAllGlobals())

describe('troveTotals (C3: getEntireDebtAndColl already folds pending)', () => {
  it('uses only the first three returns, never the pending slots again', () => {
    // coll 100, principal 1000, interest 50, pendingColl 5, pendingPrincipal 100, pendingInterest 10
    const t = [100n, 1000n, 50n, 5n, 100n, 10n] as const
    expect(troveTotals(t)).toEqual({ coll: 100n, debt: 1050n })
  })
  it('matches the folded values with non-zero pending', () => {
    const t = [11n * 10n ** 16n, 2100n * 10n ** 18n, 5n * 10n ** 18n, 1n * 10n ** 16n, 100n * 10n ** 18n, 5n * 10n ** 18n] as const
    expect(troveTotals(t)).toEqual({ coll: 11n * 10n ** 16n, debt: 2105n * 10n ** 18n })
  })
})

describe('draw reasons (C7: trove status and Recovery Mode)', () => {
  const base = { coll: 10n ** 18n, price: 100_000n * 10n ** 18n, debt: 25_000n * 10n ** 18n, amount: 10n ** 18n, fee: 0n, floor: 10n ** 18n }
  it('refuses a closed trove with TROVE_CLOSED', () => {
    expect(judgeDraw({ ...base, troveStatus: 4 })).toMatchObject({ ok: false, reason: 'TROVE_CLOSED' })
    expect(judgeDraw({ ...base, troveStatus: 2 })).toMatchObject({ ok: false, reason: 'TROVE_CLOSED' })
    expect(REASONS.TROVE_CLOSED).toContain('closed')
  })
  it('refuses draws in Recovery Mode with RECOVERY_MODE', () => {
    expect(judgeDraw({ ...base, recoveryMode: true })).toMatchObject({ ok: false, reason: 'RECOVERY_MODE' })
    expect(REASONS.RECOVERY_MODE).toContain('Recovery Mode')
  })
  it('accepts an active trove in normal mode', () => {
    expect(judgeDraw({ ...base, troveStatus: 1, recoveryMode: false }).ok).toBe(true)
  })
})

describe('useApiList (?account= switch must not show the previous account’s rows)', () => {
  it('clears stale rows immediately when the path changes, before the new fetch resolves', async () => {
    let releaseB!: (v: Response) => void
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('borrower=A')) return Promise.resolve(new Response(JSON.stringify({ requests: [{ id: 1 }] }), { status: 200 }))
      return new Promise<Response>((resolve) => { releaseB = resolve })
    })
    vi.stubGlobal('fetch', fetchMock)
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    function Probe({ path }: { path: string }) {
      const s = useApiList<{ id: number }>('requests', path)
      return <div data-state={s.state} data-items={JSON.stringify(s.items.map((i) => i.id))} />
    }
    await act(async () => { root.render(<Probe path="/v1/requests?borrower=A" />) })
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    const el = () => container.firstElementChild as HTMLElement
    expect(el().dataset.state).toBe('ok')
    expect(el().dataset.items).toBe('[1]')
    await act(async () => { root.render(<Probe path="/v1/requests?borrower=B" />) })
    // The B fetch is still pending, yet the A rows are already gone.
    expect(el().dataset.state).toBe('loading')
    expect(el().dataset.items).toBe('[]')
    await act(async () => { releaseB(new Response(JSON.stringify({ requests: [{ id: 2 }] }), { status: 200 })); await new Promise((r) => setTimeout(r, 10)) })
    expect(el().dataset.state).toBe('ok')
    expect(el().dataset.items).toBe('[2]')
    await act(async () => { root.unmount() })
    container.remove()
  })
})

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
