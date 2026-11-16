import { Link } from 'react-router-dom'
import { Card } from '../kit'
import { Skeleton } from '../../ui/Skeleton'
import { useTrove } from '../useTrove'
import { MAINNET_RPC_ERROR_TEXT, RPC_ERROR_TEXT, useAccount, useRadar, useViewedAccount } from '../useAccount'
import { fmt, icrPct as toPct, isNoDebtIcr, pct, demoIcrLabel, troveStatusUnknown } from '../../lib/icr'
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
  // Round 7 (J1 L1) + round 8 (J2 MED-1 / J3 M6): TanStack Query v5 RETAINS
  // data on error — on a sys failure recoveryMode keeps its last good value,
  // so the ON/OFF banners keyed off it would render stale claims beside (or
  // instead of) "Unavailable". Derive the banner state from the error:
  // unknown whenever the sys batch failed (transport OR a per-slot failure,
  // LOW-6) — the ON/OFF banners only render for a KNOWN state. The round-7
  // fix covered only the connected path (sysUnknown was `!demo && ...`):
  // demo mode is the default landing view and the radar is a plain useQuery
  // too, so a demo radar failure after a success retained ON/OFF the same
  // way. In demo the radar IS the sys batch: unknown whenever it errors.
  // Round 8 (J3 L2): on the connected path the banner gates on the
  // RECOVERY slot only (recoverySlotError), never the any-slot OR — a
  // getTCR-only failure must not hide a KNOWN Recovery state.
  const sysUnknown = demo ? radar.isError : (t.sysError || t.recoverySlotError)
  const recoveryKnown = sysUnknown ? undefined : recoveryMode
  // Standby state is UNKNOWN until a wallet is connected, a Governor exists, and the read returns —
  // unknown must never render as "Disarmed".
  const standbyKnown = t.isConnected && !!t.governor && t.standby !== undefined
  const standbyArmed = standbyKnown && !!t.standby?.[3]
  // Round 8 (J3 H1): `loading` was hardcoded `false` outside demo, so the
  // connected ICR card rendered immediately with `icrVal === undefined ?
  // 'No trove'` and the Standby card with `!standbyKnown ? 'Not connected'`
  // on every initial load — no skeleton anywhere in the connected branch,
  // while the TCR card IS gated on tcrLoading. The connected branch loads
  // on t.loading (core + governorOf) exactly like the demo branch loads on
  // its account/radar reads.
  const loading = demo ? acct.isLoading || radar.isLoading || (viewed.reconnecting && viewed.source !== 'param') : t.loading
  // LOW-8: outside demo mode a failed useTrove core read shows the RPC
  // error plate (t.error), never a silent 'No trove' empty. Round 8 (J2
  // LOW-3): the sys batch failed too — same plate, one line, mirroring
  // Home (the failure is already surfaced via the Recovery banner + the
  // ICR/TCR "Unavailable", so this is cosmetic).
  const rpcError = demo ? acct.isError || radar.isError : t.error || t.sysError || t.sysSlotError
  // L6: the demo numbers are not settled while wagmi reconnects — hold the
  // demo cards on skeletons (Close/Open hold their first card the same way).
  // An explicit ?account= preview is the user's choice and shows at once.
  const holdDemo = demo && viewed.reconnecting && viewed.source !== 'param'
  // The TCR value comes from the Radar in demo mode but from useTrove's
  // system-health batch otherwise — gate it on the query that provides it,
  // not on the Radar's state in both modes.
  const tcrLoading = demo ? radar.isLoading : t.sysLoading
  // Round 8 (J3 L2): a getTCR-only slot failure is a failed TCR read —
  // "Unavailable", never "No data". (The old code gated only on the
  // transport error, so a slot failure fell through to "No data".)
  const tcrError = demo ? radar.isError : t.sysError || t.tcrSlotError
  const shield = a?.needed
  const shieldNeeded = !!shield && (shield.repayWanted > 0n || shield.collWanted > 0n)
  // MED-1 (round 4): "No debt" only for a known-active trove. In demo mode
  // the ICR is 2**255 for any zero-debt address — including a never-opened
  // (status 0) or closed (status 2/3/4) one — so the label gates on
  // troveStatus === 1, mirroring demo hasTrove on Home.
  const demoHasTrove = demo && !!a && a.troveStatus === 1
  const hasTrove = demo ? demoHasTrove : t.hasTrove
  // LOW-3 (round 6) + round 7: route the label through demoIcrLabel —
  // the inline version had no > 4 guard, so a future status 5 rendered
  // "No trove" while demoIcrLabel said "Unavailable". An undefined ICR
  // (no trove) still reads "No trove", as before; a zero-debt ICR with a
  // known status 1 is "No debt" via pct(). The demo branch was already
  // status-1-gated via demoHasTrove and is unchanged by this.
  const icrVal = demo ? a?.icr : t.icr
  const icrStatus = demo ? a?.troveStatus : t.troveStatus
  // Round 8 (J3 L7): a failed core slot (e.g. fetchPrice) leaves icr
  // undefined with no transport error — "No trove" would be a false claim
  // about a trove whose numbers merely failed to read. Unavailable, like
  // the RPC-error case.
  const icrLabel = rpcError || (!demo && t.coreSlotError) ? 'Unavailable'
    : icrVal === undefined ? 'No trove'
    : isNoDebtIcr(icrVal) ? demoIcrLabel(icrVal, icrStatus)
    : icrPct === null ? 'No trove' : `${icrPct.toFixed(1)}%`
  return (
    <div className="space-y-8">
      {rpcError && (
        <div className="plate rounded-xl p-4 text-sm" role="alert">{RPC_ERROR_TEXT}</div>
      )}
      {recoveryKnown === true && (
        <div className="plate rounded-xl p-4 text-sm" role="alert">
          <b>Recovery Mode is ON</b> — Mezo system health (TCR) is below 150%, so draws are paused on-chain. Repay or add collateral to continue.
        </div>
      )}
      {/* LOW-6 (round 6) + round 7 (J1 L1) + round 8 (J3 L2): the connected
          sys batch (getTroveStatus / checkRecoveryMode / getTCR) failed, so
          recoveryMode is unknown — say so explicitly, mirroring the Home
          banner (round 4, L-b). Without this the page renders no Recovery
          banner at all and the failure passes silently; the TCR card shows
          "Unavailable" on tcrError (transport OR a getTCR slot failure).
          The banner keys off recoveryKnown, never retained recoveryMode: on
          a sys failure the ON/OFF banners are suppressed even when they
          retain a last good value. */}
      {sysUnknown && (
        <div className="plate rounded-xl p-4 text-sm" role="alert">
          Recovery Mode: <b>Unavailable</b> — the system-health read failed, so this page cannot say whether Recovery Mode is on.
        </div>
      )}
      {recoveryKnown === false && (
        <div className="plate rounded-xl p-4 text-sm">
          <b>Recovery Mode is off.</b> Mezo system health (TCR){tcrPct !== null ? ` is ${tcrPct.toFixed(1)}%` : ''} — above the 150% line, so draws are live.
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-4">
        <Card title={demo ? 'Demo account ICR' : 'Your ICR'}>
          {loading ? <Skeleton className="h-9 w-28" label="Loading ICR" /> : (
            <div className="display text-3xl">{icrLabel}</div>
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
                <div className="display text-3xl">{rpcError ? 'Unavailable' : shieldNeeded ? `Repay ${fmt(shield!.repayWanted)}` : a?.policyError ? 'Unknown' : a?.shieldICR == null ? 'No policy' : a?.needed == null ? 'Unknown' : 'None'}</div>
                <p className="text-xs text-muted mt-1">
                  {rpcError ? RPC_ERROR_TEXT : shieldNeeded
                    ? `Shield would repay ${fmt(shield!.repayWanted)} MUSD${shield!.collWanted > 0n ? ` and add ${fmt(shield!.collWanted, 18, 6)} BTC` : ''} to reach the ${a?.targetICR !== null && a?.targetICR !== undefined ? pct(a.targetICR) : ''} target`
                    : a?.policyError
                      ? 'Shield line unknown — the policy read failed, so this page cannot say where the shield line is.'
                      : a?.shieldICR == null
                      ? 'This account has no Governor policy, so there is no shield line for shield() to defend.'
                      : a?.needed == null
                        ? 'Shield need unknown — the needed() read failed, so this page cannot say whether the shield would fire.'
                        // Round 8 (J1 LOW-2): the reachable-today null case —
                        // getTroveStatus failed but policy/needed() succeeded,
                        // so the ICR card above says "Unavailable" while this
                        // line would claim "No trove". An unreadable status
                        // is "Unavailable", never a claim about the trove.
                        : troveStatusUnknown(icrStatus)
                          ? 'Unavailable — the trove status could not be read, so there may be no ICR to compare with the shield line.'
                          : !hasTrove
                          ? 'No trove — there is no ICR to compare with the shield line, so shield() has nothing to defend.'
                          : `ICR ${demo && isNoDebtIcr(a?.icr) ? 'No debt' : icrPct !== null ? `${icrPct.toFixed(1)}%` : ''} is above the shield line ${pct(a.shieldICR)} — shield() would revert NothingToDo`}
                </p>
              </>
            )
          ) : (
            <>
              {/* Round 8 (J3 H1): while the governorOf read is in flight
                  (t.govLoading) or the Governor batch is (t.gvLoading),
                  standby is unknown — a skeleton / "Checking…", never "Not
                  connected" / "No Governor yet". (Core loading alone does
                  not hide a standby value the Governor batch already
                  returned.) Only a wallet that is genuinely not connected
                  (loading false, isConnected false) reads "Not connected". */}
              <div className="display text-3xl">{t.govError || t.gvError || t.gvSlotError ? 'Unavailable' : t.govLoading || t.gvLoading ? <Skeleton className="h-9 w-28" label="Loading standby" /> : !standbyKnown ? 'Not connected' : standbyArmed && t.standby ? `${fmt(t.standby[0])} MUSD` : 'Disarmed'}</div>
              <p className="text-xs text-muted mt-1">{t.govError || t.gvError || t.gvSlotError ? RPC_ERROR_TEXT : t.govLoading || t.gvLoading ? 'Checking standby state…' : !standbyKnown ? (t.isConnected ? 'No Governor yet — standby lives on your Governor' : 'Connect a wallet to read standby state') : standbyArmed ? 'Armed — defend() can fire' : 'Re-arm on Bridge to enable defend'}</p>
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
            // Round 7 (LOW-10): the floor/defend below are the CONNECTED
            // USER's Governor policy, not the pinned 0.9 Governor's — the
            // old line labelled them "Policy on the live 0.9 Governor" with
            // hardcoded 250%/160% fallbacks and no error gate, so a user
            // whose own floor is 400% saw their 400% attributed to the 0.9
            // Governor, and a failed Governor batch rendered the fallback
            // as if it were a live read. Label the user's Governor, link
            // to it, and render "unknown" when the batch is unreadable.
            <>Policy on your Governor:{' '}
              {/* Round 8 (J3 M3): a governorOf failure renders "unknown"
                  here, never "no Governor yet" — the failure is already
                  gated on the floor/defend below, and the Shield card must
                  not contradict them. While governorOf is still in flight
                  the Governor is unknown, not absent. The floor/defend
                  values gate on gvLoading too: a retained floor is not a
                  live read while the batch is in flight. */}
              {t.govLoading
                ? 'checking…'
                : t.govError
                ? 'unknown'
                : t.governor
                ? <a className="mono ink-link text-magenta text-xs break-all" href={addrUrl(t.governor)} target="_blank" rel="noreferrer">{t.governor}</a>
                : 'no Governor yet'}
              {' '}— floor {t.govError || t.gvError || t.gvSlotError || t.gvLoading ? 'unknown' : t.floor ? pct(t.floor) : 'unknown'} · defend line {t.govError || t.gvError || t.gvSlotError || t.gvLoading ? 'unknown' : t.defend ? pct(t.defend) : 'unknown'}.</>
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
