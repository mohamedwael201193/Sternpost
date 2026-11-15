import { Link } from 'react-router-dom'
import { Card } from '../kit'
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

export default function Open() {
  return (
    <div className="space-y-8">
      <Card title="Open a credit account — three steps, all live today">
        <ol className="text-sm leading-relaxed space-y-3 list-decimal pl-5">
          <li>
            <b>Open a trove on Mezo testnet.</b> Deposit testnet BTC and borrow MUSD at{' '}
            <a className="ink-link text-magenta" href="https://testnet.mezo.org" target="_blank" rel="noreferrer">testnet.mezo.org ↗</a>.
            Your Bitcoin stays in your trove; Sternpost never holds it.
          </li>
          <li>
            <b>Create a Governor on Bridge.</b> <Link className="ink-link text-magenta" to="/app">Back on Bridge →</Link>{' '}
            set your floor (draws stop below it) and your defend line (a stranger may repay from your buffer below it).
            One transaction deploys your Governor from the Factory below. This step only appears on Bridge once you
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
          in <span className="mono">contracts/src/account/TroveAccountFactory.sol</span> but the factory is{' '}
          <b>not deployed on testnet yet</b>. There is no deploy button here until it is; the three steps above are
          the live path today.
        </p>
      </Card>

      <Card title="Live deployment — Mezo testnet 31611" aside={<span className="caps text-[10px] text-safe">Verified · block 16794393</span>}>
        <dl className="text-sm space-y-3">
          <div><dt className="text-muted">Factory</dt><dd className="mt-1"><Addr a={FACTORY} /></dd><dd className="mt-1"><a className="mono ink-link text-magenta text-xs break-all" href={txUrl(FACTORY_TX)} target="_blank" rel="noreferrer">Deploy tx {FACTORY_TX} ↗</a></dd></div>
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
