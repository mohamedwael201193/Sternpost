import { useEffect, useState } from 'react'
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
