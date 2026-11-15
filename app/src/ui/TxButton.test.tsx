import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, test, vi } from 'vitest'
import { TxButton, type TxButtonProps } from './TxButton'
import { NetBadge } from './NetBadge'
import { ReasonChip, reasonCodeFromError, reasonText } from './ReasonChip'

// No @testing-library/dom in the repo (and package.json is outside this task),
// so tests render with plain react-dom and poll for async state changes.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const HASH = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

let root: Root | null = null
let container: HTMLDivElement | null = null

function renderEl(el: React.ReactElement) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(el)
  })
  return container
}

function cleanup() {
  if (root) act(() => root!.unmount())
  root = null
  container?.remove()
  container = null
}

async function waitFor(fn: () => void, timeout = 5000): Promise<void> {
  // Sleep INSIDE act: React 19 only flushes updates scheduled outside act
  // while an act scope is open, so the wait must happen in there.
  const start = Date.now()
  for (;;) {
    let err: unknown = null
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25))
      try {
        fn()
      } catch (e) {
        err = e
      }
    })
    if (!err) return
    if (Date.now() - start > timeout) throw err
  }
}

async function clickButton(label: string) {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent === label)
  if (!button) throw new Error(`no button labelled "${label}"`)
  await act(async () => {
    button.click()
  })
}

function renderTx(props: Partial<TxButtonProps>) {
  return renderEl(
    <TxButton
      label="Open account"
      send={async () => HASH}
      confirm={async () => 'confirmed'}
      {...props}
    />,
  )
}

describe('TxButton state machine (plan §6.2)', () => {
  test('idle → simulating → waiting-wallet → pending → confirmed with ProofLink', async () => {
    const seen: string[] = []
    const c = renderTx({
      label: 'Open account',
      simulate: async () => {
        seen.push('simulating')
      },
      send: async () => {
        seen.push('send')
        return HASH
      },
      confirm: async (h) => {
        expect(h).toBe(HASH)
        return 'confirmed'
      },
    })
    try {
      await clickButton('Open account')
      await waitFor(() => expect(c.textContent).toContain('Confirmed on Mezo testnet.'))
      const button = c.querySelector('button')!
      expect(button.textContent).toBe('Confirmed')
      expect(button.disabled).toBe(true)
      const link = c.querySelector('a')!
      expect(link.getAttribute('href')).toBe(`https://explorer.test.mezo.org/tx/${HASH}`)
      expect(seen).toEqual(['simulating', 'send'])
    } finally {
      cleanup()
    }
  })

  test('simulation revert shows the reason chip and never opens the wallet', async () => {
    const send = vi.fn(async () => HASH)
    const c = renderTx({
      label: 'Draw',
      simulate: async () => {
        throw new Error('execution reverted: SESSION_INACTIVE')
      },
      send,
      confirm: async () => 'confirmed',
    })
    try {
      await clickButton('Draw')
      await waitFor(() => expect(c.textContent).toContain('no live session'))
      expect(c.textContent).toContain('SESSION INACTIVE')
      expect(send).not.toHaveBeenCalled()
      // Failed button resets to idle on click.
      await clickButton('Try again')
      expect([...document.querySelectorAll('button')].some((b) => b.textContent === 'Draw')).toBe(true)
    } finally {
      cleanup()
    }
  })

  test('RPC null response shows "Sent. Checking the chain…" and polls state up to the timeout', async () => {
    const confirm = vi.fn(async (h: string | null) => {
      expect(h).toBeNull()
      // Slow enough that the "Sent. Checking the chain…" state is observable.
      await new Promise((r) => setTimeout(r, 300))
      return 'confirmed' as const
    })
    const c = renderTx({
      label: 'Shield',
      send: async () => {
        throw new Error('Returned null response for request')
      },
      confirm,
      confirmTimeoutMs: 5000,
    })
    try {
      await clickButton('Shield')
      await waitFor(() => expect(c.textContent).toContain('Sent. Checking the chain…'))
      await waitFor(() => expect(c.textContent).toContain('Confirmed on-chain'))
      expect(confirm).toHaveBeenCalledTimes(1)
      // No hash came back, so no explorer link is faked.
      expect(c.querySelector('a')).toBeNull()
      expect(c.textContent).toContain('no explorer link is available')
    } finally {
      cleanup()
    }
  })

  test('RPC null response that never confirms reports UNCONFIRMED instead of retrying blindly', async () => {
    const c = renderTx({
      label: 'Shield',
      send: async () => {
        throw new Error('null response')
      },
      confirm: async () => new Promise<never>(() => {}),
      confirmTimeoutMs: 50,
    })
    try {
      await clickButton('Shield')
      await waitFor(() => expect(c.textContent).toContain('Could not confirm the transaction within 60 s'))
      expect(c.textContent).toContain('UNCONFIRMED')
    } finally {
      cleanup()
    }
  })

  test('reverted confirmation shows the failed reason chip', async () => {
    const c = renderTx({
      label: 'Draw',
      confirm: async () => ({ status: 'failed' as const, reasonCode: 'BELOW_FLOOR' }),
    })
    try {
      await clickButton('Draw')
      await waitFor(() => expect(c.textContent).toContain('below its ICR floor'))
    } finally {
      cleanup()
    }
  })

  test('user rejection in the wallet shows a plain reason, not a stack trace', async () => {
    const c = renderTx({
      label: 'Draw',
      send: async () => {
        throw new Error('User rejected the request')
      },
    })
    try {
      await clickButton('Draw')
      await waitFor(() => expect(c.textContent).toContain('You rejected the request in your wallet'))
    } finally {
      cleanup()
    }
  })

  test('disabledReason disables the button and shows the reason beside it', () => {
    const c = renderTx({ label: 'Run shield()', disabledReason: 'Sign on an agent first.' })
    try {
      const button = c.querySelector('button')!
      expect(button.textContent).toBe('Run shield()')
      expect(button.disabled).toBe(true)
      expect(c.textContent).toContain('Sign on an agent first.')
    } finally {
      cleanup()
    }
  })
})

describe('NetBadge (plan §6.1)', () => {
  test('every network kind renders its label', () => {
    const kinds: Array<[Parameters<typeof NetBadge>[0]['network'], string]> = [
      ['testnet', 'Testnet'],
      ['mainnet-readonly', 'Mainnet (read-only)'],
      ['mainnet-pilot', 'Mainnet pilot'],
      ['synthetic', 'Synthetic'],
    ]
    for (const [network, label] of kinds) {
      const c = renderEl(<NetBadge network={network} />)
      try {
        expect(c.textContent).toContain(label)
      } finally {
        cleanup()
      }
    }
  })
})

describe('ReasonChip', () => {
  test('every plan reason code has a plain sentence', () => {
    for (const code of [
      'NOT_OWNER', 'SESSION_INACTIVE', 'PAYEE_NOT_ALLOWED', 'OVER_PER_TX', 'OVER_BUDGET', 'OVER_DAILY',
      'BELOW_FLOOR', 'RECOVERY_MODE', 'TROVE_NOT_ACTIVE', 'NOT_STRESSED', 'NOTHING_TO_DO', 'COOLDOWN',
      'INTENT_EXPIRED', 'BAD_SIGNATURE', 'BAD_NONCE', 'BELOW_MIN_DEBT', 'REDEMPTION_EXPOSED', 'NEED_MUSD',
    ]) {
      expect(reasonText(code)).not.toBe(reasonText('UNKNOWN'))
      expect(reasonText(code).length).toBeGreaterThan(10)
    }
    const c = renderEl(<ReasonChip code="RECOVERY_MODE" />)
    try {
      expect(c.textContent).toContain('Recovery Mode: new draws are paused')
    } finally {
      cleanup()
    }
  })

  test('reasonCodeFromError finds codes, rejections, and null responses', () => {
    expect(reasonCodeFromError(new Error('reverted: BELOW_FLOOR'))).toBe('BELOW_FLOOR')
    expect(reasonCodeFromError(new Error('User rejected the request'))).toBe('USER_REJECTED')
    expect(reasonCodeFromError(new Error('Returned null response'))).toBe('RPC_NULL_RESPONSE')
    expect(reasonCodeFromError(new Error('something odd'))).toBeNull()
  })
})
