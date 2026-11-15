/** Reason codes (plan §3.3) → plain sentences. Never show a bare revert code. */

export const REASON_TEXT: Record<string, string> = {
  NOT_OWNER: 'Only the account owner can do this.',
  SESSION_INACTIVE: 'This agent has no live session: it was never signed on, was revoked, or expired.',
  PAYEE_NOT_ALLOWED: 'This payee is not on the agent allowlist.',
  OVER_PER_TX: 'Above the per-transaction cap for this agent.',
  OVER_BUDGET: 'Above the remaining budget for this agent.',
  OVER_DAILY: 'Above the daily limit for this agent.',
  BELOW_FLOOR: 'This would leave the trove below its ICR floor.',
  RECOVERY_MODE: 'Mezo is in Recovery Mode: new draws are paused. Spending from the buffer and the shield keep working.',
  TROVE_NOT_ACTIVE: 'This trove is no longer active (closed, redeemed, or liquidated).',
  NOT_STRESSED: 'Nothing to do: the trove is not stressed, so the shield has nothing to fix.',
  NOTHING_TO_DO: 'Nothing to do: the shield could neither repay nor add collateral.',
  COOLDOWN: 'The shield ran too recently. Wait for the cooldown to pass.',
  INTENT_EXPIRED: 'This signed intent expired before it was submitted.',
  BAD_SIGNATURE: 'Bad signature: the intent was not signed by this agent, or its nonce already moved.',
  BAD_NONCE: 'Bad nonce: this intent was already used or is out of order.',
  BELOW_MIN_DEBT: 'Mezo requires at least 1,800 MUSD of net debt.',
  REDEMPTION_EXPOSED: 'Too little debt sits ahead of this trove: it would be next in line for redemption.',
  NEED_MUSD: 'Not enough MUSD in the account to repay before closing.',
  BAD_POLICY: 'Policy rejected: check the floor, watch, and target ordering.',
  BOUNTY_TOO_HIGH: 'The keeper bounty is above the 5 MUSD cap.',
  ZERO_AMOUNT: 'Amount must be above zero.',
  ALREADY_INITIALIZED: 'This account is already initialised.',
  REENTRANCY: 'Re-entrant call blocked.',
  TRANSFER_FAILED: 'A token transfer failed.',
  USER_REJECTED: 'You rejected the request in your wallet.',
  RPC_NULL_RESPONSE: 'The RPC returned no response, but the transaction may still have landed. Checking the chain.',
  UNCONFIRMED: 'Could not confirm the transaction within 60 s. Check the explorer before sending again.',
  UNKNOWN: 'The transaction failed for an unknown reason.',
}

const KNOWN_CODES = Object.keys(REASON_TEXT)

/** Extract a plan reason code from an error, if it carries one. */
export function reasonCodeFromError(e: unknown): string | null {
  const err = e as { message?: string; shortMessage?: string; reason?: string; data?: { errorName?: string } }
  const name = (err as { data?: { errorName?: string } })?.data?.errorName
  if (name) {
    const code = name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()
    if (KNOWN_CODES.includes(code)) return code
  }
  const text = [err?.message, err?.shortMessage, err?.reason].filter(Boolean).join(' | ')
  for (const code of KNOWN_CODES) {
    if (new RegExp(`\\b${code}\\b`).test(text)) return code
  }
  if (/user rejected|user denied|denied by the user/i.test(text)) return 'USER_REJECTED'
  if (/null response/i.test(text)) return 'RPC_NULL_RESPONSE'
  return null
}

export function reasonText(code: string): string {
  return REASON_TEXT[code] ?? REASON_TEXT.UNKNOWN
}

/** A reason code rendered as a plain sentence. Never silent: every failure shows one. */
export function ReasonChip({ code, detail, className = '' }: { code: string; detail?: string; className?: string }) {
  return (
    <span
      role="status"
      className={`inline-flex items-start gap-2 border border-signal/50 bg-signal/5 px-3 py-2 text-left text-sm leading-snug text-ink ${className}`}
    >
      <span className="mono mt-0.5 shrink-0 text-[11px] font-medium uppercase tracking-wider text-signal">{code.replaceAll('_', ' ')}</span>
      <span>
        {reasonText(code)}
        {detail ? <span className="block text-xs text-muted">{detail}</span> : null}
      </span>
    </span>
  )
}
