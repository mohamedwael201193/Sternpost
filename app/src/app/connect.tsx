import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useAccount, useConfig, useConnect, useDisconnect, useSwitchChain, type Connector } from 'wagmi'
import { switchChain as switchChainAction } from 'wagmi/actions'
import { mezoTestnet } from '../lib/chain'
import { addrUrl } from '../lib/proofs'

/**
 * Sign-in sheet laid out like testnet.mezo.org's: Bitcoin wallets first (through Mezo Passport's OrangeKit
 * connectors), then "More wallets" for EVM. Every row connects for real or says plainly why it can't.
 */
type Entry = { key: string; name: string; sub?: string; icon: string; badge?: string; connector?: Connector; install?: string; note?: string }
const LOGO: Record<string, string> = {
  metamask: '/wallets/metamask.webp', taho: '/wallets/taho.webp', walletconnect: '/wallets/walletconnect.svg',
  coinbase: '/wallets/coinbase.webp', rabby: '/wallets/rabby.webp', okx: '/wallets/okx.webp',
}
const INSTALL: Record<string, string> = {
  xverse: 'https://www.xverse.app/download', unisat: 'https://unisat.io/download',
  metamask: 'https://metamask.io/download/', taho: 'https://taho.xyz/',
}
const hasBtcExt = (id: string) => {
  const w = window as unknown as Record<string, unknown>
  return id === 'xverse' ? !!(w.XverseProviders || w.BitcoinProvider) : id === 'unisat' ? !!w.unisat : false
}
/** Plain-language connect errors; -32002 means the wallet already has a prompt open (common on first MetaMask unlock). */
export function connectError(e: Error) {
  const x = e as Error & { code?: number; cause?: { code?: number } }
  const code = x.code ?? x.cause?.code
  if (code === -32002 || /already pending/i.test(e.message)) return 'Your wallet already has a request open. Open the extension to finish it.'
  if (code === 4001 || /reject|denied/i.test(e.message)) return 'The request was declined in your wallet. Try again when ready.'
  return e.message.split('\n')[0]
}
const Arrow = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
    <circle cx="12" cy="12" r="9.2" /><path d="M8 12h8M12.5 8.5L16 12l-3.5 3.5" />
  </svg>
)

export function ConnectButton({ className = 'pill' }: { className?: string }) {
  const { isConnected, chainId, address } = useAccount()
  const { switchChain } = useSwitchChain()
  const { disconnect } = useDisconnect()
  const [open, setOpen] = useState(false)
  if (isConnected && chainId !== mezoTestnet.id)
    return <button className={className} onClick={() => switchChain({ chainId: mezoTestnet.id })}>Switch to Mezo testnet</button>
  if (isConnected) return <AccountMenu address={address!} onDisconnect={() => disconnect()} />
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

/** Account pill: opens a menu (copy, explorer, disconnect with a confirm step) instead of disconnecting on one click. */
export function AccountMenu({ address, onDisconnect }: { address: `0x${string}`; onDisconnect: () => void }) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) { setConfirm(false); return }
    const out = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', out); window.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', out); window.removeEventListener('keydown', esc) }
  }, [open])
  const item = 'w-full text-left px-4 py-2.5 rounded-xl text-sm hover:bg-paper2 hover:text-magenta flex items-center justify-between gap-3'
  return (
    <div ref={ref} className="relative">
      <button className="pill-ghost inline-flex items-center gap-2 max-w-full" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="w-2 h-2 rounded-full bg-safe shrink-0" aria-hidden />
        <span className="mono text-xs" data-testid="account">{address.slice(0, 6)}…{address.slice(-4)}</span>
        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div role="menu" aria-label="Account" className="absolute right-0 mt-2 z-40 w-[min(300px,calc(100vw-2rem))] rounded-2xl border border-ink/15 bg-paper p-2 shadow-[0_20px_50px_-20px_rgba(23,19,15,.5)]">
          <div className="px-4 pt-2 pb-3 mono text-[11px] break-all text-muted">{address}</div>
          <button role="menuitem" className={item} onClick={async () => { await navigator.clipboard?.writeText(address).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
            {copied ? 'Copied' : 'Copy address'}</button>
          <a role="menuitem" className={item} href={addrUrl(address)} target="_blank" rel="noreferrer">View on Mezo explorer <span aria-hidden>↗</span></a>
          {!confirm ? <button role="menuitem" className={`${item} text-signal`} onClick={() => setConfirm(true)}>Disconnect</button> : (
            <div className="px-4 py-2 text-sm">
              <p>Disconnect this wallet?</p>
              <div className="flex gap-2 mt-2">
                <button className="pill text-xs" onClick={() => { setOpen(false); onDisconnect() }}>Disconnect</button>
                <button className="pill-ghost text-xs" onClick={() => setConfirm(false)}>Cancel</button>
              </div>
            </div>)}
        </div>
      )}
    </div>
  )
}

export function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connectAsync, connectors, isPending, error, variables } = useConnect()
  const config = useConfig()
  // Connect first, then ask for Mezo testnet as a separate step. Bundling both into one connect made a slow
  // chain-switch prompt surface as a failed connect even though the account was already linked.
  // Injected wallets connect first and switch chain after, so a slow switch prompt never reads as a failed connect.
  // Other connectors (Bitcoin via OrangeKit, WalletConnect) need the chain up front.
  const connect = ({ connector }: { connector: Connector }) => connectAsync(connector.type === 'injected' || connector.type === 'metaMask' ? { connector } : { connector, chainId: mezoTestnet.id })
    .then((r) => { if (r.chainId !== mezoTestnet.id) return switchChainAction(config, { chainId: mezoTestnet.id }).catch(() => undefined) })
    .catch(() => undefined)
  const { isConnected } = useAccount()
  const reduce = useReducedMotion()
  const [q, setQ] = useState('')
  useEffect(() => { if (isConnected) onClose() }, [isConnected, onClose])
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [open, onClose])

  const find = (p: RegExp) => connectors.find((c) => c.type === 'injected' && c.id !== 'injected' && p.test(c.name))
  const btc: Entry[] = (['xverse', 'unisat'] as const).map((id) => {
    const c = connectors.find((x) => x.id === `orangekit-${id}`)
    const there = typeof window !== 'undefined' && hasBtcExt(id)
    return { key: id, name: c?.name ?? id, sub: 'Bitcoin', icon: c?.icon ?? '', connector: there ? c : undefined, install: there ? undefined : INSTALL[id] }
  })
  const named: Entry[] = [
    ['taho', 'Taho', /taho/i], ['metamask', 'MetaMask', /metamask/i],
  ].map(([key, name, re]) => {
    const c = find(re as RegExp)
    return { key: key as string, name: name as string, icon: c?.icon ?? LOGO[key as string], connector: c, install: c ? undefined : INSTALL[key as string] }
  })
  const wc = connectors.find((c) => c.id === 'walletConnect')
  const used = new Set([...named, ...btc].map((e) => e.connector?.uid))
  const others: Entry[] = connectors
    .filter((c) => c.type !== 'orangekit' && c.id !== 'walletConnect' && !used.has(c.uid))
    .map((c) => ({ key: c.uid, name: c.id === 'injected' ? 'Browser wallet' : c.name, icon: c.icon ?? LOGO[c.id.includes('coinbase') ? 'coinbase' : /rabby/i.test(c.name) ? 'rabby' : ''] ?? '', connector: c,
      sub: c.id === 'injected' ? 'Detected in this browser' : undefined }))
  const more: Entry[] = [...named, { key: 'wc', name: 'WalletConnect', icon: LOGO.walletconnect, badge: 'Beta', connector: wc, note: wc ? undefined : 'Not configured' }, ...others]
  const match = (e: Entry) => e.name.toLowerCase().includes(q.trim().toLowerCase())
  const pendingId = (variables?.connector as Connector | undefined)?.uid

  const Row = ({ e }: { e: Entry }) => {
    const waiting = isPending && e.connector && pendingId === e.connector.uid
    const inner = (
      <>
        {e.icon ? <img src={e.icon} alt="" width={40} height={40} className="w-10 h-10 rounded-xl shrink-0" />
          : <span aria-hidden className="w-10 h-10 rounded-xl bg-paper2 grid place-items-center display">{e.name[0]}</span>}
        <span className="flex-1 min-w-0">
          <span className="block text-[17px] font-semibold leading-tight">{e.name}</span>
          {(e.sub || e.install || e.note || waiting) && (
            <span className="block text-xs text-muted mt-0.5">{waiting ? 'Check your wallet…' : e.note ?? [e.sub, e.install && 'Not installed'].filter(Boolean).join(' · ')}</span>
          )}
        </span>
        {e.badge && <span className="text-[11px] px-2 py-0.5 rounded-md bg-ink/10 text-ink/70">{e.badge}</span>}
        <Arrow />
      </>
    )
    const cls = 'w-full flex items-center gap-4 px-5 py-4 rounded-2xl border border-ink/15 bg-paper text-left transition-colors hover:bg-paper2 hover:border-magenta/50 hover:text-magenta focus-visible:outline focus-visible:outline-2 focus-visible:outline-magenta'
    if (e.connector) return <button className={cls} disabled={isPending} onClick={() => { if (!isPending) connect({ connector: e.connector! }) }}>{inner}</button>
    if (e.install) return <a className={cls} href={e.install} target="_blank" rel="noreferrer" aria-label={`Install ${e.name}`}>{inner}</a>
    return <div className={`${cls} opacity-60 pointer-events-none`} aria-disabled>{inner}</div>
  }

  if (typeof document === 'undefined') return null
  const b = btc.filter(match), m = more.filter(match)
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button aria-label="Close" className="absolute inset-0 bg-ink/35 backdrop-blur-[2px]" onClick={onClose} />
          <motion.div role="dialog" aria-modal="true" aria-labelledby="wm-title"
            className="relative w-full max-w-[600px] bg-paper rounded-[28px] shadow-[0_30px_80px_-20px_rgba(23,19,15,.5)] flex flex-col max-h-[86vh]"
            initial={reduce ? false : { y: 24, scale: .98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 12, opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 26 }}>
            <header className="relative pt-8 pb-5 text-center">
              <h2 id="wm-title" className="text-2xl font-semibold">Sign in</h2>
              <button onClick={onClose} aria-label="Close" className="absolute right-5 top-5 w-11 h-11 rounded-full bg-ink/10 grid place-items-center hover:bg-magenta/15 hover:text-magenta">
                <svg viewBox="0 0 24 24" className="w-4 h-4" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </header>
            <label className="mx-8 mb-5 flex items-center gap-4 rounded-full bg-ink/[.08] px-6 py-4 focus-within:ring-2 focus-within:ring-magenta/50">
              <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search wallets" className="flex-1 bg-transparent outline-none text-lg placeholder:text-ink/50" />
            </label>
            <div className="overflow-y-auto px-8 pb-6 space-y-3 [scrollbar-gutter:stable]">
              {b.map((e) => <Row key={e.key} e={e} />)}
              {m.length > 0 && <div className="text-sm font-semibold text-muted pt-3 px-5">More wallets</div>}
              {m.map((e) => <Row key={e.key} e={e} />)}
              {b.length + m.length === 0 && <p className="text-center text-sm text-muted py-6">No wallet matches “{q}”.</p>}
              {error && !isPending && <p role="alert" className="text-xs text-signal px-2">{connectError(error)}</p>}
              <p className="text-[11px] text-muted leading-relaxed px-2 pt-2">
                Bitcoin wallets sign in through a Mezo Passport smart account. It can hold, fund and send on Mezo, but Mezo's
                draw signature check is ECDSA-only, so drawing MUSD with Sternpost needs an EVM wallet.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
