import type { Address, PublicClient, WalletClient } from 'viem'
import { API_URL } from '../lib/chain'

export const PAID_URL = `${API_URL}/v1/paid/brief`
const b64 = (s: string) => JSON.parse(decodeURIComponent(escape(atob(s))))
const enc = (o: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(o))))

export type Requirements = { scheme: 'exact'; network: string; asset: Address; amount: string; payTo: Address; maxTimeoutSeconds: number; extra: Record<string, unknown> }

/** GET the paid resource unauthenticated; the API answers 402 with its requirements. */
export async function getRequirements(): Promise<{ requirements: Requirements; resource: any }> {
  const r = await fetch(PAID_URL)
  if (r.status !== 402) throw new Error(`Expected HTTP 402, got ${r.status}`)
  const h = r.headers.get('payment-required')
  const body = h ? b64(h) : await r.json()
  return { requirements: body.accepts[0], resource: body.resource }
}

/**
 * Pay from a SpendWallet: the connected wallet is its agent and signs the Permit2 typed data;
 * the SpendWallet validates that signature through EIP-1271 when the facilitator settles.
 */
export async function payFromSpendWallet(p: { wallet: Address; agent: Address; walletClient: WalletClient; publicClient: PublicClient }) {
  const { ExactEvmScheme } = await import('@x402/evm/exact/client')
  const { requirements, resource } = await getRequirements()
  const signer = {
    address: p.wallet,
    signTypedData: (a: any) => p.walletClient.signTypedData({ ...a, account: p.agent }),
    readContract: (a: any) => p.publicClient.readContract(a),
  }
  const res = await new ExactEvmScheme(signer as never).createPaymentPayload(2, requirements as never)
  const payload = { ...res, accepted: requirements, resource, x402Version: 2 }
  const header = enc(payload)
  const r = await fetch(PAID_URL, { headers: { 'PAYMENT-SIGNATURE': header, 'X-PAYMENT': header } })
  const pr = r.headers.get('payment-response')
  return { status: r.status, body: await r.json().catch(() => null), settlement: pr ? b64(pr) : null }
}
