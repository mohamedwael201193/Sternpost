import { Link } from 'react-router-dom'
import { useWriteContract } from 'wagmi'
import { forwardRef, useMemo, useRef, useState, type ReactNode } from 'react'
import { Dial } from '../../ui/Dial'
import { Compass } from '../../ui/Compass'
import { RouteLines, type Link as RouteLink } from '../../ui/RouteLines'
import { DrawHero } from '../DrawHero'
import { Token } from '../../ui/Token'
import { Skeleton } from '../../ui/Skeleton'
import { Card, Empty, NeedsWallet, TxStatus, useTx } from '../kit'
import { useTrove, TROVE_STATUS_LABEL } from '../useTrove'
import { RPC_ERROR_TEXT, useAccount, useOwnAccount, useRadar, useViewedAccount } from '../useAccount'
import { fmt, icrPct, isNoDebtIcr, pct, demoIcrLabel, WAD } from '../../lib/icr'
import { DEMO_ACCOUNT_BADGE, STERNPOST } from '../../lib/chain'
import { factoryAbi } from '../../lib/abi'
import { addrUrl } from '../../lib/proofs'
import { useApiList } from '../api'

export default function Home() {
  const t = useTrove()
  const viewed = useViewedAccount()
  const demo = viewed.demoMode
  // J1 LOW-c: a connected wallet without a credit account gets the same
  // no-account CTA as Close/Open (same text, links to /app/open).
  const own = useOwnAccount(!demo && t.isConnected ? t.address : undefined)
  // Demo mode: every number below is a live read of the public demo account (plan §6.3).
  const acct = useAccount(demo ? viewed.address : undefined)
  const radar = useRadar('testnet', demo ? viewed.address : undefined)
  const a = acct.data
  const coll = demo ? a?.coll : t.coll
  const debt = demo ? a?.debt : t.debt
  const price = demo ? a?.price : t.price
  const icrV = demo ? a?.icr : t.icr
  const floorV = demo ? (a?.floorICR ?? undefined) : t.floor
  const hasTrove = demo ? !!a && a.troveStatus === 1 : t.hasTrove
  // L6: while wagmi reconnects on a hard load the demo numbers are not
  // settled yet — hold the page on skeletons, exactly like Close/Open hold
  // their first card. An explicit ?account= preview is the user's choice and
  // shows at once.
  const holdDemo = demo && viewed.reconnecting && viewed.source !== 'param'
  const loading = demo ? acct.isLoading || holdDemo : t.loading
  // The top error plate covers EITHER failed read: a radar failure must not
  // pass silently (it hides the Recovery banner). The numbers below gate
  // only on the account read — a radar failure leaves them readable.
  // LOW-8: outside demo mode a failed useTrove core read shows this plate
  // (t.error), never a silent 'No trove'/'No Governor' empty.
  // L-b (round 4): the sys batch (getTroveStatus / checkRecoveryMode /
  // getTCR) failing must surface too — otherwise recoveryMode is undefined,
  // no Recovery banner renders, and the failure passes silently.
  const rpcError = demo ? acct.isError || radar.isError : t.error || t.sysError
  // L1/L5: the dial + trove numbers gate on the CORE read only — a
  // governorOf-only failure must not mask readable trove numbers as
  // 'Unavailable' (that is what t.govError is for, below).
  const acctError = demo ? acct.isError : !!t.coreError
  const recoveryMode = demo ? radar.data?.recoveryMode : t.recoveryMode
  // Round 7 (J1 L1): TanStack Query v5 RETAINS data on error — on a sys
  // failure recoveryMode keeps its last good value, so the ON/OFF banners
  // keyed off it would render stale claims beside (or instead of)
  // "Unavailable". Derive the banner state from the error: unknown
  // whenever the sys batch failed (transport OR a per-slot failure,
  // LOW-6) — the ON/OFF banners only render for a KNOWN state.
  const sysUnknown = !demo && (t.sysError || t.sysSlotError)
  const recoveryKnown = sysUnknown ? undefined : recoveryMode
  const troveStatus = demo ? a?.troveStatus : t.troveStatus
  // A closed trove (status 2/3/4, not 0 = never existed) blocks draws. The
  // old condition required hasTrove, which is false exactly when the trove
  // is closed — the banner could never render in demo mode. A future
  // status (> 4) is UNKNOWN, not closed — never claim the trove no longer
  // exists for a status this code does not understand.
  const troveClosed = troveStatus !== undefined && troveStatus !== null && troveStatus >= 2 && troveStatus <= 4
  const host = useRef<HTMLDivElement>(null)
  const ship = useRef<HTMLDivElement>(null), dial = useRef<HTMLDivElement>(null), form = useRef<HTMLElement>(null)
  const sColl = useRef<HTMLDivElement>(null), sDebt = useRef<HTMLDivElement>(null), sRoute = useRef<HTMLDivElement>(null)
  const links = useMemo<RouteLink[]>(() => [
    { from: ship, fromEdge: 'right', to: dial, toEdge: 'left' },
    { from: ship, fromEdge: 'right', to: form, toEdge: 'left' },
    { from: sColl, fromEdge: 'top', to: ship, toEdge: 'bottom' },
    { from: sDebt, fromEdge: 'right', to: sRoute, toEdge: 'left' },
    { from: sRoute, fromEdge: 'top', to: form, toEdge: 'left' },
  ], [])
  const usd = (v?: bigint) => (v !== undefined && price ? `≈ $${fmt((v * price) / WAD)}` : '')
  const standbyDate = t.standby?.[3] ? new Date(Number(t.standby[1]) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null
  return (
    <div>
      {rpcError && (
        <div className="plate rounded-xl p-4 mb-6 text-sm" role="alert">{RPC_ERROR_TEXT}</div>
      )}
      {recoveryKnown === true && (
        <div className="plate rounded-xl p-4 mb-6 text-sm" role="alert">
          <b>Recovery Mode</b> — Mezo system health is below 150%, so draws are paused on-chain. Repay or add collateral to continue; the guard cannot draw until the system recovers.
        </div>
      )}
      {/* L-b (round 4) + round 7 (J1 L1): a failed system-health batch leaves the recovery
          state unknown — say so explicitly instead of rendering no banner.
          The banner keys off recoveryKnown, never retained recoveryMode. */}
      {sysUnknown && (
        <div className="plate rounded-xl p-4 mb-6 text-sm" role="alert">
          Recovery Mode: <b>Unavailable</b> — the system-health read failed, so this page cannot say whether Recovery Mode is on.
        </div>
      )}
      {troveClosed && !loading && (
        <div className="plate rounded-xl p-4 mb-6 text-sm" role="alert">
          <b>Trove {TROVE_STATUS_LABEL[troveStatus ?? 0] ?? 'closed'}</b> — draws are blocked. The trove no longer exists on Mezo, so the dashboard numbers above are stale.
          {troveStatus === 4 && (demo
            ? <> This trove was closed by redemption. Claim your collateral — connect the owner wallet to claim it.</>
            : <> This trove was closed by redemption. Claim your collateral.</>)}
        </div>
      )}
      <div ref={host} className="relative grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px_260px] xl:grid-rows-[auto_auto]">
        <RouteLines host={host} links={links} />
        {/* Stern + compass */}
        <div ref={ship} className="relative xl:col-span-2 xl:row-start-1 aspect-[820/717] max-h-[440px] -mt-6 pointer-events-none" aria-hidden>
          <picture>
            <source media="(max-width: 700px)" srcSet="/art/stern-ship-640.webp" />
            <img src="/art/stern-ship.webp" alt="" width={820} height={717} fetchPriority="high" className="w-full h-full object-contain object-left" />
          </picture>
          <div className="absolute" style={{ left: '27%', top: '19%', width: '24%' }}><Compass /></div>
        </div>
        {/* Dial */}
        <div className="xl:col-start-3 xl:row-start-1 flex flex-col items-center">
          <div className="caps text-[11px] tracking-[.24em] mb-2">Collateral ratio</div>
          <div ref={dial}>
            {/* MED-1 (round 4): "No debt" only for a known-active trove —
                demo hasTrove is gated on troveStatus === 1, so a ?account=
                preview of a no-trove or closed address falls through to
                the Dial's default "No trove" empty label.
                LOW-1 (round 5): outside demo mode hasTrove counts an
                UNKNOWN status (useTrove: statusNum === undefined) as a
                trove, and t.loading does not cover the sys batch — so a
                zero-debt trove whose getTroveStatus read is still pending
                or failed would assert "No debt" on an unknown status.
                Gate the label on troveStatus === 1: unknown renders
                "Unavailable" instead.
                LOW-1 (round 7): the Dial is a FIFTH ungated hasTrove
                consumer — the round-6 gate above only applies when
                hasTrove is true, so a demo/?account= preview of a
                zero-debt address with a failed getTroveStatus
                (troveStatus null, icr 2**255) or any zero-debt trove with
                a future status 5 has hasTrove false, value null and an
                undefined emptyLabel — and the Dial falls through to its
                default "No trove" while the same state renders
                "Unavailable" everywhere else. Pass an explicit label for
                the unknown case. */}
            {loading ? <Skeleton className="h-[240px] w-[240px] rounded-full" label="Loading collateral ratio" /> : acctError ? (
              <div className="flex h-[240px] w-[240px] items-center justify-center text-sm text-signal">Unavailable</div>
            ) : (
              <Dial value={hasTrove ? icrPct(icrV) : null} floor={icrPct(floorV) ?? undefined} size={240} emptyLabel={troveStatus == null || troveStatus > 4 ? 'Unavailable' : hasTrove && isNoDebtIcr(icrV) ? (troveStatus === 1 ? 'No debt' : 'Unavailable') : undefined} />
            )}
          </div>
          <div className="text-[11px] text-muted mt-1">Liquidation floor · 110%</div>
        </div>
        {/* Stats */}
        <div className="xl:col-start-1 xl:row-start-2 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4 self-start relative z-10 min-w-0">
          <StatCard ref={sColl} icon="M12 3v14M7 8h10M5 14a7 7 0 0014 0M12 17v4" k="Collateral"
            v={loading ? <Skeleton className="h-7 w-24" /> : acctError ? 'Unavailable' : coll !== undefined ? `${fmt(coll, 18, 6)} BTC` : 'No trove'} sub={usd(coll)} />
          <StatCard ref={sDebt} icon="M12 3a9 9 0 100 18 9 9 0 000-18zM15 9l-2 5-4 1 2-5z" k="Debt"
            v={loading ? <Skeleton className="h-7 w-24" /> : acctError ? 'Unavailable' : debt !== undefined ? `${fmt(debt)} MUSD` : 'No trove'} sub={debt !== undefined ? `≈ $${fmt(debt)}` : ''} />
          <StatCard ref={sRoute} icon="M4 18c4 0 4-12 8-12s4 12 8 12M4 18h0M20 18h0" k="Spend route"
            v={demo
              ? (loading ? <Skeleton className="h-7 w-24" /> : acctError ? 'Unavailable' : 'Credit account')
              : t.govError || t.gvError || t.gvSlotError ? 'Unavailable' : t.governor ? (t.frozen ? 'Frozen' : 'Governed') : t.isConnected ? 'No Governor' : 'Not connected'}
            sub={demo
              ? (a?.floorICR != null && a?.shieldICR != null
                ? <span className="text-magenta">Floor {pct(a.floorICR)} · shield {pct(a.shieldICR)}</span>
                : loading ? 'Loading policy…' : a?.policyError ? 'Unavailable' : a ? 'No policy on this account' : 'Policy not readable')
              : t.governor ? <span className="text-magenta">Trove → Governor → Payee</span> : 'Create a Governor to set a floor'} />
        </div>
        {/* Hero form / demo hero */}
        <div className="xl:col-start-2 xl:row-start-2 xl:-mt-56 relative z-10">
          {demo ? <DemoHero acct={acct} viewed={viewed} /> : <DrawHero ref={form} t={t} />}
        </div>
        {/* Route & Position */}
        <aside className="xl:col-start-3 xl:row-start-2 self-start relative z-10 plate rounded-xl p-5 text-sm space-y-3">
          <div className="caps text-[11px] tracking-[.24em]">Route &amp; Position</div>
          <div className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${demo ? 'bg-brass' : t.isConnected ? 'bg-signal animate-pulse' : 'bg-ink/30'}`} />{demo ? 'Demo · live every 12 s' : t.isConnected ? 'Live · every 15 s' : 'Not connected'}</div>
          {demo ? (
            <>
              <Row k="Credit account" v={loading ? <Skeleton className="h-4 w-32" /> : <a className="ink-link text-magenta mono text-xs" href={addrUrl(viewed.address)} target="_blank" rel="noreferrer">Account {viewed.address.slice(0, 6)}…{viewed.address.slice(-4)}</a>} />
              <Row k="Collateral" v={loading ? <Skeleton className="h-4 w-24" /> : acctError ? 'Unavailable' : coll !== undefined ? `${fmt(coll, 18, 6)} BTC` : 'No trove'} />
              <Row k="Debt" v={loading ? <Skeleton className="h-4 w-24" /> : acctError ? 'Unavailable' : debt !== undefined ? `${fmt(debt)} MUSD` : 'No trove'} />
              {/* MED-2 (round 6), demo branch: same lie as the own-account rows
                  below — on a failed demo-account read floorV is undefined
                  and the row would claim "Not configured" about an unknown
                  policy. Gate on the account error like the Shield row.
                  Round 7: a failed policy read (policyError) is the same
                  unknown, not "Not configured". */}
              <Row k="Floor" v={loading ? <Skeleton className="h-4 w-16" /> : acctError || a?.policyError ? 'Unavailable' : floorV ? pct(floorV) : 'Not configured'} />
              {/* J1 LOW-2: when needed() itself failed (null) but the policy
                  exists, the shield state is UNKNOWN — asserting "No shield
                  needed" would be wrong if the ICR were below the shield
                  line. LOW-5 still applies: "No policy" gates on shieldICR,
                  never on needed. Round 7: a failed policy read
                  (policyError) is likewise "Unavailable", never "No policy". */}
              <Row k="Shield" v={loading ? <Skeleton className="h-4 w-32" /> : acctError || a?.policyError ? 'Unavailable' : a?.shieldICR == null ? 'No policy' : a?.needed == null ? 'Unknown' : (a.needed.repayWanted > 0n || a.needed.collWanted > 0n) ? `Needs repay ${fmt(a.needed.repayWanted)} MUSD` : 'No shield needed'} />
              <Row k="Account owner" v={loading ? <Skeleton className="h-4 w-32" /> : a?.owner ? <a className="ink-link text-magenta mono text-xs" href={addrUrl(a.owner)} target="_blank" rel="noreferrer">{a.owner.slice(0, 6)}…{a.owner.slice(-4)}</a> : 'Unknown'} />
            </>
          ) : (
            <>
              <Row k="Plotted course" v={t.govError ? 'Unavailable' : t.governor ? <a className="ink-link text-magenta mono text-xs" href={addrUrl(t.governor)} target="_blank" rel="noreferrer">Governor {t.governor.slice(0, 6)}…{t.governor.slice(-4)}</a> : 'No Governor yet'} />
              <Row k="Collateral" v={acctError ? 'Unavailable' : t.coll !== undefined ? `${fmt(t.coll, 18, 6)} BTC` : 'No trove'} />
              <Row k="Debt" v={acctError ? 'Unavailable' : t.debt !== undefined ? `${fmt(t.debt)} MUSD` : 'No trove'} />
              {/* MED-2 (round 6): the Governor batch is enabled: !!governor,
                  so on a governorOf failure (govError, governor undefined)
                  it NEVER runs — gvError stays false and floor/standby stay
                  undefined. Gating only on gvError would render "Not
                  configured" / "DISARMED" about an UNKNOWN Governor. Gate
                  both rows on govError || gvError (plus gvSlotError in
                  round 7: a reverted slot inside the batch is the same
                  unknown), matching the Spend route (Home:161) and Watch
                  standby (Watch:139–140). */}
              <Row k="Floor" v={t.govError || t.gvError || t.gvSlotError ? 'Unavailable' : t.floor ? pct(t.floor) : 'Not configured'} />
              <Row k="Standby heal" v={t.govError || t.gvError || t.gvSlotError ? 'Unavailable' : t.standby?.[3] ? `${fmt(t.standby[0])} MUSD armed until ${standbyDate}` : 'DISARMED — re-arm to enable defend'} />
              <Row k="Mezo nonce" v={acctError ? 'Unavailable' : t.nonce !== undefined ? String(t.nonce) : 'Not connected'} />
            </>
          )}
        </aside>
      </div>

      <div className="grid lg:grid-cols-[1fr_340px] gap-8 mt-14 cv-auto">
        <div>
          <h2 className="display text-3xl mb-4">Ledger</h2>
          {demo ? (
            <Card title="Demo account balances">
              {loading ? (
                <div className="space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /></div>
              ) : acctError ? (
                <p className="text-sm text-signal">{RPC_ERROR_TEXT}</p>
              ) : a ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {([['BTC', a.balances.btc, 6], ['MUSD', a.balances.musd, 2], ['sMUSD', a.balances.smusd, 2], ['Yield due', a.pendingYield ?? 0n, 2]] as const).map(([s, v, d]) => (
                    <div key={s} className="flex items-center gap-3"><Token sym={s === 'Yield due' ? 'sMUSD' : s} size={32} /><div><div className="text-sm">{s}</div><div className="mono text-sm">{v === null ? 'unreadable' : fmt(v, 18, d)}</div></div></div>
                  ))}
                </div>
              ) : <p className="text-sm text-muted">Account not readable.</p>}
              {a?.pendingYield === null && a?.version === 'v2' && <p className="text-xs text-muted mt-3">Pending yield is not exposed by the lab account contract.</p>}
            </Card>
          ) : (
            <NeedsWallet what="read your trove">
              {/* Round 7 (hasTrove definition): hasTrove is false while the
                  trove status is unknown — the "No trove" empty must not
                  flash for a real zero-debt trove whose sys batch is still
                  in flight. It renders only once the status is known, or
                  once the core read proves coll 0 (a real empty trove). */}
              {!t.loading && !t.hasTrove && !t.error && (t.troveStatusKnown || t.coll === 0n) && <Empty title="No trove on this wallet">Open a trove at <a className="ink-link" href="https://testnet.mezo.org" target="_blank" rel="noreferrer">testnet.mezo.org</a>, then come back to set a floor.</Empty>}
              {t.error && <p className="text-sm text-signal">{RPC_ERROR_TEXT}</p>}
              {own.data === null && !own.isLoading && !own.isError && (
                <p className="text-sm leading-relaxed mt-6">You have no credit account yet. Open one in about two minutes. <Link className="pill" to="/app/open">Open a credit account →</Link></p>
              )}
              {/* LOW-6 (round 6): the own-account scan error is surfaced on
                  Close/Open but was swallowed here — own.data is undefined
                  (not null) on error, so the CTA above is suppressed with
                  no error text at all. Say the read failed. */}
              {own.isError && <p className="text-sm text-signal mt-6">{RPC_ERROR_TEXT}</p>}
              {t.hasTrove && (
                <Card title="Wallet balances">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {([['BTC', t.balances.btc, 6], ['MUSD', t.balances.musd, 2], ['sMUSD', t.balances.smusd, 2], ['MEZO', t.balances.mezo, 2]] as const).map(([s, v, d]) => (
                      <div key={s} className="flex items-center gap-3"><Token sym={s} size={32} /><div><div className="text-sm">{s}</div><div className="mono text-sm">{v === undefined ? 'Loading…' : fmt(v, 18, d)}</div></div></div>
                    ))}
                  </div>
                </Card>
              )}
              {t.hasTrove && !t.governor && !t.govError && <CreateGovernor onDone={t.refetch} />}
            </NeedsWallet>
          )}
        </div>
        <aside className="space-y-6">
          {demo ? (
            <Card title="Credit account">
              {loading ? (
                <div className="space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>
              ) : acctError ? (
                <p className="text-sm text-signal">{RPC_ERROR_TEXT}</p>
              ) : a ? (
                <div className="text-sm space-y-2">
                  <a className="ink-link mono text-xs break-all" href={addrUrl(viewed.address)} target="_blank" rel="noreferrer">{viewed.address}</a>
                  {viewed.isLabPrototype && DEMO_ACCOUNT_BADGE && <div><span className="caps rounded-sm border border-ink/40 px-2 py-0.5 text-[10px]">{DEMO_ACCOUNT_BADGE}</span></div>}
                  <div>Status: {a.troveStatus === 1 ? <b className="text-safe">active trove</b> : a.troveStatus === null ? <b>Unavailable</b> : <b>{TROVE_STATUS_LABEL[a.troveStatus ?? 0] ?? 'unknown'}</b>}</div>
                  <div>Owner: <a className="ink-link mono text-xs" href={addrUrl(a.owner ?? viewed.address)} target="_blank" rel="noreferrer">{a.owner ? `${a.owner.slice(0, 6)}…${a.owner.slice(-4)}` : 'unknown'}</a></div>
                  <div>Policy: floor {a.floorICR !== null ? pct(a.floorICR) : 'unknown'} · shield {a.shieldICR !== null ? pct(a.shieldICR) : 'unknown'} · target {a.targetICR !== null ? pct(a.targetICR) : 'unknown'}</div>
                  <div>Bounty {a.bounty !== null ? `${fmt(a.bounty)} MUSD` : 'unknown'} per effective shield</div>
                </div>
              ) : <p className="text-sm text-muted">Account not readable.</p>}
            </Card>
          ) : (
            <Card title="Governor">
              {t.govError
                ? <p className="text-sm text-signal">{RPC_ERROR_TEXT}</p>
                : t.governor
                ? <div className="text-sm space-y-2"><a className="ink-link mono text-xs break-all" href={addrUrl(t.governor)} target="_blank" rel="noreferrer">{t.governor}</a>
                    {/* Round 7 (LOW-6): a reverted Governor-batch slot leaves
                        frozen undefined — "active" would be a claim about an
                        unknown batch. Gate on gvSlotError like gvError. */}
                    <div>Status: {t.gvError || t.gvSlotError ? <b>Unavailable</b> : t.frozen ? <b className="text-signal">frozen</b> : <b className="text-safe">active</b>}</div></div>
                : <p className="text-sm text-muted">None yet. Create one to set a floor and hand out bounded budgets.</p>}
            </Card>
          )}
          <Requests borrower={demo ? a?.owner ?? undefined : t.address} />
        </aside>
      </div>
    </div>
  )
}

/** Read-only hero for demo mode: the same live numbers as the draw form's preview, without any signing. */
function DemoHero({ acct, viewed }: { acct: ReturnType<typeof useAccount>; viewed: ReturnType<typeof useViewedAccount> }) {
  const a = acct.data
  return (
    <section aria-labelledby="demo-hero" className="glow-card rounded-2xl bg-[#FBF6EC] shadow-[0_30px_70px_-30px_rgba(163,32,79,.55)]">
      <div className="rounded-2xl bg-[#FBF6EC] p-6">
        <header className="flex items-center justify-between">
          <h2 id="demo-hero" className="caps text-[15px] tracking-[.28em]">Demo account · live</h2>
          {viewed.isLabPrototype && DEMO_ACCOUNT_BADGE && <span className="caps rounded-sm border border-ink/40 px-2 py-0.5 text-[10px]">{DEMO_ACCOUNT_BADGE}</span>}
        </header>
        {acct.isLoading ? (
          <div className="mt-5 space-y-3"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-1/2" /></div>
        ) : acct.isError ? (
          <p className="text-sm text-signal mt-5" role="alert">{RPC_ERROR_TEXT}</p>
        ) : a ? (
          <>
            {/* MED-1 (round 4): pct() says "No debt" for any zero-debt ICR —
                gate the headline on troveStatus so a no-trove / closed
                preview reads "No trove", never "No debt". */}
            <div className="display text-4xl mt-5">{demoIcrLabel(a.icr, a.troveStatus)}</div>
            <p className="text-sm text-muted mt-1">Collateral ratio · {fmt(a.coll, 18, 6)} BTC backing {fmt(a.debt)} MUSD of debt</p>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 mt-4 text-sm">
              <dt className="text-muted">Floor</dt><dd className="mono text-right">{a.floorICR !== null ? pct(a.floorICR) : 'unknown'}</dd>
              <dt className="text-muted">Shield line</dt><dd className="mono text-right">{a.shieldICR !== null ? pct(a.shieldICR) : 'unknown'}</dd>
              <dt className="text-muted">Shield target</dt><dd className="mono text-right">{a.targetICR !== null ? pct(a.targetICR) : 'unknown'}</dd>
              {/* J1 LOW-2: a null needed() is "unknown", never "none" — see the
                  Shield row above. Round 7: a failed policy read is
                  likewise "unknown", never "No policy". */}
              <dt className="text-muted">Shield need</dt><dd className="mono text-right">{a.policyError ? 'unknown' : a.shieldICR == null ? 'No policy' : a.needed == null ? 'unknown' : (a.needed.repayWanted > 0n || a.needed.collWanted > 0n) ? `repay ${fmt(a.needed.repayWanted)} MUSD` : 'none'}</dd>
            </dl>
            <p className="text-xs text-muted mt-4">Read-only: this account belongs to the demo owner. Drawing, defending and closing need the owner wallet.</p>
          </>
        ) : <p className="text-sm text-muted mt-5">Account not readable.</p>}
        <div className="mt-5 flex gap-3">
          <Link className="pill flex-1 justify-center py-3 text-[13px]" to="/app/open">Open a credit account</Link>
          <Link className="pill-ghost py-3 px-4 text-[13px]" to="/app/watch">Watch →</Link>
        </div>
      </div>
    </section>
  )
}

const StatCard = forwardRef<HTMLDivElement, { icon: string; k: string; v: ReactNode; sub?: ReactNode }>(function StatCard({ icon, k, v, sub }, ref) {
  return (
    <div ref={ref} className="plate rounded-xl p-4 min-w-0 transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-18px_rgba(163,32,79,.6)]">
      <div className="caps text-[10px] tracking-[.2em] flex items-center gap-2">
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><path d={icon} /></svg>{k}
      </div>
      <div className="display text-[clamp(1.15rem,1.6vw,1.5rem)] leading-tight mt-2 break-words">{v}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </div>
  )
})

function Row({ k, v }: { k: string; v: ReactNode }) {
  return <div className="border-t border-ink/15 pt-2"><div className="text-[11px] text-muted">{k}</div><div className="mono text-[13px]">{v}</div></div>
}

function Requests({ borrower }: { borrower?: string }) {
  const q = useApiList<{ id: number; app_address: string; amount: string; status: string; reason?: string }>('requests', borrower ? `/v1/requests?borrower=${borrower}` : null)
  return (
    <Card title="App requests" aside={<Link className="caps text-[11px] ink-link" to="apps">All</Link>}>
      {q.state === 'off' && <p className="text-sm text-muted">{borrower ? 'Request feed needs the Sternpost API.' : 'Connect a wallet to see requests from apps.'}</p>}
      {q.state === 'ok' && q.items.length === 0 && <p className="text-sm text-muted">No pending requests.</p>}
      {q.state === 'error' && <p className="text-sm text-signal">API unreachable.</p>}
      {q.items.slice(0, 3).map((r) => (
        <div key={r.id} className="flex items-center justify-between py-3 border-t border-ink/15">
          <div><div className="mono text-xs">{r.app_address.slice(0, 8)}…</div><div className="display text-lg">{fmt(BigInt(r.amount))} MUSD</div></div>
          <Link to={`/app/crew?app=${r.app_address}&amount=${r.amount}&request=${r.id}`} className="pill">Review</Link>
        </div>
      ))}
    </Card>
  )
}

function CreateGovernor({ onDone }: { onDone: () => void }) {
  const [floor, setFloor] = useState(250)
  const [defend, setDefend] = useState(160)
  const { writeContractAsync } = useWriteContract()
  const tx = useTx()
  const ok = floor >= 150 && floor <= 1000 && defend >= 135 && defend < floor
  return (
    <Card title="Set your floor" className="mt-6">
      <p className="text-sm mb-4">Deploys your own Governor. Any draw that would take the trove below this ratio reverts on-chain.</p>
      <div className="flex gap-3 mt-2">
        <label className="caps text-[11px] text-muted" htmlFor="floor">Collateral floor (%)<input id="floor" type="number" min={150} max={1000} value={floor} onChange={(e) => setFloor(+e.target.value)} className="mono border border-ink/30 bg-paper px-3 py-2 w-32 block mt-1" /></label>
        <label className="caps text-[11px] text-muted" htmlFor="defend">Defend line (%)<input id="defend" type="number" min={135} max={1000} value={defend} onChange={(e) => setDefend(+e.target.value)} className="mono border border-ink/30 bg-paper px-3 py-2 w-32 block mt-1" /></label>
        <button className="pill self-end" disabled={!ok || !STERNPOST.factory || tx.phase === 'signing' || tx.phase === 'pending'}
          onClick={async () => { if (await tx.run(() => writeContractAsync({ address: STERNPOST.factory!, abi: factoryAbi, functionName: 'createGovernor', args: [BigInt(floor) * WAD / 100n, BigInt(defend) * WAD / 100n] }))) onDone() }}>
          Create Governor
        </button>
      </div>
      <p className="text-xs text-muted mt-2">Floor {floor}% — draws stop below this. Defend {defend}% — if the trove falls below this, anyone can repay from your buffer to restore it. Liquidation is at 110%, so the defend line must stay above 135%.</p>
      <TxStatus tx={tx} />
    </Card>
  )
}
