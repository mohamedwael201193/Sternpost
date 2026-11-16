import { useState } from 'react'
import { useAccount, usePublicClient, useReadContract, useReadContracts, useWalletClient } from 'wagmi'
import { zeroAddress, type Address } from 'viem'
import { Card, Empty, NeedsWallet } from '../kit'
import { Skeleton } from '../../ui/Skeleton'
import { useTrove } from '../useTrove'
import { RPC_ERROR_TEXT, useAccount as useAccountData, useViewedAccount } from '../useAccount'
import { erc20Abi, factoryAbi } from '../../lib/abi'
import { MEZO, STERNPOST } from '../../lib/chain'
import { fmt } from '../../lib/icr'
import { PROOFS, addrUrl, txUrl } from '../../lib/proofs'
import { useApiList } from '../api'
import { payFromSpendWallet } from '../x402'

const spendAbi = [
  { type: 'function', name: 'agent', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'agentExpiry', inputs: [], outputs: [{ type: 'uint64' }], stateMutability: 'view' },
] as const

export default function Pay() {
  const t = useTrove()
  const viewed = useViewedAccount()
  const demo = viewed.demoMode
  // L6: hold the demo wallets on a skeleton while wagmi reconnects — the
  // demo owner is not settled yet. An explicit ?account= preview shows at
  // once.
  const holdDemo = demo && viewed.reconnecting && viewed.source !== 'param'
  const acct = useAccountData(demo ? viewed.address : undefined)
  const proof = PROOFS.find((p) => p.id === 'x402')!
  return (
    <div className="space-y-8">
      <header><h1 className="display text-4xl">Pay</h1><p className="text-muted mt-2 max-w-2xl">Drawn MUSD can sit in a spend wallet that an agent signs x402 payments from. The agent can spend that wallet, never your trove.</p></header>
      <div className="grid lg:grid-cols-[1fr_360px] gap-8">
        <div className="space-y-6">
          {demo ? (
            holdDemo ? <div className="space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>
            : acct.isLoading ? <div className="space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>
            : acct.isError ? <p className="text-sm text-signal">{RPC_ERROR_TEXT}</p>
            : acct.data?.owner ? <Wallets owner={acct.data.owner} demo />
            : <Empty title="No spend wallets">The demo account has no known owner.</Empty>
          ) : (
            <NeedsWallet what="see your spend wallets"><Wallets owner={t.address!} demo={false} /></NeedsWallet>
          )}
          <Receipts payer={demo ? viewed.address : undefined} />
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

/**
 * LOW-4: `demo` defaults to true (read-only) — a future call site that
 * forgets the prop silently gets a read-only row, never a live pay button.
 * A live button needs an explicit `demo={false}` opt-out (see Pay above).
 */
function Wallets({ owner, demo = true }: { owner: Address; demo?: boolean }) {
  const { data: wallets, isError: walletsError, isLoading: walletsLoading } = useReadContract({ address: STERNPOST.factory, abi: factoryAbi, functionName: 'walletsOf', args: [owner], query: { enabled: !!STERNPOST.factory } })
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
  // Round 7 (LOW-9): a failed walletsOf read is an error, never "No spend
  // wallets" — the user may already have wallets. A failed balance/agent
  // slot is "unreadable", never perpetual "Loading…" or a false "no agent".
  // Round 8 (J3 M4): while walletsOf is still in flight the list is empty
  // — a skeleton, never the "No spend wallets" empty.
  if (walletsError) return <p className="text-sm text-signal" role="alert">{RPC_ERROR_TEXT}</p>
  if (walletsLoading) return <div className="space-y-3"><Skeleton className="h-4 w-full" label="Loading spend wallets" /><Skeleton className="h-4 w-2/3" label="Loading spend wallets" /></div>
  if (!list.length) return <Empty title="No spend wallets">Create one from the SDK with factory.createSpendWallet(agent, expiry), then draw into it.</Empty>
  return (
    <Card title="Spend wallets">
      {list.map((w, i) => {
        const [bal, agent, exp] = (reads.data ?? []).slice(i * 3, i * 3 + 3)
        const a = agent?.result as Address | undefined
        const agentUnreadable = agent?.status === 'failure' || exp?.status === 'failure'
        return (
          <div key={w} className="py-3 border-t border-ink/15 grid sm:grid-cols-3 gap-2 text-sm items-center">
            <a className="ink-link mono text-xs" href={addrUrl(w)} target="_blank" rel="noreferrer">{w.slice(0, 10)}…{w.slice(-4)}</a>
            <span><b className="mono">{bal?.result !== undefined ? fmt(bal.result as bigint) : reads.isError || bal?.status === 'failure' ? 'unreadable' : 'Loading…'}</b> MUSD</span>
            {/* Round 8 (J3 M4): the balance column gates on loading; the
                agent column had no equivalent branch — while the per-wallet
                batch loads, `agent` is undefined and the column flashed "no
                agent", and if `agent` resolved one tick before
                `agentExpiry`, `exp?.result ?? 0n` rendered new Date(0) —
                1/1/1970. Gate on reads.isLoading ("Loading…") and render the
                expiry date only when exp.result is defined. */}
            <span className="text-xs">{reads.isLoading ? 'Loading…' : agentUnreadable ? 'agent unreadable' : !a || a === zeroAddress ? 'no agent' : exp?.result !== undefined ? <>agent {a.slice(0, 8)}… until {new Date(Number(exp.result as bigint) * 1000).toLocaleDateString()}</> : 'Loading…'}</span>
            <PayRow wallet={w} agent={a} demo={demo} />
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

/** Exported for the demo=true-default test (demoFixes.test.tsx). */
export function PayRow({ wallet, agent, demo = true }: { wallet: Address; agent?: Address; demo?: boolean }) {
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()
  const [s, set] = useState<{ phase: 'idle' | 'busy' | 'done' | 'error'; msg?: string; tx?: string; ok?: boolean }>({ phase: 'idle' })
  const isAgent = !!agent && !!address && agent.toLowerCase() === address.toLowerCase()
  // Demo mode is read-only: the pay button must never render here, even when
  // the connected wallet IS the demo spend wallet's agent — a live x402
  // settlement is a write, and demo mode promises no writes.
  if (demo) return <p className="sm:col-span-3 text-xs text-muted">Read-only demo — paying from this wallet needs the owner wallet outside demo mode.</p>
  if (!isAgent) return <p className="sm:col-span-3 text-xs text-muted">Only this wallet's agent can sign its x402 payments. Connect as {agent && agent !== zeroAddress ? `${agent.slice(0, 8)}…` : 'the agent'} to pay from it; you, the owner, can sweep or revoke it from the SDK.</p>
  async function go() {
    set({ phase: 'busy' })
    try {
      const r = await payFromSpendWallet({ wallet, agent: address!, walletClient: walletClient!, publicClient: publicClient! })
      const tx = r.settlement?.transaction as string | undefined
      let ok: boolean | undefined
      if (tx) ok = (await publicClient!.waitForTransactionReceipt({ hash: tx as `0x${string}` })).status === 'success'
      if (r.status !== 200) set({ phase: 'error', msg: `API answered ${r.status}${r.body?.error ? `: ${r.body.error}` : ''}`, tx })
      else set({ phase: 'done', tx, ok })
    } catch (e: any) { set({ phase: 'error', msg: (e?.shortMessage || e?.message || String(e)).split('\n')[0] }) }
  }
  return (
    <div className="sm:col-span-3">
      <button className="pill" disabled={s.phase === 'busy' || !walletClient} onClick={go}>{s.phase === 'busy' ? 'Signing and settling…' : 'Pay for the desk brief (x402)'}</button>
      {s.phase === 'error' && <p className="text-xs text-signal mt-2">{s.msg}</p>}
      {s.tx && <p className="text-xs mt-2">Settlement tx <a className="ink-link mono" href={txUrl(s.tx)} target="_blank" rel="noreferrer">{s.tx.slice(0, 10)}…</a>{s.ok === undefined ? '' : s.ok ? ' (receipt: success)' : ' (receipt: reverted)'}</p>}
    </div>
  )
}
