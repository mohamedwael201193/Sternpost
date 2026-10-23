import { txUrl } from '../lib/proofs'
import { Plate, Reveal } from './Plate'

const ROUTES = [
  { k: 'Keep', d: 'A plain governed draw. MUSD goes to the payee the app is locked to.', tx: '0xba4eb1299298aa6ad661cb6ed83accc9ed07ff2a42ec1b4576bb3c5f67c71523' },
  { k: 'Save', d: 'The draw goes straight into Mezo sMUSD savings. The shares go to you.', tx: '0x2e775fc4c97ee6762ad3bbb7b8634f02b888221ef6008f4f0a111f88ac53f311' },
  { k: 'Swap', d: 'MUSD is swapped to BTC on the Mezo DEX MUSD/BTC pool, with a minimum output.', tx: '0x8f1cffa6e45f14b612b5998a1e08ca1666a980fdc877401b6cb9ed5691cb1c91' },
  { k: 'Loop', d: 'Draw, swap to BTC, add it back as collateral to the same trove. Up to 2 legs, and the floor is checked again after each one.', tx: '0x589fd81568ee61521091b3be036c00c7852a6f030d0d052f32a5794d5d6735c1' },
]

export function Routes() {
  return (
    <Plate id="routes" n="VI" kicker="Composability" title={<>Where a draw goes: <em>Keep, Save, Swap, Loop.</em></>} className="bg-paper2/60">
      <div className="grid gap-px overflow-hidden border border-ink/20 bg-ink/20 sm:grid-cols-2 lg:grid-cols-4">
        {ROUTES.map((r, i) => (
          <Reveal key={r.k} i={i} className="flex flex-col bg-paper p-8">
            <p className="display text-4xl">{r.k}</p>
            <p className="mt-4 flex-1 text-ink/75">{r.d}</p>
            <a href={txUrl(r.tx)} target="_blank" rel="noreferrer" className="mono ink-link mt-6 text-sm text-magenta">{r.tx.slice(0, 10)}… on testnet ↗</a>
          </Reveal>
        ))}
      </div>
      <Reveal className="mt-10 max-w-3xl text-ink/75">
        SternpostRouter is just another app on your Governor, with its payee locked to itself. So every route still passes your floor, budget and per-draw cap. Routes are off until you turn them on, approvals reset to zero, and the router ends every call holding nothing.
      </Reveal>
    </Plate>
  )
}
