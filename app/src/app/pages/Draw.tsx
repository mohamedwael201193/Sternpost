import { useEffect, useMemo, useState } from 'react'
import { useReadContract } from 'wagmi'
import { isAddress, parseUnits, zeroAddress, type Address } from 'viem'
import { Gauge } from '../../ui/Gauge'
import { Card, Empty, NeedsWallet, TxStatus } from '../kit'
import { useTrove } from '../useTrove'
import { MIN_LEFT_S, useDrawSend } from '../useDrawSend'
import { borrowerOpsAbi, governorAbi } from '../../lib/abi'
import { MEZO } from '../../lib/chain'
import { REASONS, WAD, pct, projectedIcr } from '../../lib/icr'
import { DRAW_WINDOW_S } from '../../lib/sig'

const toPct = (v?: bigint) => (v === undefined ? null : v >= 2n ** 200n ? 999 : Number((v * 10000n) / WAD) / 100)

export default function Draw() {
  const t = useTrove()
  const [amount, setAmount] = useState('10')
  const [app, setApp] = useState('')
  const [payee, setPayee] = useState('')
  const appAddr = (isAddress(app) ? app : t.address ?? zeroAddress) as Address
  const payeeAddr = (isAddress(payee) ? payee : t.address ?? zeroAddress) as Address
  const wei = useMemo(() => { try { return parseUnits(amount || '0', 18) } catch { return 0n } }, [amount])

  const fee = useReadContract({ address: MEZO.borrowerOperations, abi: borrowerOpsAbi, functionName: 'getBorrowingFee', args: [wei], query: { enabled: wei > 0n } })
  const preview = useReadContract({ address: t.governor, abi: governorAbi, functionName: 'previewDraw', args: [appAddr, wei, payeeAddr], query: { enabled: !!t.governor, refetchInterval: 15_000 } })
  const local = t.hasTrove && t.price ? projectedIcr(t.coll!, t.price, t.debt!, wei, fee.data ?? 0n) : undefined
  const [ok, reason, icrAfter] = preview.data ?? [undefined, '', undefined]
  const projected = icrAfter ?? local

  return (
    <div className="space-y-8">
      <header><h1 className="display text-4xl">Draw</h1><p className="text-muted mt-2 max-w-2xl">See exactly where a draw leaves your trove before you sign. The Governor runs the same check on-chain and reverts anything below your floor.</p></header>
      <NeedsWallet what="draw MUSD">
        {!t.hasTrove ? <Empty title="No trove on this wallet">Open one at testnet.mezo.org first.</Empty>
          : !t.governor ? <Empty title="No Governor yet">Create your Governor on Home to set a floor.</Empty> : (
          <div className="grid lg:grid-cols-[1fr_420px] gap-8">
            <Card>
              <div className="grid sm:grid-cols-2 gap-6 justify-items-center">
                <div className="text-center"><Gauge value={toPct(t.icr)} floor={toPct(t.floor) ?? undefined} size={250} label="Current" /></div>
                <div className="text-center"><Gauge value={toPct(t.icr)} projected={toPct(projected)} floor={toPct(t.floor) ?? undefined} size={250} label="After draw" /></div>
              </div>
              <div className="grid grid-cols-2 text-center mt-4">
                <div><div className="caps text-[11px] text-muted">Now</div><div className="display text-3xl">{t.icr ? pct(t.icr) : '—'}</div></div>
                <div><div className="caps text-[11px] text-muted">After draw + fee</div><div className={`display text-3xl ${ok ? 'text-safe' : 'text-signal'}`}>{projected ? pct(projected) : '—'}</div></div>
              </div>
              <Verdict ok={ok} reason={reason} loading={preview.isLoading} />
            </Card>
            <Sign t={t} wei={wei} app={appAddr} payee={payeeAddr} ok={!!ok}
              fields={{ amount, setAmount, app, setApp, payee, setPayee }} />
          </div>
        )}
      </NeedsWallet>
    </div>
  )
}

function Verdict({ ok, reason, loading }: { ok?: boolean; reason: string; loading: boolean }) {
  if (loading || ok === undefined) return <p className="mt-6 text-sm text-muted">Checking with your Governor…</p>
  return (
    <div role="status" className={`mt-6 border-l-2 pl-3 ${ok ? 'border-safe' : 'border-signal'}`}>
      <b className={ok ? 'text-safe' : 'text-signal'}>{ok ? 'Safe.' : 'Unsafe.'}</b>{' '}
      <span className="text-sm">{ok ? 'Above your floor and inside the app budget (Governor.previewDraw).' : REASONS[reason] ?? reason}</span>
    </div>
  )
}

function Sign({ t, wei, app, payee, ok, fields }: {
  t: ReturnType<typeof useTrove>; wei: bigint; app: Address; payee: Address; ok: boolean
  fields: { amount: string; setAmount: (s: string) => void; app: string; setApp: (s: string) => void; payee: string; setPayee: (s: string) => void }
}) {
  const { go: send, tx, bundle, err, step, deadline, skew, busy } = useDrawSend(t)
  const self = app.toLowerCase() === t.address?.toLowerCase()
  const f = 'mono text-sm border border-ink/30 bg-paper px-3 py-2 w-full mt-1'
  const go = () => send(wei, app, payee)
  const sent = tx.phase === 'success' || tx.phase === 'reverted'
  return (
    <Card title="Sign the draw">
      <div className="grid gap-4">
        <label className="caps text-[11px] text-muted">Amount (MUSD)<input className={f} value={fields.amount} onChange={(e) => fields.setAmount(e.target.value)} inputMode="decimal" /></label>
        <label className="caps text-[11px] text-muted">App (submits the draw)<input className={f} value={fields.app} onChange={(e) => fields.setApp(e.target.value.trim())} placeholder="this wallet" /></label>
        <label className="caps text-[11px] text-muted">Payee<input className={f} value={fields.payee} onChange={(e) => fields.setPayee(e.target.value.trim())} placeholder="this wallet" /></label>
        <p className="text-xs text-muted">Two signatures: first a standby repay for the next nonce (valid 24 h), then a withdraw that can only pay your Governor. Mezo's withdraw window is short by design: the Governor rejects deadlines more than 120 s ahead, and this app uses {String(DRAW_WINDOW_S)} s counted from chain time at the moment you sign it. {self ? 'The draw transaction is sent right after the second signature; confirm it in your wallet before the countdown ends.' : 'Hand the bundle to the app before the countdown ends.'}</p>
        <button className="pill self-start" disabled={!ok || t.nonce === undefined || busy} onClick={go}>{self ? 'Sign & send' : 'Sign for app'}</button>
        {step && <p className="text-sm" role="status">{step}</p>}
        {deadline && !sent && !err && <Countdown deadline={deadline} skew={skew} />}
        {err && <p className="text-sm text-signal" role="alert">{err}</p>}
      </div>
      <TxStatus tx={tx} />
      {bundle && <div className="mt-4"><div className="caps text-[11px] text-muted mb-1">Hand this to the app</div><textarea readOnly className="mono text-[11px] w-full h-40 border border-ink/30 bg-paper p-2" value={bundle} /></div>}
    </Card>
  )
}

function Countdown({ deadline, skew }: { deadline: bigint; skew: bigint }) {
  const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)) + skew)
  useEffect(() => { const i = setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000)) + skew), 1000); return () => clearInterval(i) }, [skew])
  const left = Number(deadline - now)
  return (
    <p data-testid="countdown" className={`mono text-sm ${left < Number(MIN_LEFT_S) ? 'text-signal' : ''}`}>
      {left > 0 ? `Withdraw signature valid for ${left} s more (chain time).` : 'Withdraw signature has expired; a send now would revert. Press Sign & send again.'}
    </p>
  )
}
