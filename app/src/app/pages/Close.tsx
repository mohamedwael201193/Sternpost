import { Link } from 'react-router-dom'
import { Card } from '../kit'
import { txUrl } from '../../lib/proofs'
import deployments from '../../../../shared/deployments/testnet.json'

const REVOKE_TX = deployments.liveFlow.txs.find((t) => t.step.startsWith('revoke()'))?.hash ?? ''
const UNFREEZE_TX = deployments.sternpost.classicRedeploy.defend.flow.find((t) => t.step.startsWith('unfreeze()'))?.hash ?? ''

export default function Close() {
  return (
    <div className="space-y-8">
      <Card title="Close the account — what happens" aside={<span className="caps text-[10px] text-muted">Contract code · task 1.3</span>}>
        <p className="text-sm leading-relaxed">
          <span className="mono">closeAccount()</span> is implemented in TroveAccount
          (<span className="mono">contracts/src/account/TroveAccount.sol</span>, merged task 1.3) and covered by unit
          tests (mock Mezo) — <span className="mono">contracts/test/account/TroveAccount.t.sol:559-666</span>;
          there are zero <span className="mono">closeAccount</span> tests in <span className="mono">contracts/test/fork/</span>.
          The account contract is not deployed on testnet yet, so there is no live close transaction to show —
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
    </div>
  )
}
