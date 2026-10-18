import { useState, type ReactNode } from 'react'
import { useAccount, useConnect, useSwitchChain, usePublicClient } from 'wagmi'
import type { Hash } from 'viem'
import { mezoTestnet } from '../lib/chain'
import { txUrl } from '../lib/proofs'

export function Card({ title, children, className = '', aside }: { title?: ReactNode; children: ReactNode; className?: string; aside?: ReactNode }) {
  return (
    <section className={`plate bg-paper/80 p-6 ${className}`}>
      {title && <header className="flex items-baseline justify-between mb-4"><h2 className="display text-2xl">{title}</h2>{aside}</header>}
      {children}
    </section>
  )
}

export function Stat({ k, v, sub }: { k: string; v: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="caps text-[11px] text-muted">{k}</div>
      <div className="display text-3xl mt-1">{v}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="border border-dashed border-ink/25 p-6 text-center">
      <div className="display italic text-xl">{title}</div>
      {children && <div className="text-sm text-muted mt-2 max-w-md mx-auto">{children}</div>}
    </div>
  )
}

export function ConnectButton({ className = 'pill' }: { className?: string }) {
  const { isConnected, chainId, address } = useAccount()
  const { connect, connectors, isPending, error } = useConnect()
  const { switchChain } = useSwitchChain()
  if (isConnected && chainId !== mezoTestnet.id)
    return <button className={className} onClick={() => switchChain({ chainId: mezoTestnet.id })}>Switch to Mezo testnet</button>
  if (isConnected) return <span className="mono text-xs" data-testid="account">{address!.slice(0, 6)}…{address!.slice(-4)}</span>
  const c = connectors[0]
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button className={className} disabled={!c || isPending} onClick={() => c && connect({ connector: c, chainId: mezoTestnet.id })}>
        {isPending ? 'Waiting for wallet…' : 'Connect wallet'}
      </button>
      {!c && <span className="text-xs text-muted">No browser wallet found. Install MetaMask.</span>}
      {error && <span className="text-xs text-signal">{error.message.split('\n')[0]}</span>}
    </span>
  )
}

/** Gate: render children only when a wallet on Mezo testnet is connected. */
export function NeedsWallet({ children, what }: { children: ReactNode; what: string }) {
  const { isConnected, chainId } = useAccount()
  if (isConnected && chainId === mezoTestnet.id) return <>{children}</>
  return <Empty title="Not connected">Connect a wallet on Mezo testnet (chain 31611) to {what}. <div className="mt-4"><ConnectButton /></div></Empty>
}

/** Run a wallet action, wait for the receipt, and show the explorer link and real status. */
export function useTx() {
  const client = usePublicClient()
  const [state, set] = useState<{ phase: 'idle' | 'signing' | 'pending' | 'success' | 'reverted' | 'error'; hash?: Hash; msg?: string }>({ phase: 'idle' })
  async function run(fn: () => Promise<Hash>) {
    try {
      set({ phase: 'signing' })
      const hash = await fn()
      set({ phase: 'pending', hash })
      const r = await client!.waitForTransactionReceipt({ hash })
      set({ phase: r.status === 'success' ? 'success' : 'reverted', hash })
      return r.status === 'success'
    } catch (e: any) {
      set({ phase: 'error', msg: (e?.shortMessage || e?.message || String(e)).split('\n')[0] })
      return false
    }
  }
  return { ...state, run, reset: () => set({ phase: 'idle' }) }
}

export function TxStatus({ tx }: { tx: ReturnType<typeof useTx> }) {
  if (tx.phase === 'idle') return null
  const label = { signing: 'Waiting for your signature…', pending: 'Submitted. Waiting for a block…', success: 'Confirmed on Mezo testnet.', reverted: 'Reverted on-chain.', error: tx.msg, idle: '' }[tx.phase]
  const tone = tx.phase === 'success' ? 'border-safe text-safe' : tx.phase === 'reverted' || tx.phase === 'error' ? 'border-signal text-signal' : 'border-ink/30'
  return (
    <div role="status" className={`mt-4 border-l-2 pl-3 text-sm ${tone}`}>
      {label} {tx.hash && <a className="ink-link mono text-xs" href={txUrl(tx.hash)} target="_blank" rel="noreferrer">{tx.hash.slice(0, 10)}…</a>}
    </div>
  )
}
