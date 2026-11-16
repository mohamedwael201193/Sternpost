import { useState } from 'react'
import { Link } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { addrUrl, txUrl } from '../../lib/proofs'
import { DEMO_ACCOUNT, DEMO_ACCOUNT_BADGE } from '../../lib/chain'
import { fmt, pct } from '../../lib/icr'
import { Skeleton } from '../../ui/Skeleton'
import { RPC_ERROR_TEXT, useAccount } from '../useAccount'
import deployments from '../../../../shared/deployments/testnet.json'

const FACTORY = deployments.sternpost.SternpostFactory.address
const GOVERNOR = deployments.sternpost.governor
const ROUTER = deployments.sternpost.SternpostRouter.address
const SPEND_WALLET = deployments.sternpost.spendWallet
const DEFEND_CALLER = deployments.sternpost.classicRedeploy.defend.caller

const SUITES: [string, number, number, number][] = [
  ['contracts-unit', 87, 0, 0],
  ['contracts-fuzz', 7, 0, 0],
  ['contracts-invariant', 2, 0, 0],
  ['contracts-account', 32, 0, 2],
  ['contracts-fuzz-account', 1, 0, 0],
  ['contracts-routes', 8, 0, 0],
  ['contracts-fork-offline', 0, 0, 2],
  ['contracts-fork-testnet', 10, 0, 0],
  ['contracts-fork-mainnet', 7, 0, 1],
  ['sdk', 10, 0, 0],
  ['backend', 74, 0, 0],
  ['app', 35, 0, 0],
  ['mcp', 0, 0, 0],
  ['keeper', 0, 0, 0],
]

const DEFEND_FLOW: [string, string, number][] = [
  ['MUSD.approve(governor, 30)', '0x33315ec652f221cb69ba8d6117b57cad3b4ddaf85da6c11c34eeb680a33a2ab3', 16794518],
  ['fund(30 MUSD buffer)', '0xae767aea1b2686bb4d3cec71115421771cdb16ee389196cf09fa79631d0217f0', 16794520],
  ['rearm(30 MUSD, Mezo nonce 44)', '0x11d67685628ed56919926c8fff70ff6a18c868eb3e2b089b1ac02716cd0eb856', 16794526],
  ['setPolicy(2.5, 2.4) to trigger', '0x928ac8ca47df643a111e055447055f679ef5c186a939fa6cf8e39426069f3dc2', 16794530],
  ['fund outside EOA 0.0002 BTC', '0xdc437afc5e606fda00eb4b48a2737f3c4e447be72fd7ee62b41dd1f6c9f0c8e0', 16794536],
  ['defend() from outside EOA', '0x3e57c0b2b71099c01cbb4e47facd97eccece12f46bbe675bed0f4013f87600c2', 16794538],
  ['unfreeze()', '0x0097174d37796ab802b199e9aaca6afb6692c137e87f4a2456fcaa5f9412471e', 16794548],
  ['setPolicy(2.5, 1.6) restore', '0xfaf5c4c081210ddd75a7660fe8638437539e6502dc76d86ecde72547eb68cec2', 16794550],
  ['MUSD.approve(governor, 30)', '0x6dec4c6882b1fba1c8c653b154a03d5f7d08d7bca10351f99a0af750d6dcf54d', 16794552],
  ['fund(30 MUSD buffer) restore', '0xe3c2029fe799f33b173bc7fc6128498bdf94b53cb45a8fc870be94c4bfae5fed', 16794553],
  ['rearm(30 MUSD, Mezo nonce 45)', '0xe4f15449c17228a484d31de5f59ae398949865141fde92d351b337c095fded81', 16794555],
]

function Tx({ h }: { h: string }) {
  return <a className="mono ink-link text-magenta text-xs break-all" href={txUrl(h)} target="_blank" rel="noreferrer">{h} ↗</a>
}

/** ProveIt renders outside the Dashboard providers, so it owns a small QueryClient for its one live read. */
export default function ProveItPage() {
  const [qc] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={qc}>
      <ProveIt />
    </QueryClientProvider>
  )
}

function ProveIt() {
  const acct = useAccount(DEMO_ACCOUNT)
  const a = acct.data
  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-[900px] px-6 py-10">
        <Link className="ink-link text-magenta" to="/">← Sternpost</Link>
        <div className="caps text-[11px] tracking-[.24em] text-magenta mt-8">Proof</div>
        <h1 className="display text-5xl mt-2">Prove it</h1>
        <p className="text-muted mt-3 max-w-2xl">Every number Sternpost claims, with the transaction or the test run behind it. Mezo testnet 31611 unless labelled otherwise.</p>

        <h2 className="display text-3xl mt-12 mb-4">Demo account — live</h2>
        {acct.isLoading ? (
          <div className="space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>
        ) : acct.isError ? (
          <p className="text-sm text-signal">{RPC_ERROR_TEXT}</p>
        ) : a ? (
          <div className="text-sm leading-relaxed space-y-2">
            <p>
              <a className="mono ink-link text-magenta text-xs break-all" href={addrUrl(DEMO_ACCOUNT)} target="_blank" rel="noreferrer">{DEMO_ACCOUNT} ↗</a>
              {DEMO_ACCOUNT_BADGE && <span className="caps rounded-sm border border-ink/40 px-2 py-0.5 text-[10px] ml-3">{DEMO_ACCOUNT_BADGE}</span>}
            </p>
            <p>ICR <b className="mono">{pct(a.icr, 1)}</b> · collateral <b className="mono">{fmt(a.coll, 18, 6)} BTC</b> · debt <b className="mono">{fmt(a.debt)} MUSD</b> · status <b>{a.troveStatus === 1 ? 'active' : 'not active'}</b></p>
            <p>Policy: floor {a.floorICR !== null ? pct(a.floorICR) : 'unknown'} · shield {a.shieldICR !== null ? pct(a.shieldICR) : 'unknown'} · target {a.targetICR !== null ? pct(a.targetICR) : 'unknown'} · MUSD on the account {fmt(a.balances.musd)} · sMUSD {fmt(a.balances.smusd)}</p>
            <p className="text-muted">Read live from Mezo testnet with one Multicall3 batch; refreshes every 12 s. The same demo account demo mode shows on every app page — unless you preview another account with ?account=, which shows that account instead.</p>
          </div>
        ) : <p className="text-sm text-muted">Account not readable.</p>}

        <h2 className="display text-3xl mt-12 mb-4">Tests</h2>
        <p className="text-sm leading-relaxed">
          <b>273 passed · 0 failed · 5 skipped</b> — the all-suite sum including fork suites, from{' '}
          <span className="mono">TESTS.json</span> (generated 2026-11-15T11:39:26Z). The file&apos;s own top-level
          total is <b>256 passed · 0 failed · 2 skipped</b> (non-fork suites only — fork suites are listed
          separately and never added twice). The table below sums to 273 / 0 / 5, including the{' '}
          <span className="mono">contracts-fork-offline</span> row (0 / 0 / 2): the two fork contracts skipped
          offline, which the previous version of this page omitted. This is a stale snapshot from a work-clone
          tree: the snapshot id recorded inside <span className="mono">TESTS.json</span> does not resolve to any
          commit on main, so the counts are anchored only to the file&apos;s{' '}
          <span className="mono">generatedAt</span> above — not to any main commit. The mcp and keeper suites are
          listed in that snapshot as missing — the packages do not exist yet — and are shown below as 0 / 0 / 0.
          No test count here is a claim about the future.
        </p>
        <p className="text-sm leading-relaxed mt-3">
          Since this snapshot the suites have grown. On main (3271231), the merged Shield work
          (task/1.4-shield, 3271231) adds 18 declared tests to the account suite — 219 declared
          there, up from 201 on 5e4f924 (Shield 14 → 29, Factory 23 → 26); the suite also declares
          10 invariant functions. At <span className="mono">6c69ab2</span> — before the Shield merge,
          when the account suite was those five files (164 declared) — the suite ran 161 passed ·
          0 failed · 3 skipped (<span className="mono">judges/forge-account.json</span>); the 3 skipped
          are the env-gated fork tests. Pass counts for the current 219-declared suite will land with
          the <span className="mono">TESTS.json</span>{' '} refresh, which is pending. The backend
          declares 80 tests, and the sdk declares 12.
        </p>
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted border-b border-ink/15"><th className="py-2 pr-4">Suite</th><th className="py-2 pr-4">Passed</th><th className="py-2 pr-4">Failed</th><th className="py-2">Skipped</th></tr></thead>
            <tbody>
              {SUITES.map(([n, p, f, s]) => (
                <tr key={n} className="border-b border-ink/10"><td className="mono py-2 pr-4">{n}</td><td className="py-2 pr-4">{p}</td><td className="py-2 pr-4">{f}</td><td className="py-2">{s}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted mt-3">backend: 74 of 80 declared executed; 6 tests not in this run.</p>

        <h2 className="display text-3xl mt-12 mb-4">0.9 deployment</h2>
        <dl className="text-sm space-y-3">
          <div><dt className="text-muted">SternpostFactory (Governor factory) — block 16794393</dt><dd className="mt-1"><a className="mono ink-link text-magenta text-xs break-all" href={addrUrl(FACTORY)} target="_blank" rel="noreferrer">{FACTORY} ↗</a></dd></div>
          <div><dt className="text-muted">Governor — floor 2.5, defend 1.6, block 16794411</dt><dd className="mt-1"><a className="mono ink-link text-magenta text-xs break-all" href={addrUrl(GOVERNOR)} target="_blank" rel="noreferrer">{GOVERNOR} ↗</a></dd></div>
          <div><dt className="text-muted">Router — block 16794452</dt><dd className="mt-1"><a className="mono ink-link text-magenta text-xs break-all" href={addrUrl(ROUTER)} target="_blank" rel="noreferrer">{ROUTER} ↗</a></dd></div>
          <div><dt className="text-muted">Spend wallet — block 16794411</dt><dd className="mt-1"><a className="mono ink-link text-magenta text-xs break-all" href={addrUrl(SPEND_WALLET)} target="_blank" rel="noreferrer">{SPEND_WALLET} ↗</a></dd></div>
        </dl>

        <h2 className="display text-3xl mt-12 mb-4">defend() — a stranger repaid 30 MUSD</h2>
        <p className="text-sm leading-relaxed">
          Caller <a className="mono ink-link text-magenta text-xs break-all" href={addrUrl(DEFEND_CALLER)} target="_blank" rel="noreferrer">{DEFEND_CALLER} ↗</a>{' '}
          — a fresh single-use outside EOA, not the borrower. ICR 2.3791 → 2.4081, buffer 30 → 0 MUSD, standby nonce
          44 → 45. Triggered by raising the policy line, not by a price move; policy restored to (2.5, 1.6) after.
          Final state: not frozen, buffer 30 MUSD, standby live, Mezo nonce 45.
        </p>
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted border-b border-ink/15"><th className="py-2 pr-4">Step</th><th className="py-2 pr-4">Block</th><th className="py-2">Transaction</th></tr></thead>
            <tbody>
              {DEFEND_FLOW.map(([s, h, b]) => (
                <tr key={h} className="border-b border-ink/10"><td className="py-2 pr-4">{s}</td><td className="mono py-2 pr-4">{b}</td><td className="py-2"><Tx h={h} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-sm text-muted mt-12">
          Testnet only. Mainnet: capped pilot, not started — read-only and fork-tested; no mainnet deployment exists yet.
          Source: <span className="mono">shared/deployments/testnet.json</span>,{' '}
          <span className="mono">TESTS.json</span>, <span className="mono">judges/TESTNET_TXS.md</span>.
        </p>
        <div className="mt-6 flex gap-3"><Link className="pill" to="/app">Open the app</Link><Link className="pill-ghost" to="/">Home</Link></div>
      </div>
    </main>
  )
}
