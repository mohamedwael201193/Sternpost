import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useAccount, useConnect, useDisconnect, useSwitchChain, type Connector } from 'wagmi'
import { mezoTestnet } from '../lib/chain'
import { WC_PROJECT_ID } from './wagmi'

/**
 * Chartroom wallet picker, modelled on testnet.mezo.org's connect sheet.
 * EVM wallets connect for real through wagmi (EIP-6963 discovery + Coinbase + WalletConnect).
 * Bitcoin wallets are listed honestly as unsupported for signing: Mezo's BorrowerOperationsSignatures
 * verifies the borrower with ECDSA.recover, so a Bitcoin key behind a Passport smart account cannot
 * produce the EIP-712 draw signature the Governor needs.
 */
const BTC_WALLETS = ['Xverse', 'Unisat', 'OKX Bitcoin'] as const
const KNOWN = ['MetaMask', 'Rabby Wallet', 'Taho', 'OKX Wallet', 'Coinbase Wallet'] as const

function Mono({ name, icon }: { name: string; icon?: string }) {
  if (icon) return <img src={icon} alt="" width={28} height={28} className="w-7 h-7 rounded-md" />
  return <span aria-hidden className="w-7 h-7 rounded-md border border-ink/30 grid place-items-center display text-sm bg-paper2">{name[0]}</span>
}

export function ConnectButton({ className = 'pill' }: { className?: string }) {
  const { isConnected, chainId, address } = useAccount()
  const { switchChain } = useSwitchChain()
  const { disconnect } = useDisconnect()
  const [open, setOpen] = useState(false)
  if (isConnected && chainId !== mezoTestnet.id)
    return <button className={className} onClick={() => switchChain({ chainId: mezoTestnet.id })}>Switch to Mezo testnet</button>
  if (isConnected)
    return (
      <button className="pill-ghost inline-flex items-center gap-2" title="Disconnect" onClick={() => disconnect()}>
        <span className="w-2 h-2 rounded-full bg-safe" aria-hidden />
        <span className="mono text-xs" data-testid="account">{address!.slice(0, 6)}…{address!.slice(-4)}</span>
      </button>
    )
  return (
    <>
      <button className={`${className} inline-flex items-center gap-2`} onClick={() => setOpen(true)}>
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M3 7h16v12H3zM3 7l3-3h12v3M15 13h4" /></svg>
        Connect wallet
      </button>
      <WalletModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}

export function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connect, connectors, isPending, error, variables } = useConnect()
  const { isConnected } = useAccount()
  const reduce = useReducedMotion()
  useEffect(() => { if (isConnected) onClose() }, [isConnected, onClose])
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [open, onClose])

  // Discovered extensions first (they carry their own icon), then the generic browser wallet, then SDK wallets.
  const discovered = connectors.filter((c) => c.type === 'injected' && c.id !== 'injected')
  const generic = connectors.find((c) => c.id === 'injected')
  const sdk = connectors.filter((c) => c.type !== 'injected')
  const missing = KNOWN.filter((n) => !connectors.some((c) => c.name.toLowerCase().startsWith(n.split(' ')[0].toLowerCase())))
  const pendingId = (variables?.connector as Connector | undefined)?.uid

  const row = 'w-full flex items-center gap-4 px-4 py-3 text-left border-t border-ink/15 transition-colors'
  const go = (c: Connector) => connect({ connector: c, chainId: mezoTestnet.id })

  if (typeof document === 'undefined') return null
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button aria-label="Close" className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]" onClick={onClose} />
          <motion.div role="dialog" aria-modal="true" aria-labelledby="wm-title"
            className="relative w-full max-w-[440px] bg-paper border border-ink/30 shadow-[0_30px_80px_-20px_rgba(23,19,15,.45)] grain"
            initial={reduce ? false : { y: 24, scale: .98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 12, opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 26 }}>
            <header className="px-6 pt-6 pb-4 flex items-start justify-between">
              <div>
                <div className="caps text-[11px] text-magenta">Chartroom</div>
                <h2 id="wm-title" className="display text-3xl leading-tight">Connect a wallet</h2>
                <p className="text-xs text-muted mt-1">Mezo testnet · chain 31611</p>
              </div>
              <button onClick={onClose} aria-label="Close" className="text-2xl leading-none px-2 hover:text-magenta">×</button>
            </header>

            <div className="caps text-[10px] text-muted px-6 pb-2">EVM wallets</div>
            <div className="max-h-[52vh] overflow-y-auto">
              {[...discovered, ...(generic ? [generic] : []), ...sdk].map((c) => (
                <button key={c.uid} className={`${row} hover:bg-paper2 hover:text-magenta`} disabled={isPending} onClick={() => go(c)}>
                  <Mono name={c.name} icon={c.icon} />
                  <span className="flex-1">{c.id === 'injected' ? 'Browser wallet' : c.name}</span>
                  {isPending && pendingId === c.uid ? <span className="caps text-[10px] text-magenta">Waiting…</span>
                    : c.type === 'injected' ? <span className="caps text-[10px] text-safe">Detected</span> : <span aria-hidden>→</span>}
                </button>
              ))}
              {missing.filter((n) => n !== 'Coinbase Wallet').map((n) => (
                <div key={n} className={`${row} text-muted`}>
                  <Mono name={n} /><span className="flex-1">{n}</span><span className="caps text-[10px]">Not installed</span>
                </div>
              ))}
              <div className={`${row} ${WC_PROJECT_ID ? '' : 'text-muted'}`}>
                <Mono name="WalletConnect" /><span className="flex-1">WalletConnect</span>
                <span className="caps text-[10px]">{WC_PROJECT_ID ? 'Use the row above' : 'Not configured'}</span>
              </div>

              <div className="caps text-[10px] text-muted px-6 pt-4 pb-2">Bitcoin wallets</div>
              {BTC_WALLETS.map((n) => (
                <div key={n} className={`${row} text-muted`}>
                  <Mono name={n} /><span className="flex-1">{n}</span><span className="caps text-[10px]">Read-only on Mezo</span>
                </div>
              ))}
              <p className="px-6 py-3 text-[11px] text-muted border-t border-ink/15 leading-relaxed">
                Bitcoin wallets reach Mezo through a Passport smart account. Mezo checks draw signatures with
                ECDSA against the borrower address, so a smart account cannot sign a Sternpost draw yet. Use an EVM wallet.
              </p>
            </div>
            {error && <p role="alert" className="px-6 py-3 text-xs text-signal border-t border-ink/15">{error.message.split('\n')[0]}</p>}
            <footer className="px-6 py-4 border-t border-ink/20 text-[11px] text-muted flex justify-between">
              <span>New to Mezo? <a className="ink-link" href="https://testnet.mezo.org" target="_blank" rel="noreferrer">testnet.mezo.org</a></span>
              <span>No seed phrase is ever asked.</span>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
