import { Link } from 'react-router-dom'
import { addrUrl, txUrl } from '../../lib/proofs'
import deployments from '../../../../shared/deployments/testnet.json'

const FACTORY = deployments.sternpost.SternpostFactory.address
const GOVERNOR = deployments.sternpost.governor
const ROUTER = deployments.sternpost.SternpostRouter.address
const SPEND_WALLET = deployments.sternpost.spendWallet

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

export default function ProveIt() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-[900px] px-6 py-10">
        <Link className="ink-link text-magenta" to="/">← Sternpost</Link>
        <div className="caps text-[11px] tracking-[.24em] text-magenta mt-8">Proof</div>
        <h1 className="display text-5xl mt-2">Prove it</h1>
        <p className="text-muted mt-3 max-w-2xl">Every number Sternpost claims, with the transaction or the test run behind it. Mezo testnet 31611 unless labelled otherwise.</p>

        <h2 className="display text-3xl mt-12 mb-4">Tests</h2>
        <p className="text-sm leading-relaxed">
          <b>273 passed · 0 failed · 5 skipped</b> — the all-suite sum including fork suites, from{' '}
          <span className="mono">TESTS.json</span> (generated 2026-11-15T11:39:26Z). The file&apos;s own top-level
          total is <b>256 passed · 0 failed · 2 skipped</b> (non-fork suites only — fork suites are listed
          separately and never added twice). The table below sums to 273 / 0 / 5, including the{' '}
          <span className="mono">contracts-fork-offline</span> row (0 / 0 / 2): the two fork contracts skipped
          offline, which the previous version of this page omitted. The snapshot id recorded inside{' '}
          <span className="mono">TESTS.json</span> (<span className="mono">7b1ffcde…</span>) does not resolve to any
          commit in this repo&apos;s history, so the counts are anchored to the file&apos;s{' '}
          <span className="mono">generatedAt</span> above and to main HEAD{' '}
          <span className="mono">3374eee</span>. The mcp and keeper suites are absent from
          that snapshot; a refresh is pending. No test count here is a claim about the future.
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

        <h2 className="display text-3xl mt-12 mb-4">0.9 deployment</h2>
        <dl className="text-sm space-y-3">
          <div><dt className="text-muted">Factory — block 16794393</dt><dd className="mt-1"><a className="mono ink-link text-magenta text-xs break-all" href={addrUrl(FACTORY)} target="_blank" rel="noreferrer">{FACTORY} ↗</a></dd></div>
          <div><dt className="text-muted">Governor — floor 2.5, defend 1.6, block 16794411</dt><dd className="mt-1"><a className="mono ink-link text-magenta text-xs break-all" href={addrUrl(GOVERNOR)} target="_blank" rel="noreferrer">{GOVERNOR} ↗</a></dd></div>
          <div><dt className="text-muted">Router — block 16794452</dt><dd className="mt-1"><a className="mono ink-link text-magenta text-xs break-all" href={addrUrl(ROUTER)} target="_blank" rel="noreferrer">{ROUTER} ↗</a></dd></div>
          <div><dt className="text-muted">Spend wallet — block 16794411</dt><dd className="mt-1"><a className="mono ink-link text-magenta text-xs break-all" href={addrUrl(SPEND_WALLET)} target="_blank" rel="noreferrer">{SPEND_WALLET} ↗</a></dd></div>
        </dl>

        <h2 className="display text-3xl mt-12 mb-4">defend() — a stranger repaid 30 MUSD</h2>
        <p className="text-sm leading-relaxed">
          Caller <a className="mono ink-link text-magenta text-xs break-all" href={addrUrl('0x27aeBa9c609b21Ea4112d8bd0a21E779901D62A6')} target="_blank" rel="noreferrer">0x27aeBa9c609b21Ea4112d8bd0a21E779901D62A6 ↗</a>{' '}
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
