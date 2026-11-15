import { useState } from 'react'
import { addrUrl, txUrl } from '../lib/proofs'

/** Hash or address → Mezo testnet explorer link (mono) with a copy button. */
export function ProofLink({
  hash,
  address,
  label,
  className = '',
}: {
  hash?: string
  address?: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  if (!hash && !address) return null
  const value = (hash ?? address)!
  const url = hash ? txUrl(hash) : addrUrl(address!)
  const short = `${value.slice(0, 10)}…${value.slice(-4)}`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <a
        className="mono text-xs text-magenta underline decoration-magenta/40 underline-offset-2 hover:decoration-magenta"
        href={url}
        target="_blank"
        rel="noreferrer"
      >
        {label ?? short}
      </a>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${hash ? 'transaction hash' : 'address'} ${value}`}
        className="border border-ink/25 px-1.5 py-0.5 text-[10px] caps text-muted transition hover:border-ink/60 hover:text-ink"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  )
}
