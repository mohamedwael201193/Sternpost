import { Plate, Reveal } from './Plate'

const MILES = [
  { d: 'Wave 2 · November 2026', s: 'Planned', t: 'Mezo mainnet launch', b: 'Governor, Router and SpendWallet on Mezo mainnet with capped limits and source-verified contracts.' },
  { d: 'Next', s: 'Planned', t: 'Audit, then higher caps', b: 'External audit of the Governor and Router, then higher limits.' },
  { d: 'Then', s: 'Planned', t: 'Deeper Mezo DeFi', b: 'More routes into Mezo DeFi (pool liquidity and gauges), bot-driven draw approvals end to end, and an agent SDK quickstart.' },
]

const TRACKS = [
  { n: 'Track 1', t: 'DeFi (Borrowing, Lending, Looping, and Yield)', b: 'Governed MUSD borrowing with an on-chain floor, Save into sMUSD, Swap on the Mezo DEX, and Loop back into collateral.' },
  { n: 'Track 2', t: 'Access and Distribution for MUSD/MEZO', b: 'A Telegram bot for monitoring and approvals, x402 MUSD payments for agents, and Mezo-style multi-wallet access.' },
]

export function Roadmap() {
  return (
    <Plate id="roadmap" n="IX" kicker="Heading" title={<>The course <em>past the hackathon.</em></>}>
      <ol className="grid gap-px overflow-hidden border border-ink/20 bg-ink/20 md:grid-cols-3">
        {MILES.map((m, i) => (
          <Reveal key={m.t} i={i} className="bg-paper p-8">
            <p className="mono text-sm text-magenta">{m.d} · {m.s}</p>
            <h3 className="display mt-2 text-3xl">{m.t}</h3>
            <p className="mt-4 text-ink/75">{m.b}</p>
          </Reveal>
        ))}
      </ol>
      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {TRACKS.map(t => (
          <div key={t.n} className="border-l-2 border-magenta pl-5">
            <p className="caps text-xs text-ink/60">{t.n}</p>
            <h3 className="display mt-1 text-2xl">{t.t}</h3>
            <p className="mt-2 text-ink/75">{t.b}</p>
          </div>
        ))}
      </div>
    </Plate>
  )
}
