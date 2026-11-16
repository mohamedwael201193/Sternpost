import { Link } from 'react-router-dom'
import { useAccount as useWagmiAccount } from 'wagmi'
import type { Address } from 'viem'
import { Card } from '../kit'
import { Skeleton } from '../../ui/Skeleton'
import { RPC_ERROR_TEXT, useAccount, useOwnAccount, useViewedAccount } from '../useAccount'
import { fmt, pct, demoIcrLabel } from '../../lib/icr'
import { DEMO_ACCOUNT_BADGE, LAB_DEMO_ACCOUNT } from '../../lib/chain'
import { addrUrl, txUrl } from '../../lib/proofs'
import deployments from '../../../../shared/deployments/testnet.json'

const FACTORY = deployments.sternpost.SternpostFactory.address
const FACTORY_TX = deployments.sternpost.SternpostFactory.tx
const GOVERNOR = deployments.sternpost.governor
const ROUTER = deployments.sternpost.SternpostRouter.address
const SPEND_WALLET = deployments.sternpost.spendWallet

function Addr({ a }: { a: string }) {
  return <a className="mono ink-link text-magenta text-xs break-all" href={addrUrl(a)} target="_blank" rel="noreferrer">{a} ↗</a>
}

/** The live position card for one account: the demo/previewed account in demo mode, the user's own when connected. */
function OpenAccountCard({ address, title, badge, note }: { address: Address; title: string; badge?: string | null; note: string }) {
  const acct = useAccount(address)
  const a = acct.data
  return (
    <Card title={title} aside={badge ? <span className="caps text-[10px] text-muted">{badge}</span> : undefined}>
      {acct.isLoading ? (
        <div className="space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>
      ) : acct.isError ? (
        <p className="text-sm text-signal">{RPC_ERROR_TEXT}</p>
      ) : a ? (
        <div className="text-sm space-y-2">
          <div><a className="mono ink-link text-magenta text-xs break-all" href={addrUrl(address)} target="_blank" rel="noreferrer">{address} ↗</a></div>
          {/* MED-1 (round 5): pct() says "No debt" for any zero-debt ICR —
              never pair "not active" with "No debt": a known non-active
              trove reads "No trove", an unreadable status "Unavailable". */}
          <div>ICR <b className="mono">{demoIcrLabel(a.icr, a.troveStatus)}</b> · collateral <b className="mono">{fmt(a.coll, 18, 6)} BTC</b> · debt <b className="mono">{fmt(a.debt)} MUSD</b> · status <b>{a.troveStatus === 1 ? 'active' : a.troveStatus === null ? 'Unavailable' : 'not active'}</b></div>
          <div>Policy: floor {a.floorICR !== null ? pct(a.floorICR) : 'unknown'} · shield {a.shieldICR !== null ? pct(a.shieldICR) : 'unknown'} · target {a.targetICR !== null ? pct(a.targetICR) : 'unknown'}</div>
          <p className="text-muted">{note}</p>
        </div>
      ) : <p className="text-sm text-muted">Account not readable.</p>}
    </Card>
  )
}

export default function Open() {
  const viewed = useViewedAccount()
  const { address: walletAddress, isConnected } = useWagmiAccount()
  // Connected with no ?account= preview: the demo account's numbers are NOT
  // the user's own — show their own account, or the no-account CTA (§6.4.1).
  const preview = viewed.source === 'param'
  const own = useOwnAccount(!viewed.demoMode && isConnected ? walletAddress : undefined)
  // LOW-3: hold the demo branch while wagmi reconnects on a hard load —
  // show a skeleton, never demo numbers for a wallet that is coming back.
  // An explicit ?account= preview shows at once.
  const firstCard = viewed.reconnecting && !preview
    ? (
      <Card title="Your account — live on testnet">
        <div className="space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>
      </Card>
    )
    : !viewed.demoMode
    ? own.isLoading
      ? (
        <Card title="Your account — live on testnet">
          <div className="space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>
        </Card>
      )
      : own.isError
        ? (
          <Card title="Your account — live on testnet">
            <p className="text-sm text-signal">{RPC_ERROR_TEXT}</p>
          </Card>
        )
        : !own.data
          ? (
            <Card title="Your account — live on testnet">
              <p className="text-sm leading-relaxed">You have no credit account yet. Open one in about two minutes.</p>
              <p className="text-sm text-muted mt-2">Start with step 1 below — open a trove on Mezo testnet, then create your Governor here.</p>
            </Card>
          )
          : <OpenAccountCard address={own.data} title="Your account — live on testnet" badge={own.data === LAB_DEMO_ACCOUNT ? DEMO_ACCOUNT_BADGE : null} note="This is your account, read live from Mezo testnet. One-transaction open would create an account like this one for you." />
    : (
      <OpenAccountCard
        address={viewed.address}
        title={preview ? 'Previewed account — live on testnet' : 'Demo account — live on testnet'}
        badge={viewed.isLabPrototype ? DEMO_ACCOUNT_BADGE : null}
        note={preview
          ? 'This is the account you are previewing (read-only demo). One-transaction open would create an account like this one for you.'
          : 'This is the account demo mode shows on every page. One-transaction open would create an account like this one for you.'}
      />
    )
  return (
    <div className="space-y-8">
      {firstCard}

      <Card title="Open a credit account — the live path today, in three steps">
        <ol className="text-sm leading-relaxed space-y-3 list-decimal pl-5">
          <li>
            <b>Open a trove on Mezo testnet.</b> Deposit testnet BTC and borrow MUSD at{' '}
            <a className="ink-link text-magenta" href="https://testnet.mezo.org" target="_blank" rel="noreferrer">testnet.mezo.org ↗</a>.
            Your Bitcoin stays in your trove; Sternpost never holds it.
          </li>
          <li>
            <b>Create a Governor on Bridge.</b> <Link className="ink-link text-magenta" to="/app">Back on Bridge →</Link>{' '}
            set your floor (draws stop below it) and your defend line (a stranger may repay from your buffer below it).
            One transaction deploys your Governor from the Governor factory below. This step only appears on Bridge once you
            already have a trove and no Governor yet — open the trove first (step 1), then come back.
          </li>
          <li>
            <b>Give your crew budgets.</b> <Link className="ink-link text-magenta" to="/app/crew">Crew →</Link>{' '}
            authorizes an app or agent with a budget, a per-draw cap, and a locked payee. It can never take more.
          </li>
        </ol>
      </Card>

      <Card title="One-transaction open — coming, not live">
        <p className="text-sm leading-relaxed">
          The Wave 2 TroveAccount open — one transaction deploys your account and opens your trove — is implemented
          in <span className="mono">contracts/src/account/TroveAccountFactory.sol</span> and the factory is{' '}
          deployed on testnet (Shield redeploy 2026-11-16, Factory <span className="mono">0x46442898…</span>),
          but no production account has opened a trove yet (demo BLOCKED on funding). There is no live open button
          here until that changes; the three steps above are the live path today.
        </p>
      </Card>

      <Card title="Live deployment — Mezo testnet 31611" aside={<span className="caps text-[10px] text-safe">Verified · block 16794393</span>}>
        <dl className="text-sm space-y-3">
          <div><dt className="text-muted">SternpostFactory (Governor factory)</dt><dd className="mt-1"><Addr a={FACTORY} /></dd><dd className="mt-1"><a className="mono ink-link text-magenta text-xs break-all" href={txUrl(FACTORY_TX)} target="_blank" rel="noreferrer">Deploy tx {FACTORY_TX} ↗</a></dd></div>
          <div><dt className="text-muted">Governor (0.9 demo)</dt><dd className="mt-1"><Addr a={GOVERNOR} /></dd></div>
          <div><dt className="text-muted">Router</dt><dd className="mt-1"><Addr a={ROUTER} /></dd></div>
          <div><dt className="text-muted">Spend wallet</dt><dd className="mt-1"><Addr a={SPEND_WALLET} /></dd></div>
        </dl>
        <p className="text-sm mt-4">
          Every claim on this site with its transaction is on <Link className="ink-link text-magenta" to="/prove-it">Prove it</Link>.
        </p>
      </Card>
    </div>
  )
}
