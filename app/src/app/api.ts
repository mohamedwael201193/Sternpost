import { useEffect, useState } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import { API_URL } from '../lib/chain'

/** Small fetch hook for the optional Sternpost API. state 'off' = no API configured. */
export function useApiList<T>(key: string, path: string | null) {
  const [s, set] = useState<{ state: 'off' | 'loading' | 'ok' | 'error'; items: T[] }>({ state: API_URL && path ? 'loading' : 'off', items: [] })
  useEffect(() => {
    if (!API_URL || !path) return set({ state: 'off', items: [] })
    let live = true
    fetch(API_URL + path).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => live && set({ state: 'ok', items: j[key] ?? [] }))
      .catch(() => live && set({ state: 'error', items: [] }))
    return () => { live = false }
  }, [key, path])
  return s
}

/** Must match backend requestStatusMessage exactly. */
export const requestStatusMessage = (id: number, status: string, borrower: string, expiry: number) =>
  `Sternpost: mark draw request #${id} ${status}\nBorrower: ${borrower.toLowerCase()}\nExpires: ${expiry}`

/** Mark an API draw request approved/rejected. The borrower signs a short-lived message; only pending requests change. */
export async function setRequestStatus(id: number | string, status: 'approved' | 'rejected', borrower: string, sign: (message: string) => Promise<string>) {
  const expiry = Math.floor(Date.now() / 1000) + 300
  const signature = await sign(requestStatusMessage(Number(id), status, borrower, expiry))
  const r = await fetch(`${API_URL}/v1/requests/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status, expiry, signature }) })
  return r.ok
}

/** Hook form: binds the connected wallet as signer. Returns false if the user declines the signature. */
export function useSetRequestStatus() {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  return (id: number | string, status: 'approved' | 'rejected') =>
    address ? setRequestStatus(id, status, address, (message) => signMessageAsync({ message })).catch(() => false) : Promise.resolve(false)
}
