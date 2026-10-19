import { useReadContract, useReadContracts } from 'wagmi'
import { zeroAddress, type Address } from 'viem'
import { Card, Empty, NeedsWallet } from '../kit'
import { useTrove } from '../useTrove'
import { erc20Abi, factoryAbi } from '../../lib/abi'
import { MEZO, STERNPOST } from '../../lib/chain'
import { fmt } from '../../lib/icr'
import { PROOFS, addrUrl, txUrl } from '../../lib/proofs'
import { useApiList } from '../api'

const spendAbi = [
  { type: 'function', name: 'agent', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'agentExpiry', inputs: [], outputs: [{ type: 'uint64' }], stateMutability: 'view' },
] as const

export default function Pay() {
  const t = useTrove()
  const proof = PROOFS.find((p) => p.id === 'x402')!
  return (
    <div className="space-y-8">
      <header><h1 className="display text-4xl">Pay</h1><p className="text-muted mt-2 max-w-2xl">Drawn MUSD can sit in a spend wallet that an agent signs x402 payments from. The agent can spend that wallet, never your trove.</p></header>
      <div className="grid lg:grid-cols-[1fr_360px] gap-8">
        <div className="space-y-6">
          <NeedsWallet what="see your spend wallets"><Wallets owner={t.address!} /></NeedsWallet>
          <Receipts payer={undefined} />
        </div>
        <Card title="Last x402 settlement">
          <div className="border border-ink/20 bg-paper2 p-5 text-center">
            <div className="caps text-[11px] text-muted">Receipt · Mezo testnet</div>
            <div className="display text-xl mt-2">{proof.title}</div>
            <p className="text-xs text-muted mt-2">{proof.claim}</p>
            <a className="ink-link mono text-xs mt-3 inline-block" href={txUrl(proof.hash)} target="_blank" rel="noreferrer">Tx {proof.hash.slice(0, 10)}…</a>
          </div>
          <p className="text-xs text-muted mt-3">Recorded during our testnet run; status checked against the RPC receipt.</p>
        </Card>
      </div>
    </div>
  )
}

function Wallets({ owner }: { owner: Address }) {
  const { data: wallets } = useReadContract({ address: STERNPOST.factory, abi: factoryAbi, functionName: 'walletsOf', args: [owner], query: { enabled: !!STERNPOST.factory } })
  const list = (wallets ?? []) as Address[]
  const reads = useReadContracts({
    allowFailure: true,
    contracts: list.flatMap((w) => [
      { address: MEZO.musd, abi: erc20Abi, functionName: 'balanceOf', args: [w] },
      { address: w, abi: spendAbi, functionName: 'agent' },
      { address: w, abi: spendAbi, functionName: 'agentExpiry' },
    ] as const),
    query: { enabled: list.length > 0 },
  })
  if (!list.length) return <Empty title="No spend wallets">Create one from the SDK with factory.createSpendWallet(agent, expiry), then draw into it.</Empty>
  return (
    <Card title="Spend wallets">
      {list.map((w, i) => {
        const [bal, agent, exp] = (reads.data ?? []).slice(i * 3, i * 3 + 3)
        const a = agent?.result as Address | undefined
        return (
          <div key={w} className="py-3 border-t border-ink/15 grid sm:grid-cols-3 gap-2 text-sm">
            <a className="ink-link mono text-xs" href={addrUrl(w)} target="_blank" rel="noreferrer">{w.slice(0, 10)}…{w.slice(-4)}</a>
            <span><b className="mono">{bal?.result !== undefined ? fmt(bal.result as bigint) : '—'}</b> MUSD</span>
            <span className="text-xs">{!a || a === zeroAddress ? 'no agent' : <>agent {a.slice(0, 8)}… until {new Date(Number(exp?.result ?? 0n) * 1000).toLocaleDateString()}</>}</span>
          </div>
        )
      })}
    </Card>
  )
}

function Receipts({ payer }: { payer?: string }) {
  const q = useApiList<{ id: number; tx_hash: string; payer: string; amount: string; resource?: string; created_at: string }>('receipts', `/v1/receipts${payer ? `?payer=${payer}` : ''}`)
  return (
    <Card title="Receipts">
      {q.state === 'off' && <p className="text-sm text-muted">Receipts are recorded by the Sternpost API, which is not configured on this deployment.</p>}
      {q.state === 'error' && <p className="text-sm text-signal">API unreachable.</p>}
      {q.state === 'ok' && !q.items.length && <p className="text-sm text-muted">No paid requests yet.</p>}
      {q.items.map((r) => (
        <div key={r.id} className="py-3 border-t border-ink/15 flex justify-between text-sm">
          <span className="mono text-xs">{r.payer.slice(0, 8)}… · {r.resource ?? 'paid request'}</span>
          <a className="ink-link mono text-xs" href={txUrl(r.tx_hash)} target="_blank" rel="noreferrer">{r.tx_hash.slice(0, 10)}…</a>
        </div>
      ))}
    </Card>
  )
}
