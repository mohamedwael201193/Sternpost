import { useRef, useState } from 'react'
import { ProofLink } from './ProofLink'
import { ReasonChip, reasonCodeFromError } from './ReasonChip'

/**
 * TxButton — the one transaction button for the whole app (plan §6.2).
 *
 * States: idle → simulating (eth_call; a revert shows its reason chip and the
 * button stays idle) → waiting-wallet → pending (poll receipt AND state) →
 * confirmed (hash + ProofLink) | failed (reason chip).
 *
 * RPC null response (G6: about 1 in 8 sends returns `null response` although
 * the tx lands): the button shows "Sent. Checking the chain…" and polls the
 * caller-supplied `confirm` (which must check on-chain state, not just the
 * receipt) for up to `confirmTimeoutMs` (default 60 s).
 *
 * A button that cannot act is hidden or disabled with its plain reason beside
 * it (`disabledReason`); never silent. After a failure, clicking the button
 * resets it to idle so the user can try again.
 *
 * The component is deliberately prop-driven (no wagmi inside) so pages wire
 * their own public client and the state machine is unit-testable.
 */
export type TxPhase =
  | 'idle'
  | 'simulating'
  | 'waiting-wallet'
  | 'pending'
  | 'sent-checking'
  | 'confirmed'
  | 'failed'

export type ConfirmResult = 'confirmed' | 'failed' | { status: 'confirmed' | 'failed'; reasonCode?: string }

export interface TxButtonProps {
  /** Label in the idle state. */
  label: string
  /** Optional eth_call simulation. If it throws, the failure is shown and no wallet prompt opens. */
  simulate?: () => Promise<void>
  /** Opens the wallet and broadcasts. Resolves with the transaction hash. */
  send: () => Promise<string>
  /**
   * Polls until the transaction is confirmed on-chain. Receives the hash, or
   * `null` after an RPC null response (no hash came back). Must check on-chain
   * state as well as the receipt, and resolve 'failed' if the tx reverted.
   */
  confirm?: (hash: string | null) => Promise<ConfirmResult>
  /** How long to wait for `confirm` before reporting UNCONFIRMED (default 60 000 ms). */
  confirmTimeoutMs?: number
  /** When set, the button is disabled and this plain reason is shown beside it. */
  disabledReason?: string
  onConfirmed?: (hash: string | null) => void
  className?: string
}

const PHASE_LABEL: Record<Exclude<TxPhase, 'failed' | 'confirmed' | 'idle'>, string> = {
  simulating: 'Simulating…',
  'waiting-wallet': 'Waiting for your wallet…',
  pending: 'Submitted. Waiting for a block…',
  'sent-checking': 'Sent. Checking the chain…',
}

function normalizeConfirm(r: ConfirmResult): { status: 'confirmed' | 'failed'; reasonCode?: string } {
  return typeof r === 'string' ? { status: r } : r
}

function isNullResponse(e: unknown): boolean {
  const text = [(e as { message?: string })?.message, (e as { shortMessage?: string })?.shortMessage]
    .filter(Boolean)
    .join(' | ')
  return /null response/i.test(text)
}

function firstLine(e: unknown): string {
  const text = (e as { shortMessage?: string })?.shortMessage ?? (e as { message?: string })?.message ?? String(e)
  return text.split('\n')[0]
}

export function TxButton({
  label,
  simulate,
  send,
  confirm,
  confirmTimeoutMs = 60_000,
  disabledReason,
  onConfirmed,
  className = '',
}: TxButtonProps) {
  const [phase, setPhase] = useState<TxPhase>('idle')
  const [hash, setHash] = useState<string | null>(null)
  const [reasonCode, setReasonCode] = useState<string | null>(null)
  const [reasonDetail, setReasonDetail] = useState<string | undefined>(undefined)
  const runId = useRef(0)

  const fail = (code: string, detail?: string) => {
    setReasonCode(code)
    setReasonDetail(detail)
    setPhase('failed')
  }

  const waitConfirm = async (run: number, h: string | null): Promise<boolean> => {
    if (!confirm) return true
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('confirm timeout')), confirmTimeoutMs),
    )
    try {
      const result = normalizeConfirm(await Promise.race([confirm(h), timeout]))
      if (run !== runId.current) return false
      if (result.status === 'confirmed') return true
      fail(result.reasonCode ?? 'UNKNOWN', result.reasonCode ? undefined : 'The transaction reverted on-chain.')
      return false
    } catch {
      if (run !== runId.current) return false
      fail('UNCONFIRMED')
      return false
    }
  }

  const handleClick = async () => {
    if (phase === 'failed') {
      // Reset after a failure so the user can try again.
      setPhase('idle')
      setReasonCode(null)
      setReasonDetail(undefined)
      return
    }
    if (phase !== 'idle' || disabledReason) return
    const run = ++runId.current
    setReasonCode(null)
    setReasonDetail(undefined)
    setHash(null)
    let inSend = false
    try {
      if (simulate) {
        setPhase('simulating')
        await simulate()
        if (run !== runId.current) return
      }
      setPhase('waiting-wallet')
      inSend = true
      const h = await send()
      inSend = false
      if (run !== runId.current) return
      setHash(h)
      setPhase('pending')
      const ok = await waitConfirm(run, h)
      if (!ok || run !== runId.current) return
      setPhase('confirmed')
      onConfirmed?.(h)
    } catch (e: unknown) {
      if (run !== runId.current) return
      if (inSend && isNullResponse(e)) {
        // G6: the send returned nothing, but the tx may have landed. Poll state.
        setPhase('sent-checking')
        const ok = await waitConfirm(run, null)
        if (!ok || run !== runId.current) return
        setPhase('confirmed')
        onConfirmed?.(null)
        return
      }
      const code = reasonCodeFromError(e) ?? 'UNKNOWN'
      fail(code, code === 'UNKNOWN' ? firstLine(e) : undefined)
    }
  }

  const busy = phase === 'simulating' || phase === 'waiting-wallet' || phase === 'pending' || phase === 'sent-checking'
  const buttonLabel =
    phase === 'idle' ? label : phase === 'failed' ? 'Try again' : phase === 'confirmed' ? 'Confirmed' : PHASE_LABEL[phase]

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleClick}
          disabled={busy || !!disabledReason || phase === 'confirmed'}
          aria-live="polite"
          className={`pill ${phase === 'confirmed' ? '!bg-safe' : ''} ${phase === 'failed' ? '!bg-signal' : ''} disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {buttonLabel}
        </button>
        {disabledReason ? (
          <span role="note" className="text-sm text-muted">
            {disabledReason}
          </span>
        ) : null}
        {phase === 'sent-checking' ? (
          <span role="status" className="text-sm text-muted">
            The RPC returned no response. Polling on-chain state for up to {Math.round(confirmTimeoutMs / 1000)} s — do not send again.
          </span>
        ) : null}
      </div>
      {phase === 'failed' && reasonCode ? (
        <div className="mt-3">
          <ReasonChip code={reasonCode} detail={reasonDetail} />
        </div>
      ) : null}
      {phase === 'confirmed' ? (
        <div className="mt-3 text-sm">
          {hash ? (
            <span className="mr-2">Confirmed on Mezo testnet.</span>
          ) : (
            <span className="mr-2">Confirmed on-chain. The RPC returned no hash, so no explorer link is available.</span>
          )}
          {hash ? <ProofLink hash={hash} /> : null}
        </div>
      ) : null}
    </div>
  )
}
