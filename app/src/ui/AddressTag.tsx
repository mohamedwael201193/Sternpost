import { useState } from 'react'

export type AddressTagKind = 'team' | 'outside' | 'you' | 'sandbox'

const TAG_STYLE: Record<AddressTagKind, { label: string; className: string }> = {
  team: { label: 'Team', className: 'border border-ink/40 text-muted' },
  outside: { label: 'Outside', className: 'border border-safe text-safe' },
  you: { label: 'You', className: 'border border-magenta text-magenta' },
  sandbox: { label: 'Sandbox', className: 'border border-dashed border-ink/50 text-muted' },
}

export function shortAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** An address, truncated in mono, with an optional team/outside tag (the caller decides the tag from event data). */
export function AddressTag({
  address,
  tag,
  className = '',
}: {
  address: string
  tag?: AddressTagKind
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  const t = tag ? TAG_STYLE[tag] : null
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={copy}
        title={address}
        aria-label={`Copy address ${address}`}
        className="mono text-sm text-ink underline decoration-ink/25 underline-offset-2 hover:decoration-ink"
      >
        {shortAddress(address)}
      </button>
      {copied ? <span className="text-[11px] text-muted">Copied</span> : null}
      {t ? <span className={`caps px-1.5 py-0.5 text-[10px] ${t.className}`}>{t.label}</span> : null}
    </span>
  )
}
