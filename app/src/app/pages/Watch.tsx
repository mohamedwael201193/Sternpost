import { Link } from 'react-router-dom'
import { Card } from '../kit'
import { useTrove } from '../useTrove'
import { fmt, pct, WAD } from '../../lib/icr'
import { addrUrl, txUrl } from '../../lib/proofs'
import deployments from '../../../../shared/deployments/testnet.json'

const DEFEND_TX = deployments.sternpost.classicRedeploy.defendTx
const DEFEND_CALLER = deployments.sternpost.classicRedeploy.defend.caller
const GOVERNOR = deployments.sternpost.governor

const toPct = (v?: bigint) => (v === undefined ? null : v >= 2n ** 200n ? 999 : Number((v * 10000n) / WAD) / 100)

export default function Watch() {
  const t = useTrove()
  const tcrPct = toPct(t.tcr)
  const icrPct = toPct(t.icr)
  // Standby state is UNKNOWN until a wallet is connected, a Governor exists, and the read returns —
  // unknown must never render as "Disarmed".
  const standbyKnown = t.isConnected && !!t.governor && t.standby !== undefined
  const standbyArmed = standbyKnown && !!t.standby?.[3]
  return (
    <div className="space-y-8">
      {t.recoveryMode === true && (
        <div className="plate rounded-xl p-4 text-sm" role="alert">
          <b>Recovery Mode is ON</b> — Mezo system health (TCR) is below 150%, so draws are paused on-chain. Repay or add collateral to continue.
        </div>
      )}
      {t.recoveryMode === false && (
        <div className="plate rounded-xl p-4 text-sm">
          <b>Recovery Mode is off.</b> Mezo system health (TCR){tcrPct !== null ? ` is ${tcrPct.toFixed(1)}%` : ''} — above the 150% line, so draws are live.
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-4">
        <Card title="Your ICR">
          <div className="display text-3xl">{icrPct === null ? '—' : `${icrPct.toFixed(1)}%`}</div>
          <p className="text-xs text-muted mt-1">Liquidation floor · 110%</p>
        </Card>
        <Card title="System health (TCR)">
          <div className="display text-3xl">{tcrPct === null ? '—' : `${tcrPct.toFixed(1)}%`}</div>
          <p className="text-xs text-muted mt-1">Recovery Mode below 150%</p>
        </Card>
        <Card title="Standby heal">
          <div className="display text-3xl">{!standbyKnown ? '—' : standbyArmed && t.standby ? `${fmt(t.standby[0])} MUSD` : 'Disarmed'}</div>
          <p className="text-xs text-muted mt-1">{!standbyKnown ? (t.isConnected ? 'No Governor yet — standby lives on your Governor' : 'Connect a wallet to read standby state') : standbyArmed ? 'Armed — defend() can fire' : 'Re-arm on Bridge to enable defend'}</p>
        </Card>
      </div>

      <Card title="Shield — a stranger defends your trove" aside={<span className="caps text-[10px] text-magenta">In progress · task 1.4</span>}>
        <p className="text-sm leading-relaxed">
          <b>shield() is IN PROGRESS on the production contracts.</b> It is implemented in the Shield workstream
          (task 1.4, plan §3.7) and is not yet in the production TroveAccount — the production contract exposes
          only the <span className="mono">needed()</span> view the shield will use. Nothing below is presented as live.
        </p>
        <p className="text-sm leading-relaxed mt-3">
          When it lands, anyone — a keeper, a stranger EOA — may call <span className="mono">shield()</span> with no
          signature and no nonce. It would fire on any of three triggers: ICR below the shield line, redeemable debt ahead
          of the trove (rank), or TCR below 155% (Recovery Mode approaching). It would repay toward the target ICR from the
          MUSD balance, then from sMUSD, and close the remaining gap by adding collateral from reserve BTC. It would never
          draw. It is designed to keep working in Recovery Mode. The bounty would be paid only when the ICR improves by at least 0.5
          percentage points or the value added is at least 10× the bounty, and at most once per cooldown.
        </p>
        <p className="text-sm leading-relaxed mt-3">
          Policy on the live 0.9 Governor:{' '}
          <a className="mono ink-link text-magenta text-xs break-all" href={addrUrl(GOVERNOR)} target="_blank" rel="noreferrer">{GOVERNOR}</a>
          {' '}— floor {t.floor ? pct(t.floor) : '250% (policy)'} · defend line {t.defend ? pct(t.defend) : '160% (policy)'}.
        </p>
      </Card>

      <Card title="defend() — VERIFIED on testnet" aside={<span className="caps text-[10px] text-safe">Verified · block 16794538</span>}>
        <p className="text-sm leading-relaxed">
          A stranger defended the 0.9 Governor trove. The caller was a fresh single-use outside EOA — not the
          borrower — funded with 0.0002 BTC for gas only. It repaid <b>30 MUSD</b> and moved the ICR from{' '}
          <b>2.3791 → 2.4081</b>. Buffer went 30 → 0 MUSD, standby nonce 44 → 45, and the trove was unfrozen after.
          The trigger was a raised policy line (setPolicy 2.5 / 2.4 while ICR was 2.377), not a price move; policy was
          restored to floor 2.5 / defend 1.6 afterwards.
        </p>
        <dl className="text-sm mt-4 space-y-2">
          <div className="flex flex-wrap gap-2"><dt className="text-muted w-28 shrink-0">Transaction</dt><dd><a className="mono ink-link text-magenta text-xs break-all" href={txUrl(DEFEND_TX)} target="_blank" rel="noreferrer">{DEFEND_TX} ↗</a></dd></div>
          <div className="flex flex-wrap gap-2"><dt className="text-muted w-28 shrink-0">Caller</dt><dd><a className="mono ink-link text-magenta text-xs break-all" href={addrUrl(DEFEND_CALLER)} target="_blank" rel="noreferrer">{DEFEND_CALLER} ↗</a></dd></div>
          <div className="flex flex-wrap gap-2"><dt className="text-muted w-28 shrink-0">Block</dt><dd className="mono text-xs">16794538 · Mezo testnet 31611</dd></div>
          <div className="flex flex-wrap gap-2"><dt className="text-muted w-28 shrink-0">Governor</dt><dd><a className="mono ink-link text-magenta text-xs break-all" href={addrUrl(GOVERNOR)} target="_blank" rel="noreferrer">{GOVERNOR} ↗</a></dd></div>
        </dl>
        <p className="text-sm mt-4">
          Every step of that run — fund, rearm, trigger, defend, unfreeze, restore — is listed in{' '}
          <Link className="ink-link text-magenta" to="/prove-it">Prove it</Link>.
        </p>
      </Card>

      <Card title="Recovery Mode — what it does">
        <p className="text-sm leading-relaxed">
          When Mezo&apos;s total collateral ratio (TCR) falls below 150%, the system enters Recovery Mode: draws are
          paused on-chain until health recovers. Repay or add collateral to continue. The shield is designed to keep working in
          Recovery Mode; closing an account does not — <span className="mono">closeAccount()</span> reverts while
          Recovery Mode is on. See <Link className="ink-link text-magenta" to="/app/close">Close / Revoke</Link>.
        </p>
      </Card>
    </div>
  )
}
