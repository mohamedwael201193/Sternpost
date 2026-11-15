/** Network badge (plan §6.1): one badge on every number block, so testnet/mainnet/synthetic are never blurred. */

export type NetworkKind = 'testnet' | 'mainnet-readonly' | 'mainnet-pilot' | 'synthetic'

const STYLE: Record<NetworkKind, { label: string; className: string }> = {
  // TESTNET = brass outline
  testnet: { label: 'Testnet', className: 'border border-brass text-brass' },
  // MAINNET (read-only) = sea outline
  'mainnet-readonly': { label: 'Mainnet (read-only)', className: 'border border-sea text-sea' },
  // MAINNET PILOT = magenta fill
  'mainnet-pilot': { label: 'Mainnet pilot', className: 'border border-magenta bg-magenta text-paper' },
  // SYNTHETIC = dashed
  synthetic: { label: 'Synthetic', className: 'border border-dashed border-ink/50 text-muted' },
}

export function NetBadge({ network, label, className = '' }: { network: NetworkKind; label?: string; className?: string }) {
  const s = STYLE[network]
  return (
    <span className={`caps inline-flex items-center px-2 py-1 text-[10px] ${s.className} ${className}`}>
      {label ?? s.label}
    </span>
  )
}
