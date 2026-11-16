import { Link } from 'react-router-dom'
import { Card } from '../kit'
import { Skeleton } from '../../ui/Skeleton'
import { useTrove } from '../useTrove'
import { MAINNET_RPC_ERROR_TEXT, RPC_ERROR_TEXT, useAccount, useRadar, useViewedAccount } from '../useAccount'
import { fmt, icrPct as toPct, isNoDebtIcr, pct } from '../../lib/icr'
import { addrUrl, txUrl } from '../../lib/proofs'
import deployments from '../../../../shared/deployments/testnet.json'

const DEFEND_TX = deployments.sternpost.classicRedeploy.defendTx
const DEFEND_CALLER = deployments.sternpost.classicRedeploy.defend.caller
const GOVERNOR = deployments.sternpost.governor

export default function Watch() {
  const t = useTrove()
  const viewed = useViewedAccount()
  const demo = viewed.demoMode
  // Demo mode: ICR + shield need come from the public demo account, system health from the Radar (plan §6.3).
  const acct = useAccount(demo ? viewed.address : undefined)
  const radar = useRadar('testnet', demo ? viewed.address : undefined)
  const radarMainnet = useRadar('mainnet')
  const a = acct.data
  const icrPct = demo ? toPct(a?.icr) : toPct(t.icr)
  const tcrPct = demo ? toPct(radar.data?.tcr) : toPct(t.tcr)
  const mainnetTcrPct = toPct(radarMainnet.data?.tcr)
  const recoveryMode = demo ? radar.data?.recoveryMode : t.recoveryMode
  // Standby state is UNKNOWN until a wallet is connected, a Governor exists, and the read returns —
  // unknown must never render as "Disarmed".
  const standbyKnown = t.isConnected && !!t.governor && t.standby !== undefined
  const standbyArmed = standbyKnown && !!t.standby?.[3]
  const loading = demo ? acct.isLoading || radar.isLoading || (viewed.reconnecting && viewed.source !== 'param') : false
  // LOW-8: outside demo mode a failed useTrove core read shows the RPC
  // error plate (t.error), never a silent 'No trove' empty.
  const rpcError = demo ? acct.isError || radar.isError : t.error
  // L6: the demo numbers are not settled while wagmi reconnects — hold the
  // demo cards on skeletons (Close/Open hold their first card the same way).
  // An explicit ?account= preview is the user's choice and shows at once.
  const holdDemo = demo && viewed.reconnecting && viewed.source !== 'param'
  // The TCR value comes from the Radar in demo mode but from useTrove's
  // system-health batch otherwise — gate it on the query that provides it,
  // not on the Radar's state in both modes.
  const tcrLoading = demo ? radar.isLoading : t.sysLoading
  const tcrError = demo ? radar.isError : t.sysError
  const shield = a?.needed
  const shieldNeeded = !!shield && (shield.repayWanted > 0n || shield.collWanted > 0n)
  return (
    <div className="space-y-8">
      {rpcError && (
        <div className="plate rounded-xl p-4 text-sm" role="alert">{RPC_ERROR_TEXT}</div>
      )}
      {recoveryMode === true && (
        <div className="plate rounded-xl p-4 text-sm" role="alert">
          <b>Recovery Mode is ON</b> — Mezo system health (TCR) is below 150%, so draws are paused on-chain. Repay or add collateral to continue.
        </div>
      )}
      {recoveryMode === false && (
        <div className="plate rounded-xl p-4 text-sm">
          <b>Recovery Mode is off.</b> Mezo system health (TCR){tcrPct !== null ? ` is ${tcrPct.toFixed(1)}%` : ''} — above the 150% line, so draws are live.
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-4">
        <Card title={demo ? 'Demo account ICR' : 'Your ICR'}>
          {loading ? <Skeleton className="h-9 w-28" label="Loading ICR" /> : (
            <div className="display text-3xl">{rpcError ? 'Unavailable' : isNoDebtIcr(demo ? a?.icr : t.icr) ? 'No debt' : icrPct === null ? 'No trove' : `${icrPct.toFixed(1)}%`}</div>
          )}
          <p className="text-xs text-muted mt-1">Liquidation floor · 110% (Mezo MCR)</p>
        </Card>
        <Card title="System health (TCR)">
          {tcrLoading ? <Skeleton className="h-9 w-28" label="Loading system health" /> : (
            <div className="display text-3xl">{tcrError ? 'Unavailable' : tcrPct === null ? 'No data' : `${tcrPct.toFixed(1)}%`}</div>
          )}
          <p className="text-xs text-muted mt-1">Recovery Mode below 150% (Mezo CCR)</p>
          <p className="text-xs text-muted mt-1">
            {radarMainnet.isLoading ? 'Mainnet (read-only): loading…' : radarMainnet.isError ? 'Mainnet (read-only): unreachable' : mainnetTcrPct !== null ? `Mainnet (read-only): TCR ${mainnetTcrPct.toFixed(1)}%` : 'Mainnet (read-only): no data'}
          </p>
        </Card>
        <Card title={demo ? 'Shield need' : 'Standby heal'}>
          {demo ? (
            loading ? <Skeleton className="h-9 w-28" label="Loading shield state" /> : (
              <>
                <div className="display text-3xl">{rpcError ? 'Unavailable' : shieldNeeded ? `Repay ${fmt(shield!.repayWanted)}` : a?.shieldICR == null ? 'No policy' : a?.needed == null ? 'Unknown' : 'None'}</div>
                <p className="text-xs text-muted mt-1">
                  {rpcError ? RPC_ERROR_TEXT : shieldNeeded
                    ? `Shield would repay ${fmt(shield!.repayWanted)} MUSD${shield!.collWanted > 0n ? ` and add ${fmt(shield!.collWanted, 18, 6)} BTC` : ''} to reach the ${a?.targetICR !== null && a?.targetICR !== undefined ? pct(a.targetICR) : ''} target`
                    : a?.shieldICR == null
                      ? 'This account has no Governor policy, so there is no shield line for shield() to defend.'
                      : a?.needed == null
                        ? 'Shield need unknown — the needed() read failed, so this page cannot say whether the shield would fire.'
                        : `ICR ${demo && isNoDebtIcr(a?.icr) ? 'No debt' : icrPct !== null ? `${icrPct.toFixed(1)}%` : ''} is above the shield line ${pct(a.shieldICR)} — shield() would revert NothingToDo`}
                </p>
              </>
            )
          ) : (
            <>
              <div className="display text-3xl">{t.error || t.gvError ? 'Unavailable' : !standbyKnown ? 'Not connected' : standbyArmed && t.standby ? `${fmt(t.standby[0])} MUSD` : 'Disarmed'}</div>
              <p className="text-xs text-muted mt-1">{t.error || t.gvError ? RPC_ERROR_TEXT : !standbyKnown ? (t.isConnected ? 'No Governor yet — standby lives on your Governor' : 'Connect a wallet to read standby state') : standbyArmed ? 'Armed — defend() can fire' : 'Re-arm on Bridge to enable defend'}</p>
            </>
          )}
        </Card>
      </div>

      {demo && (
        <Card title="Sonar — redemption order (live)">
          {radar.isLoading || holdDemo ? (
            <div className="space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>
          ) : radar.isError ? (
            <p className="text-sm text-signal">{RPC_ERROR_TEXT}</p>
          ) : radar.data ? (
            <div className="text-sm leading-relaxed space-y-2">
              <p>
                {radar.data.rank?.complete
                  ? <>The demo account sits <b>#{String(radar.data.rank.rank)} of {String(radar.data.troveCount)}</b> from redemption, with <b>{fmt(radar.data.rank.debtAhead)} MUSD</b> of redeemable debt ahead of it.</>
                  : <>The demo account&apos;s rank did not resolve within the walked steps — its position is unknown, not safe.</>}
              </p>
              <p className="text-muted">
                Frontier trove{' '}
                {radar.data.frontier ? <><a className="ink-link mono text-xs" href={addrUrl(radar.data.frontier.trove)} target="_blank" rel="noreferrer">{radar.data.frontier.trove.slice(0, 6)}…{radar.data.frontier.trove.slice(-4)}</a> at {pct(radar.data.frontier.icr, 1)} with {fmt(radar.data.frontier.debt)} MUSD of debt</> : 'unknown'}.
                Testnet ranks are synthetic: one 426M MUSD trove sits at the frontier. See Mainnet for the real picture.
              </p>
              <p className="text-muted">Mainnet (read-only): {radarMainnet.data ? `${String(radarMainnet.data.troveCount)} troves, TCR ${mainnetTcrPct !== null ? `${mainnetTcrPct.toFixed(1)}%` : 'unknown'}` : radarMainnet.isError ? MAINNET_RPC_ERROR_TEXT : 'loading…'}</p>
            </div>
          ) : <p className="text-sm text-muted">Radar not readable.</p>}
        </Card>
      )}

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
          {demo ? (
            <>Policy on the demo account:{' '}
              <a className="mono ink-link text-magenta text-xs break-all" href={addrUrl(viewed.address)} target="_blank" rel="noreferrer">{viewed.address}</a>
              {' '}— floor {a?.floorICR !== null && a?.floorICR !== undefined ? pct(a.floorICR) : 'unknown'} · shield line {a?.shieldICR !== null && a?.shieldICR !== undefined ? pct(a.shieldICR) : 'unknown'} · target {a?.targetICR !== null && a?.targetICR !== undefined ? pct(a.targetICR) : 'unknown'}.</>
          ) : (
            <>Policy on the live 0.9 Governor:{' '}
              <a className="mono ink-link text-magenta text-xs break-all" href={addrUrl(GOVERNOR)} target="_blank" rel="noreferrer">{GOVERNOR}</a>
              {' '}— floor {t.floor ? pct(t.floor) : '250% (policy)'} · defend line {t.defend ? pct(t.defend) : '160% (policy)'}.</>
          )}
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
