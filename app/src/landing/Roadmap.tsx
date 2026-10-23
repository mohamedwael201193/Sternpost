import { Plate, Reveal } from './Plate'

const MILES = [
  { d: 'Oct 26, 2026', s: 'Live now', t: 'Wave 1 on testnet', b: 'Governor, Factory, SpendWallet and Router v2 live on Mezo testnet. Dashboard, SDK, x402 API and Telegram bot.' },
  { d: 'Nov 15, 2026', s: 'Planned', t: 'Wave 2 depth', b: 'More routes into Mezo DeFi (pool liquidity and gauges), bot-driven draw approvals end to end, and an agent SDK quickstart.' },
  { d: 'Q1 2027', s: 'Planned', t: 'Audit, then mainnet', b: 'External audit of the Governor and Router, then a capped mainnet launch with source-verified contracts.' },
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
    </Plate>
  )
}
