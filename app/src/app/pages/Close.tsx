import { Link } from 'react-router-dom'
import { useAccount as useWagmiAccount } from 'wagmi'
import type { Address } from 'viem'
import { Card } from '../kit'
import { Skeleton } from '../../ui/Skeleton'
import { RPC_ERROR_TEXT, useAccount, useOwnAccount, useRadar, useViewedAccount } from '../useAccount'
import { fmt, pct, demoIcrLabel, troveStatusText, troveStatusUnknown } from '../../lib/icr'
import { DEMO_ACCOUNT_BADGE, LAB_DEMO_ACCOUNT } from '../../lib/chain'
import { addrUrl, txUrl } from '../../lib/proofs'
import deployments from '../../../../shared/deployments/testnet.json'

const REVOKE_TX = deployments.liveFlow.txs.find((t) => t.step.startsWith('revoke()'))?.hash ?? ''
const UNFREEZE_TX = deployments.sternpost.classicRedeploy.defend.flow.find((t) => t.step.startsWith('unfreeze()'))?.hash ?? ''

export default function Close() {
  const viewed = useViewedAccount()
  const { address: walletAddress, isConnected } = useWagmiAccount()
  // Connected with no ?account= preview: the demo account's numbers are NOT
  // the user's own — show their own account, or the no-account CTA (§6.4.1).
  const preview = viewed.source === 'param'
  const own = useOwnAccount(!viewed.demoMode && isConnected ? walletAddress : undefined)
  // LOW-3: on a hard load wagmi is still reconnecting, so isConnected is
  // false and demoMode is true — but the wallet is about to come back. Hold
  // the demo branch and show a skeleton instead of flashing demo numbers.
  // An explicit ?account= preview is the user's choice: show it at once.
  if (viewed.reconnecting && !preview) {
    return (
      <div className="space-y-8">
        <Card title="Your account — live close position">
          <div className="space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>
        </Card>
        <CloseExplainer />
      </div>
    )
  }
  if (!viewed.demoMode) {
    if (own.isLoading) {
      return (
        <div className="space-y-8">
          <Card title="Your account — live close position">
            <div className="space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>
          </Card>
          <CloseExplainer />
        </div>
      )
    }
    if (own.isError) {
      return (
        <div className="space-y-8">
          <Card title="Your account — live close position">
            <p className="text-sm text-signal">{RPC_ERROR_TEXT}</p>
          </Card>
          <CloseExplainer />
        </div>
      )
    }
    if (!own.data) {
      return (
        <div className="space-y-8">
          <Card title="Your account — live close position">
            <p className="text-sm leading-relaxed">You have no credit account yet. Open one in about two minutes.</p>
            <p className="text-sm mt-3"><Link className="pill" to="/app/open">Open a credit account →</Link></p>
          </Card>
          <CloseExplainer />
        </div>
      )
    }
    return (
      <div className="space-y-8">
        <ClosePosition address={own.data} title="Your account — live close position" badge={own.data === LAB_DEMO_ACCOUNT ? DEMO_ACCOUNT_BADGE : null} readOnlyNote="Closing is owner-only; only the owner wallet can close this account." />
        <CloseExplainer />
      </div>
    )
  }
  // Demo mode: disconnected (the public demo account) or a ?account= preview.
  // The LAB PROTOTYPE badge marks the lab fallback; a preview is labelled by
  // the DemoBanner, and the copy never claims the preview is "in demo mode".
  return (
    <div className="space-y-8">
      <ClosePosition
        address={viewed.address}
        title={preview ? 'Previewed account — live close position' : 'Demo account — live close position'}
        badge={viewed.isLabPrototype ? DEMO_ACCOUNT_BADGE : null}
        readOnlyNote={preview
          ? 'Closing is owner-only; this preview is read-only — connect the owner wallet to close it.'
          : 'Closing is owner-only; in demo mode this account is read-only.'}
      />
      <CloseExplainer />
    </div>
  )
}

/**
 * The live close position for one account. Recovery Mode is a safety boolean:
 * it renders only on an explicit `=== true` / `=== false` read — a failed or
 * missing radar read renders "Unavailable", never "off" (an undefined read
 * must never assert the system is safe).
 */
function ClosePosition({ address, title, badge, readOnlyNote }: { address: Address; title: string; badge?: string | null; readOnlyNote: string }) {
  const acct = useAccount(address)
  const radar = useRadar('testnet', address)
  const a = acct.data
  // Round 8 (J2 MED-1 / J3 M6): TanStack Query v5 RETAINS data on error —
  // a radar failure after a success keeps the last recoveryMode, so the
  // retained 'ON — closeAccount() would revert' / 'off' would render beside
  // the RPC-error plate. A failed radar read means the Recovery state is
  // unknown, never the last good value.
  const recovery = radar.isError ? undefined : radar.data?.recoveryMode
  return (
    <Card title={title} aside={badge ? <span className="caps text-[10px] text-muted">{badge}</span> : undefined}>
      {acct.isLoading || radar.isLoading ? (
        <div className="space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>
      ) : acct.isError ? (
        <p className="text-sm text-signal">{RPC_ERROR_TEXT}</p>
      ) : a ? (
        <div className="text-sm space-y-2">
          <div><a className="mono ink-link text-magenta text-xs break-all" href={addrUrl(address)} target="_blank" rel="noreferrer">{address} ↗</a></div>
          {/* MED-1 (round 4): pct() says "No debt" for any zero-debt ICR —
              never pair "not active" with "No debt": a known non-active
              trove reads "No trove", an unreadable status "Unavailable". */}
          <div>Trove <b>{troveStatusText(a.troveStatus)}</b> · ICR <b className="mono">{demoIcrLabel(a.icr, a.troveStatus)}</b> · debt <b className="mono">{fmt(a.debt)} MUSD</b> · MUSD on the account <b className="mono">{a.balances.musd !== null ? `${fmt(a.balances.musd)} MUSD` : 'unknown'}</b></div>
          <div>Recovery Mode <b>{recovery === true ? 'ON — closeAccount() would revert' : recovery === false ? 'off' : 'Unavailable'}</b> · system health (TCR) <b className="mono">{radar.isError || !radar.data ? 'Unavailable' : pct(radar.data.tcr, 1)}</b></div>
          {radar.isError && <p className="text-sm text-signal">{RPC_ERROR_TEXT}</p>}
          <p className="text-muted">
            {a.troveStatus === 1
              ? `Closing would repay the full ${fmt(a.debt)} MUSD debt from the account's MUSD + sMUSD and return the ${fmt(a.coll, 18, 6)} BTC collateral to the owner.`
              : troveStatusUnknown(a.troveStatus)
                ? 'The trove status could not be read, so what closeAccount() would do is unknown — the status read failed, it is not "not active".'
                : 'The trove is not active, so closeAccount() would take the surplus-claim path.'}{' '}
            {readOnlyNote}
          </p>
        </div>
      ) : <p className="text-sm text-muted">Account not readable.</p>}
    </Card>
  )
}

function CloseExplainer() {
  return (
    <>
      <Card title="Close the account — what happens" aside={<span className="caps text-[10px] text-muted">Contract code · task 1.3</span>}>
        <p className="text-sm leading-relaxed">
          <span className="mono">closeAccount()</span> is implemented in TroveAccount
          (<span className="mono">contracts/src/account/TroveAccount.sol</span>, merged task 1.3) and covered by unit
          tests (mock Mezo) — <span className="mono">contracts/test/account/TroveAccount.t.sol:559-666</span>;
          there are zero <span className="mono">closeAccount</span> tests in <span className="mono">contracts/test/fork/</span>.
          The account contracts are deployed on testnet (Shield redeploy 2026-11-16,
          implementation <span className="mono">0x02Dda72b…</span>), but no production close has run
          (demo account BLOCKED on funding), so there is no live close transaction to show —
          the behaviour below is the merged contract code, not a demo.
        </p>
        <ol className="text-sm leading-relaxed mt-4 space-y-2 list-decimal pl-5">
          <li>Revokes every agent session first, so nothing can draw while the account closes.</li>
          <li>If the trove is still active: unparks any sMUSD back to MUSD, then repays the full debt and closes the trove on Mezo. The account must hold at least debt minus 200 MUSD (the gas compensation Mezo keeps) or the call reverts with <span className="mono">NeedMusd</span>.</li>
          <li>If the trove was closed by redemption: claims the surplus collateral from Mezo&apos;s CollSurplusPool.</li>
          <li>Sends all remaining BTC and MUSD to the owner and emits <span className="mono">Closed</span>.</li>
        </ol>
        <p className="text-sm leading-relaxed mt-4">
          Closing is owner-only. There is no fee to Sternpost for closing.
        </p>
      </Card>

      <Card title="Blocked in Recovery Mode — the honest exception" aside={<span className="caps text-[10px] text-signal">Exception</span>}>
        <p className="text-sm leading-relaxed">
          When Mezo is in Recovery Mode (system health below 150%), <span className="mono">closeAccount()</span>{' '}
          reverts. An active trove cannot be closed until the system recovers — repay or add collateral first, then
          close. This is on-chain behaviour, not a UI limit. Live Recovery Mode state is on{' '}
          <Link className="ink-link text-magenta" to="/app/watch">Watch</Link>.
        </p>
      </Card>

      <Card title="Redemption — if Mezo redeems the trove">
        <p className="text-sm leading-relaxed">
          Mezo redemptions repay the debt of the lowest-ratio troves first, at a 0.75% fee, and are blocked while
          system health is below the 110% minimum.{' '}
          <a className="ink-link text-magenta" href="https://mezo.org/docs/developers/musd/musd-redemptions/" target="_blank" rel="noreferrer">Mezo docs state the 0.75% redemption fee and the 110% minimum ↗</a>;{' '}
          the same 110% is the <span className="mono">MCR = 1.1e18</span> constant in{' '}
          <span className="mono">contracts/src/account/TroveAccount.sol</span>. A fully redeemed trove leaves its surplus BTC claimable from
          Mezo&apos;s CollSurplusPool. <span className="mono">closeAccount()</span> handles that case: it claims the
          surplus — and it does not brick when the surplus is zero or was already claimed (a fork-found fix in task
          1.6: the live CollSurplusPool reverts on an empty claim, so the account reads the surplus first and skips
          the claim when there is nothing to claim).
        </p>
        <p className="text-sm leading-relaxed mt-3">
          No redemption has hit the 0.9 trove, so there is no redemption transaction to show for it. Lab notes
          mention a V3 trove fully redeemed on testnet, but that was a different trove and no transaction was
          recorded — treat it as an unverified lab anecdote, not proof. The handling above is contract code plus unit tests (mock Mezo), with the
          empty-claim fix found on a mainnet fork in task 1.6.
        </p>
      </Card>

      <Card title="Need out now? Revoke first">
        <p className="text-sm leading-relaxed">
          Revoking is the available-now exit while the account contract is undeployed: it freezes the Governor and
          burns the shared Mezo nonce, so every outstanding signature dies at once. The same{' '}
          <span className="mono">revoke()</span> code is proven on the Wave-1 Governor (tx{' '}
          <a className="mono ink-link text-magenta text-xs break-all" href={txUrl(REVOKE_TX)} target="_blank" rel="noreferrer">0xf0763cf4… ↗</a>, block 16310274); on the 0.9 Governor,{' '}
          <span className="mono">unfreeze()</span> is proven (tx{' '}
          <a className="mono ink-link text-magenta text-xs break-all" href={txUrl(UNFREEZE_TX)} target="_blank" rel="noreferrer">0x0097174d… ↗</a>, block
          16794548) but <span className="mono">revoke()</span> itself has not been called yet.{' '}
          <Link className="ink-link text-magenta" to="/app/revoke">Go to Revoke →</Link>
        </p>
      </Card>
    </>
  )
}
