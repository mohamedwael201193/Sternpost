import { useMemo, useState } from 'react'
import { useReadContract, useSignTypedData, useWriteContract } from 'wagmi'
import { isAddress, parseUnits, zeroAddress, type Address, type Hex } from 'viem'
import { Gauge } from '../../ui/Gauge'
import { Card, Empty, NeedsWallet, TxStatus, useTx } from '../kit'
import { useTrove } from '../useTrove'
import { borrowerOpsAbi, governorAbi } from '../../lib/abi'
import { MEZO } from '../../lib/chain'
import { REASONS, WAD, pct, projectedIcr } from '../../lib/icr'
import { drawMessages, mezoDomain, repayTypes, withdrawTypes } from '../../lib/sig'

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
  const { signTypedDataAsync } = useSignTypedData()
  const { writeContractAsync } = useWriteContract()
  const tx = useTx()
  const [bundle, setBundle] = useState<string>('')
  const [err, setErr] = useState('')
  const self = app.toLowerCase() === t.address?.toLowerCase()
  const f = 'mono text-sm border border-ink/30 bg-paper px-3 py-2 w-full mt-1'

  async function go() {
    setErr(''); setBundle('')
    try {
      const m = drawMessages({ amount: wei, borrower: t.address!, governor: t.governor!, nonce: t.nonce! })
      const withdrawSig = await signTypedDataAsync({ domain: mezoDomain(), types: withdrawTypes, primaryType: 'WithdrawMUSD', message: m.withdraw })
      const healSig = await signTypedDataAsync({ domain: mezoDomain(), types: repayTypes, primaryType: 'RepayMUSD', message: m.heal })
      const args = [wei, payee, m.withdraw.deadline, withdrawSig as Hex, m.heal.deadline, healSig as Hex] as const
      if (self) await tx.run(() => writeContractAsync({ address: t.governor!, abi: governorAbi, functionName: 'draw', args }))
      else setBundle(JSON.stringify({ governor: t.governor, amount: String(wei), payee, withdrawDeadline: String(m.withdraw.deadline), withdrawSig, healDeadline: String(m.heal.deadline), healSig }, null, 2))
    } catch (e: any) { setErr((e?.shortMessage || e?.message || String(e)).split('\n')[0]) }
  }
  return (
    <Card title="Sign the draw">
      <div className="grid gap-4">
        <label className="caps text-[11px] text-muted">Amount (MUSD)<input className={f} value={fields.amount} onChange={(e) => fields.setAmount(e.target.value)} inputMode="decimal" /></label>
        <label className="caps text-[11px] text-muted">App (submits the draw)<input className={f} value={fields.app} onChange={(e) => fields.setApp(e.target.value.trim())} placeholder="this wallet" /></label>
        <label className="caps text-[11px] text-muted">Payee<input className={f} value={fields.payee} onChange={(e) => fields.setPayee(e.target.value.trim())} placeholder="this wallet" /></label>
        <p className="text-xs text-muted">You sign two messages: a withdraw that can only pay your Governor and expires in under two minutes, and a standby repay for the next nonce. {self ? 'This wallet is the app, so it submits the draw itself.' : 'The signatures go to the app, which submits them.'}</p>
        <button className="pill self-start" disabled={!ok || t.nonce === undefined || tx.phase === 'signing' || tx.phase === 'pending'} onClick={go}>{self ? 'Sign and submit' : 'Sign for app'}</button>
        {err && <p className="text-sm text-signal">{err}</p>}
      </div>
      <TxStatus tx={tx} />
      {bundle && <div className="mt-4"><div className="caps text-[11px] text-muted mb-1">Hand this to the app (expires in ~110 s)</div><textarea readOnly className="mono text-[11px] w-full h-40 border border-ink/30 bg-paper p-2" value={bundle} /></div>}
    </Card>
  )
}
