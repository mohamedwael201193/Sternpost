import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { useRef } from 'react'
import { Plate } from './Plate'

const STEPS = [
  { t: 'Set the floor', s: 'Once, from your wallet', d: 'Create your Governor, pick a floor ICR and a defend line, and give each app a budget, a per-draw cap and an expiry. Your trove never moves.', x: 200 },
  { t: 'Sign a draw', s: 'One click: Sign & send', d: 'You sign a short-lived Mezo withdraw that names the Governor, plus a standby repay. The app or agent submits it.', x: 600 },
  { t: 'Governor decides', s: 'Same transaction', d: 'It withdraws, reads live ICR and pays out only at or above your floor. Otherwise the whole transaction reverts.', x: 1000 },
]

/** Animated beam (after Magic UI's Animated Beam), drawn in ink and driven by scroll. */
export function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 80%', 'end 40%'] })
  const len = useTransform(scrollYProgress, [0, 1], [0, 1])
  return (
    <Plate id="how" n="IV" kicker="How it works" title={<>Three steps. <em>One floor.</em></>}>
      <div ref={ref} className="relative">
        <svg viewBox="0 0 1200 140" className="hidden w-full md:block" aria-hidden>
          <path d="M200 70 C 400 10, 400 130, 600 70 S 800 10, 1000 70" fill="none" stroke="#17130F" strokeOpacity=".18" strokeWidth="1.5" strokeDasharray="4 6" />
          <motion.path d="M200 70 C 400 10, 400 130, 600 70 S 800 10, 1000 70" fill="none" stroke="#A3204F" strokeWidth="2.4"
            style={{ pathLength: reduce ? 1 : len }} />
          {!reduce && (
            <circle r="5" fill="#A3204F">
              <animateMotion dur="4.5s" repeatCount="indefinite" path="M200 70 C 400 10, 400 130, 600 70 S 800 10, 1000 70" />
            </circle>
          )}
          {STEPS.map((s, i) => (
            <g key={s.t}>
              <circle cx={s.x} cy="70" r="30" fill="#F3EBDD" stroke="#17130F" strokeWidth="1.4" />
              <text x={s.x} y="80" textAnchor="middle" className="display" fontSize="28" fill="#17130F">{['1', '2', '3'][i]}</text>
            </g>
          ))}
        </svg>
        <ol className="mt-8 grid gap-10 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.t} className="border-t border-ink/25 pt-5">
              <p className="caps text-magenta md:hidden">{['1', '2', '3'][i]}</p>
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
