import { useState } from 'react'
import { usePublicClient, useSignTypedData, useWriteContract } from 'wagmi'
import type { Address, Hex } from 'viem'
import { useTx } from './kit'
import type { Trove } from './useTrove'
import { governorFullAbi, signaturesAbi } from '../lib/abi'
import { humanRevert } from '../lib/errors'
import { MEZO } from '../lib/chain'
import { drawMessages, mezoDomain, repayTypes, withdrawTypes } from '../lib/sig'

/** Re-sign the withdraw if fewer than this many seconds remain before we can hand it to the wallet. */
export const MIN_LEFT_S = 45n

/**
 * The single Sign & send flow, shared by the Draw page and the dashboard hero form.
 * Standby repay is signed first (24 h deadline); the withdraw deadline is taken from chain time
 * right before its signature, re-signed if it ran low, simulated, then sent.
 */
export function useDrawSend(t: Trove) {
  const client = usePublicClient()
  const { signTypedDataAsync } = useSignTypedData()
  const { writeContractAsync } = useWriteContract()
  const tx = useTx()
  const [bundle, setBundle] = useState<string>('')
  const [err, setErr] = useState('')
  const [step, setStep] = useState('')
  const [deadline, setDeadline] = useState<bigint>()
  const [skew, setSkew] = useState(0n) // chain time minus local time, seconds
  const busy = !!step || tx.phase === 'signing' || tx.phase === 'pending'

  const localNow = () => BigInt(Math.floor(Date.now() / 1000))
  async function chainNow() {
    const b = await client!.getBlock({ blockTag: 'latest' })
    const s = b.timestamp - localNow(); setSkew(s)
    return localNow() + s
  }

  async function go(wei: bigint, app: Address, payee: Address) {
    const self = app.toLowerCase() === t.address?.toLowerCase()
    setErr(''); setBundle(''); setDeadline(undefined); tx.reset()
    try {
      const borrower = t.address!, governor = t.governor!
      setStep('Reading your Mezo nonce…')
      const nonce = await client!.readContract({ address: MEZO.signatures, abi: signaturesAbi, functionName: 'getNonce', args: [borrower] })
      // 1) Standby repay first: its deadline is 24 h, so time spent here does not eat the withdraw window.
      setStep('Signature 1 of 2: standby repay (nonce + 1)…')
      const m0 = drawMessages({ amount: wei, borrower, governor, nonce, now: await chainNow() })
      const healSig = await signTypedDataAsync({ domain: mezoDomain(), types: repayTypes, primaryType: 'RepayMUSD', message: m0.heal })
      // 2) Withdraw: deadline taken from chain time right before this signature. Re-sign once if it ran low.
      for (let attempt = 1; ; attempt++) {
        setStep(attempt === 1 ? 'Signature 2 of 2: withdraw (window starts now)…' : 'Withdraw window ran low, re-signing with a fresh deadline…')
        const m = drawMessages({ amount: wei, borrower, governor, nonce, now: await chainNow() })
        setDeadline(m.withdraw.deadline)
        const withdrawSig = await signTypedDataAsync({ domain: mezoDomain(), types: withdrawTypes, primaryType: 'WithdrawMUSD', message: m.withdraw })
        const left = m.withdraw.deadline - (await chainNow())
        if (left < MIN_LEFT_S) { if (attempt < 3) continue; throw new Error('Signature expired') }
        const args = [wei, payee, m.withdraw.deadline, withdrawSig as Hex, m0.heal.deadline, healSig as Hex] as const
        if (!self) {
          setBundle(JSON.stringify({ governor, amount: String(wei), payee, withdrawDeadline: String(m.withdraw.deadline), withdrawSig, healDeadline: String(m0.heal.deadline), healSig }, null, 2))
          break
        }
        setStep('Checking the draw with the Governor (simulation)…')
        try { await client!.simulateContract({ account: borrower, address: governor, abi: governorFullAbi, functionName: 'draw', args }) }
        catch (e) { if (/Signature expired/.test(humanRevert(e)) && attempt < 3) continue; throw e }
        setStep('')
        await tx.run(() => writeContractAsync({ address: governor, abi: governorFullAbi, functionName: 'draw', args, gas: 1_750_000n }))
        break
      }
      t.refetch()
    } catch (e) { setErr(humanRevert(e)) } finally { setStep('') }
  }
  const sent = tx.phase === 'success' || tx.phase === 'reverted'
  return { go, tx, bundle, err, step, deadline, skew, busy, sent }
}
