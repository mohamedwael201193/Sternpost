import { mezoTestnet } from '../lib/chain'

/**
 * Wrong-network banner (plan §6.4.2). The page wires `onSwitch` to the wallet
 * chain switch; the banner itself never pretends a switch happened.
 * The required chain comes from the repo's chain definition, never a literal.
 */
export function NetworkMismatchBanner({
  currentChainId,
  requiredChainId = mezoTestnet.id,
  requiredName = 'Mezo Testnet',
  onSwitch,
  className = '',
}: {
  currentChainId?: number
  requiredChainId?: number
  requiredName?: string
  onSwitch?: () => void
  className?: string
}) {
  return (
    <div role="alert" className={`flex flex-wrap items-center gap-3 border border-signal/50 bg-signal/5 px-4 py-3 ${className}`}>
      <div className="text-sm leading-snug">
        <b>Wrong network.</b>{' '}
        {currentChainId
          ? `Your wallet is on chain ${currentChainId}. `
          : 'Your wallet is not on the right network. '}
        Switch to {requiredName} ({requiredChainId}) to continue.
      </div>
      {onSwitch ? (
        <button type="button" onClick={onSwitch} className="pill ml-auto !px-4 !py-2 text-[11px]">
          Switch to {requiredName}
        </button>
      ) : null}
    </div>
  )
}
