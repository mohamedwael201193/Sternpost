import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { useRef } from 'react'
import { Plate } from './Plate'

const STEPS = [
  { t: 'Your trove', s: 'Stays in your EOA', d: 'BTC collateral and MUSD debt never leave your wallet. You sign typed messages, not custody.', x: 120 },
  { t: 'Governor', s: 'Checks the floor', d: 'The app asks for an amount. The Governor withdraws, reads live ICR, and reverts below your floor.', x: 440 },
  { t: 'Spend wallet', s: 'ERC-1271 budget', d: 'MUSD lands in a capped wallet the agent can sign for, never your trove.', x: 760 },
  { t: 'API', s: 'Paid via x402', d: 'The agent pays per request. The receipt is a settlement transaction on Mezo.', x: 1080 },
]

/** Animated beam (after Magic UI's Animated Beam), drawn in ink and driven by scroll. */
export function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 80%', 'end 40%'] })
  const len = useTransform(scrollYProgress, [0, 1], [0, 1])
  return (
    <Plate id="how" n="III" kicker="How it works" title={<>One signed request. <em>Four stations.</em> One floor.</>}>
      <div ref={ref} className="relative">
        <svg viewBox="0 0 1200 140" className="hidden w-full md:block" aria-hidden>
          <path d="M120 70 C 280 10, 280 130, 440 70 S 600 10, 760 70 S 920 130, 1080 70" fill="none" stroke="#17130F" strokeOpacity=".18" strokeWidth="1.5" strokeDasharray="4 6" />
          <motion.path d="M120 70 C 280 10, 280 130, 440 70 S 600 10, 760 70 S 920 130, 1080 70" fill="none" stroke="#A3204F" strokeWidth="2.4"
            style={{ pathLength: reduce ? 1 : len }} />
          {!reduce && (
            <circle r="5" fill="#A3204F">
              <animateMotion dur="4.5s" repeatCount="indefinite" path="M120 70 C 280 10, 280 130, 440 70 S 600 10, 760 70 S 920 130, 1080 70" />
            </circle>
          )}
          {STEPS.map((s, i) => (
            <g key={s.t}>
              <circle cx={s.x} cy="70" r="30" fill="#F3EBDD" stroke="#17130F" strokeWidth="1.4" />
              <text x={s.x} y="80" textAnchor="middle" className="display" fontSize="28" fill="#17130F">{['I', 'II', 'III', 'IV'][i]}</text>
            </g>
          ))}
        </svg>
        <ol className="mt-8 grid gap-10 md:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.t} className="border-t border-ink/25 pt-5">
              <p className="caps text-magenta md:hidden">{['I', 'II', 'III', 'IV'][i]}</p>
              <h3 className="display text-3xl">{s.t}</h3>
              <p className="caps mt-1 text-muted">{s.s}</p>
              <p className="mt-4 text-ink/75">{s.d}</p>
            </li>
          ))}
        </ol>
        <div className="mt-14 grid gap-px border border-ink/20 bg-ink/20 md:grid-cols-3">
          {[
            ['Gated receive', 'A Governor-addressed signature sent straight to Mezo reverts: the Governor refuses the callback unless it is inside its own draw().'],
            ['120-second window', 'Withdraw signatures expire fast, so a leaked one is worth little.'],
            ['Nonce-burn revoke', 'One transaction advances your Mezo nonce. Every outstanding signature dies at once.'],
          ].map(([t, d]) => (
            <div key={t} className="bg-paper p-7"><h4 className="display text-2xl">{t}</h4><p className="mt-3 text-ink/75">{d}</p></div>
          ))}
        </div>
      </div>
    </Plate>
  )
}
