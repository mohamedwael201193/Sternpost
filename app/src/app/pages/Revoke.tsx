import { useState } from 'react'
import { useReadContract, useSignTypedData, useWriteContract } from 'wagmi'
import { parseUnits, type Hex } from 'viem'
import { Card, Empty, NeedsWallet, TxStatus, useTx } from '../kit'
import { useTrove } from '../useTrove'
import { governorAbi } from '../../lib/abi'
import { fmt } from '../../lib/icr'
import { addCollTypes, burnMessage, deadlineIn, mezoDomain, repayTypes, DRAW_WINDOW_S } from '../../lib/sig'

export default function Revoke() {
  const t = useTrove()
  const { signTypedDataAsync } = useSignTypedData()
  const { writeContractAsync } = useWriteContract()
  const revoke = useTx(), unfreeze = useTx(), rearm = useTx()
  const buffer = useReadContract({ address: t.governor, abi: governorAbi, functionName: 'buffer', query: { enabled: !!t.governor } })
  const [amt, setAmt] = useState('')

  async function doRevoke() {
    await revoke.run(async () => {
      const m = burnMessage({ borrower: t.address!, nonce: t.nonce! })
      const sig = await signTypedDataAsync({ domain: mezoDomain(), types: addCollTypes, primaryType: 'AddColl', message: m })
      return writeContractAsync({ address: t.governor!, abi: governorAbi, functionName: 'revoke', args: [m.deadline, sig as Hex], value: 1n })
    })
    t.refetch()
  }
  async function doRearm() {
    await rearm.run(async () => {
      const amount = parseUnits(amt || '0', 18), deadline = deadlineIn(3600n * 24n)
      const sig = await signTypedDataAsync({ domain: mezoDomain(), types: repayTypes, primaryType: 'RepayMUSD', message: { amount, borrower: t.address!, nonce: t.nonce!, deadline } })
      return writeContractAsync({ address: t.governor!, abi: governorAbi, functionName: 'rearm', args: [amount, deadline, sig as Hex] })
    })
    t.refetch()
  }
  const busy = (x: ReturnType<typeof useTx>) => x.phase === 'signing' || x.phase === 'pending'
  return (
    <div className="space-y-8">
      <header><h1 className="display text-4xl">Revoke</h1><p className="text-muted mt-2 max-w-2xl">One transaction freezes your Governor and advances your Mezo signature nonce, so every signature you handed out stops working at once.</p></header>
      <NeedsWallet what="revoke signatures">
        {!t.governor ? <Empty title="No Governor yet">Nothing to revoke.</Empty> : (
          <div className="grid lg:grid-cols-3 gap-6">
            <Card title="Burn the nonce">
              <p className="text-sm">You sign a 1-wei collateral top-up at your current nonce ({t.nonce?.toString() ?? '…'}). The Governor submits it, the nonce moves on, and old signatures become invalid.</p>
              <p className="text-xs text-muted mt-2">Cost: 1 wei of BTC plus gas. Window {String(DRAW_WINDOW_S)} s.</p>
              <button className="pill mt-4 !bg-signal !border-signal" disabled={t.nonce === undefined || busy(revoke)} onClick={doRevoke}>Revoke everything</button>
              <TxStatus tx={revoke} />
            </Card>
            <Card title="Unfreeze">
              <p className="text-sm">Status: {t.frozen ? <b className="text-signal">frozen</b> : <b className="text-safe">active</b>}. While frozen, no app can draw.</p>
              <button className="pill-ghost mt-4" disabled={!t.frozen || busy(unfreeze)} onClick={async () => { await unfreeze.run(() => writeContractAsync({ address: t.governor!, abi: governorAbi, functionName: 'unfreeze' })); t.refetch() }}>Unfreeze</button>
              <TxStatus tx={unfreeze} />
            </Card>
            <Card title="Re-arm standby">
              <p className="text-sm">After a revoke the standby repay is cleared. Sign a fresh one at the new nonce so defend() can protect you again.</p>
              <p className="text-xs text-muted mt-2">Buffer available: {buffer.data !== undefined ? `${fmt(buffer.data)} MUSD` : '—'} · standby {t.standby?.[3] ? 'live' : 'not armed'}</p>
              <input aria-label="Re-arm amount" className="mono text-sm border border-ink/30 bg-paper px-3 py-2 w-full mt-3" placeholder="MUSD amount" value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" />
              <button className="pill mt-3" disabled={!amt || !buffer.data || busy(rearm)} onClick={doRearm}>Sign and re-arm</button>
              <TxStatus tx={rearm} />
            </Card>
          </div>
        )}
      </NeedsWallet>
    </div>
  )
}
