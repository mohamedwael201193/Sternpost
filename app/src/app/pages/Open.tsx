import { Link } from 'react-router-dom'
import { Card } from '../kit'
import { addrUrl, txUrl } from '../../lib/proofs'

const FACTORY = '0x39779A8678424CF78c841F9AfEa1EAFF3Cf7F6d8'
const FACTORY_TX = '0x1c66a1c572024a808645abbb7163496c4b7252c800246a1b9aabc6f303cbd1e1'
const GOVERNOR = '0x1bF45cFE654a397F4FF3B33bC1b157c88Ee71F38'
const ROUTER = '0xd6833f811e987f06a1e55a435d4be38c6d4188d4'
const SPEND_WALLET = '0x4F878203175B1BB6C63Ec02CEEBE1af4A7c9Ee4a'

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
            One transaction deploys your Governor from the Factory below.
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
