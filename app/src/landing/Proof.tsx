import { PROOFS, txUrl } from '../lib/proofs'
import { Plate, Reveal } from './Plate'

// Counted by running each suite on 2026-11-16; see README "Tests".
const COUNTS = [
  ['312', 'Contract tests: unit, fuzz, invariant'],
  ['10', 'Fork tests on live Mezo testnet + mainnet'],
  ['148', 'Backend tests (API, x402, bot)'],
  ['47', 'SDK + app unit tests'],
  ['16', 'Steps in the full Wave 1 testnet run (23 Oct)']
] as const

export function Proof() {
  return (
    <Plate id="proof" n="VIII" kicker="Ship's log" title={<>Every claim has a <em>transaction hash.</em></>}>
      <Reveal className="mb-10">
        <ul className="grid grid-cols-2 gap-px overflow-hidden border border-ink/20 bg-ink/20 md:grid-cols-5">
          {COUNTS.map(([n, l]) => (
            <li key={l} className="bg-paper p-6"><p className="display text-5xl">{n}</p><p className="caps mt-2 text-muted">{l}</p></li>
          ))}
        </ul>
      </Reveal>
      <Reveal className="mb-10">
        <div className="border border-ink/25 bg-paper p-8">
          <p className="caps text-magenta">Wave 2 · 0.9 proof — a stranger defended the trove</p>
          <p className="mt-4 max-w-3xl text-ink/80">On the current 0.9 deployment, an outside EOA — not the borrower — called defend() and repaid 30 MUSD, lifting ICR from 2.3791 to 2.4081. Caller <span className="mono">0x27aeBa9c609b21Ea4112d8bd0a21E779901D62A6</span>, a fresh single-use EOA funded with 0.0002 BTC for gas only. Triggered by raising the defend line, not by a price move.</p>
          <a className="mono ink-link mt-4 inline-block text-sm text-magenta" href="https://explorer.test.mezo.org/tx/0x3e57c0b2b71099c01cbb4e47facd97eccece12f46bbe675bed0f4013f87600c2" target="_blank" rel="noreferrer">defend(), block 16794538 — 0x3e57c0b2…87600c2 ↗</a>
        </div>
      </Reveal>
      <Reveal>
        <p className="caps mb-4 text-muted">Curated selection of testnet proofs — superseded deployment</p>
        <div className="overflow-x-auto border border-ink/25">
          <table className="w-full min-w-[760px] text-left">
            <thead className="bg-paper2">
              <tr className="caps text-muted">
                <th className="px-5 py-4 font-normal">Entry</th><th className="px-5 py-4 font-normal">What happened</th>
                <th className="px-5 py-4 font-normal">Status</th><th className="px-5 py-4 font-normal">Testnet tx</th>
              </tr>
            </thead>
            <tbody>
              {PROOFS.map((p, i) => (
                <tr key={p.id} className="border-t border-ink/15 align-top transition-colors hover:bg-paper2/70">
                  <td className="px-5 py-5"><span className="mono text-muted">{String(i + 1).padStart(2, '0')}</span> <span className="display text-xl">{p.title}</span></td>
                  <td className="max-w-md px-5 py-5 text-ink/80">{p.claim}</td>
                  <td className="px-5 py-5"><span className={`caps rounded-full border px-3 py-1 ${p.status === 'success' ? 'border-safe text-safe' : 'border-signal text-signal'}`}>{p.status === 'success' ? 'Success' : 'Reverted'}</span></td>
                  <td className="px-5 py-5"><a className="mono ink-link text-magenta" href={txUrl(p.hash)} target="_blank" rel="noreferrer">{p.hash.slice(0, 10)}…{p.hash.slice(-6)} ↗</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>
      <p className="mt-6 max-w-2xl text-sm text-muted">
        Reverted is the expected result for entries 02 and 05 in the table below. The table below is a curated selection of testnet proofs on the superseded deployment — the full 16-step Wave 1 run (23 Oct 2026) is in <a className="ink-link" href="https://github.com/mohamedwael201193/Sternpost/blob/main/judges/TESTNET_TXS.md">judges/TESTNET_TXS.md</a>. On the current 0.9 deployment only defend() has been re-run (the 0.9 proof above); the draw, veto, revoke and x402 entries have not been re-run on 0.9. Not audited. Testnet only; Sternpost is not deployed on mainnet.
        The guarantee covers signatures addressed to your Governor; a Mezo contract upgrade that changed the callback would need a new review.
      </p>
    </Plate>
  )
}
