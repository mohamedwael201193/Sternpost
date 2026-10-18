import { PROOFS, txUrl } from '../lib/proofs'
import { Plate, Reveal } from './Plate'

export function Proof() {
  return (
    <Plate id="proof" n="V" kicker="Ship's log" title={<>Every claim has a <em>transaction hash.</em></>}>
      <Reveal>
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
        Reverted is the expected result for entries 02 and 05. Not audited. Testnet only; Sternpost is not deployed on mainnet.
        The guarantee covers signatures addressed to your Governor; a Mezo contract upgrade that changed the callback would need a new review.
      </p>
    </Plate>
  )
}
