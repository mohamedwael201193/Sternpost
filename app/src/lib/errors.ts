import { BaseError, ContractFunctionRevertedError, decodeErrorResult, formatUnits, type Hex } from 'viem'
import governorJson from '../../../shared/abis/SternpostGovernor.json'

const pctOf = (v: unknown) => `${(Number(formatUnits(BigInt(v as bigint), 18)) * 100).toFixed(1)}%`
const mu = (v: unknown) => `${Number(formatUnits(BigInt(v as bigint), 18)).toLocaleString()} MUSD`

/** Sternpost Governor custom errors → plain language. */
const GOVERNOR: Record<string, (a: readonly unknown[]) => string> = {
  Unsafe: (a) => `Unsafe: this draw would leave your trove at ${pctOf(a[0])}, below your ${pctOf(a[1])} floor.`,
  OverBudget: (a) => `Over budget: asked for ${mu(a[0])}, only ${mu(a[1])} left on this app's budget.`,
  OverPerDraw: (a) => `Over the per-draw cap: asked for ${mu(a[0])}, cap is ${mu(a[1])}.`,
  PayeeNotAllowed: (a) => `Payee ${String(a[0]).slice(0, 10)}… is not the payee this app is locked to.`,
  AppNotAuthorized: () => 'This sender is not an approved app on your Governor.',
  AppExpired: () => "This app's budget has expired. Approve it again on Apps.",
  IsFrozen: () => 'The Governor is frozen (revoked). Unfreeze it on Revoke before drawing.',
  ZeroAmount: () => 'Amount must be above zero.',
  WindowTooLong: () => 'The withdraw signature deadline is more than 120 s ahead; the Governor rejects long windows. Sign again.',
  BadHeal: () => 'The standby repay signature does not match (it must be RepayMUSD for the same amount at nonce + 1). Sign again.',
  BypassBlocked: () => 'Mezo tried to pay the Governor outside a draw; blocked by design.',
  CallbackMismatch: (a) => `Mezo did not call back exactly once (seen ${a[0]}); the draw failed closed.`,
  AmountMismatch: () => 'The Governor did not receive exactly the drawn MUSD; the draw failed closed.',
  OnlyBorrower: () => 'Only the trove owner can do this.',
  Reentrancy: () => 'Re-entrant call blocked.',
  BadPolicy: () => 'Policy rejected: floor must be above the defend level, and defend at least 110%.',
  NotStressed: (a) => `Not stressed: ICR is ${pctOf(a[0])}, above the defend level.`,
  NotArmed: () => 'No standby repay is armed.',
  NoExcess: () => 'Nothing above the buffer to sweep.',
  NoSavings: () => 'No sMUSD savings to use.',
  TransferFailed: () => 'A token transfer failed.',
}

/** Mezo (MUSD protocol) revert strings → plain language. Source: github.com/mezo-org/musd solidity/contracts. */
const MEZO: [RegExp, string][] = [
  [/Signature expired/, 'Signature expired: the withdraw signature deadline passed before the transaction was mined. Mezo allows at most 120 s; sign and send again without pausing.'],
  [/Invalid signature/, 'Invalid signature: it was signed for a different nonce or amount (another trove action may have used the nonce). Sign again.'],
  [/ICR < MCR/, 'Mezo refused: this would take your trove below the 110% minimum collateral ratio.'],
  [/TCR < CCR|Recovery Mode|ICR >= CCR/, 'Mezo is in Recovery Mode and blocks debt increases that lower collateral ratios.'],
  [/maxBorrowingCapacity/, "Mezo refused: this exceeds the trove's maximum borrowing capacity."],
  [/net debt must be greater than minimum/, "Mezo refused: the trove's net debt would be below the protocol minimum."],
  [/Trove does not exist or is closed/, 'You have no open trove on Mezo testnet.'],
  [/Sending BTC failed/, 'Sending BTC failed: the recipient refused the transfer from Mezo.'],
  [/non-zero debtChange/, 'Amount must be above zero.'],
  [/Caller doesnt have enough mUSD/, 'Not enough MUSD to repay.'],
  [/User rejected|denied/i, 'You rejected the request in your wallet.'],
]

export function humanRevert(e: unknown): string {
  const err = e as any
  if (err instanceof BaseError) {
    const rev = err.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null
    if (rev?.data?.errorName && GOVERNOR[rev.data.errorName]) return GOVERNOR[rev.data.errorName](rev.data.args ?? [])
    const raw = (err.walk((x: any) => typeof x?.data === 'string' && x.data.startsWith('0x')) as any)?.data as Hex | undefined
    if (raw && raw.length >= 10) {
      try { const d = decodeErrorResult({ abi: governorJson as any, data: raw }); if (GOVERNOR[d.errorName]) return GOVERNOR[d.errorName](d.args ?? []) } catch { /* not a Governor error */ }
    }
  }
  const text = [err?.reason, err?.shortMessage, err?.details, err?.message].filter(Boolean).join(' | ')
  for (const [re, msg] of MEZO) if (re.test(text)) return msg
  return (err?.shortMessage || err?.message || String(e)).split('\n')[0]
}
