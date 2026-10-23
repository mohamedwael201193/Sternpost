import { useState, type ReactNode } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import type { Hash } from 'viem'
import { humanRevert } from '../lib/errors'
import { mezoTestnet } from '../lib/chain'
import { txUrl } from '../lib/proofs'
import { ConnectButton } from './connect'

export { ConnectButton }

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
      if (r.status === 'success') { set({ phase: 'success', hash }); return true }
      // A mined revert carries no reason in its receipt. Replay the same call with eth_call at that block
      // to recover it, and say that is what we did.
      let msg = 'Reason unavailable.'
      try {
        // Mezo's public RPC is load-balanced and sometimes misses a fresh tx; retry briefly.
        let t: Awaited<ReturnType<NonNullable<typeof client>['getTransaction']>> | undefined
        for (let i = 0; i < 4 && !t; i++) t = await client!.getTransaction({ hash }).catch(() => new Promise<undefined>((ok) => setTimeout(ok, 1500)))
        if (!t) throw new Error('tx not found for replay')
        await client!.call({ account: t.from, to: t.to!, data: t.input, value: t.value, blockNumber: r.blockNumber })
        msg = 'Replay at that block did not revert (state changed); reason unknown.'
      } catch (e: any) { msg = /not found for replay/.test(e?.message) ? 'Reason unavailable (RPC did not return the tx for replay).' : `${humanRevert(e)} (reason recovered by replaying the call at block ${r.blockNumber}, not read from the receipt)` }
      set({ phase: 'reverted', hash, msg })
      return false
    } catch (e: any) {
      set({ phase: 'error', msg: humanRevert(e) })
      return false
    }
  }
  return { ...state, run, reset: () => set({ phase: 'idle' }) }
}

export function TxStatus({ tx }: { tx: ReturnType<typeof useTx> }) {
  if (tx.phase === 'idle') return null
  const label = { signing: 'Waiting for your signature…', pending: 'Submitted. Waiting for a block…', success: 'Confirmed on Mezo testnet.', reverted: `Reverted on-chain. ${tx.msg ?? ''}`, error: tx.msg, idle: '' }[tx.phase]
  const tone = tx.phase === 'success' ? 'border-safe text-safe' : tx.phase === 'reverted' || tx.phase === 'error' ? 'border-signal text-signal' : 'border-ink/30'
  return (
    <div role="status" className={`mt-4 border-l-2 pl-3 text-sm ${tone}`}>
      {label} {tx.hash && <a className="ink-link mono text-xs" href={txUrl(tx.hash)} target="_blank" rel="noreferrer">{tx.hash.slice(0, 10)}…</a>}
    </div>
  )
}

/** True when the account is a Mezo Passport smart account behind a Bitcoin wallet (OrangeKit connector). */
export function useIsBtcAccount() {
  return useAccount().connector?.type === 'orangekit'
}

/** Mezo verifies draw signatures with ECDSA.recover only (no EIP-1271), and OrangeKit can't sign EIP-712. */
export function BtcSignNote({ className = '' }: { className?: string }) {
  if (!useIsBtcAccount()) return null
  return (
    <p role="note" className={`text-xs border border-signal/40 bg-signal/5 text-ink rounded-lg px-3 py-2 leading-relaxed ${className}`}>
      <b className="text-signal">Bitcoin wallet connected.</b> You can view and fund this Mezo account, but drawing MUSD needs an
      EIP-712 signature from an EVM key: Mezo checks it with ECDSA only, and Bitcoin wallets can't produce one. Connect MetaMask, Taho or another EVM wallet to draw.
    </p>
  )
}
