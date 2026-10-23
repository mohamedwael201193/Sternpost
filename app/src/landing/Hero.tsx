import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { Link } from 'react-router-dom'
import { RoseRule } from '../ui/Rose'

// Overlay coordinates share the plate's 1179×1380 space; labels live in the extra right margin.
const NOTES = [
  { t: 'Stern frame', d: ['Your trove stays', 'in your wallet.'], from: [842, 362], to: [1265, 230] },
  { t: 'Rudder authority', d: ['Every draw checked', 'against live ICR.'], from: [700, 900], to: [1265, 600] },
  { t: 'Bitcoin compass', d: ['Unsafe draws', 'revert on-chain.'], from: [860, 1180], to: [1265, 960] },
]

export function Hero() {
  const reduce = useReducedMotion()
  const { scrollY } = useScroll()
  const y = useTransform(scrollY, [0, 600], [0, reduce ? 0 : 60])
  const draw = (delay: number) => (reduce ? {} : { initial: { pathLength: 0, opacity: 0 }, animate: { pathLength: 1, opacity: 1 }, transition: { duration: 1, delay, ease: 'easeInOut' as const } })
  const fade = (delay: number) => (reduce ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: .7, delay } })

  return (
    <section className="relative overflow-hidden min-h-[calc(100svh-64px)] flex items-center">
      <div className="contours absolute inset-0 opacity-90" aria-hidden />
      <div className="hairgrid absolute inset-0 [mask-image:linear-gradient(to_bottom,#000_70%,transparent)]" aria-hidden />
      <div className="relative mx-auto grid max-w-[1280px] items-center gap-6 px-6 pb-16 pt-14 lg:grid-cols-[1fr_1.15fr] lg:px-10 lg:pb-24 lg:pt-20">
        <div className="relative z-10">
          <motion.p {...fade(0)} className="caps mb-6 text-magenta">Plate I · Mezo Testnet</motion.p>
          <motion.h1 {...fade(.05)} className="display text-[clamp(3.2rem,7vw,6.4rem)] leading-[.95]">
            Credit that<br />steers itself.
          </motion.h1>
          <motion.div {...fade(.25)}><RoseRule className="my-8 max-w-[26rem]" /></motion.div>
          <motion.p {...fade(.35)} className="max-w-md text-[1.35rem] leading-snug display">
            Bounded MUSD draws from your own Mezo trove.<br />
            <em>Unsafe draws revert on-chain.</em>
          </motion.p>
          <motion.div {...fade(.5)} className="mt-10 flex flex-wrap gap-3">
            <Link to="/app" className="pill">Open the dashboard <span aria-hidden>→</span></Link>
            <a href="#proof" className="pill-ghost">See it on testnet</a>
          </motion.div>
        </div>

        <motion.div style={{ y }} className="relative mx-auto w-full max-w-[680px]">
          <div className="relative" style={{ aspectRatio: '1900 / 1420' }}>
            <img src="/art/stern.svg" alt="Ink drawing of a ship's stern, rudder and a Bitcoin compass" width={1179} height={1380}
              className="pen-reveal absolute left-0 top-0 h-auto" style={{ width: `${(1179 / 1900) * 100}%` }} fetchPriority="high" />
            <svg viewBox="0 0 1900 1420" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
              <motion.circle cx="641" cy="955" r="300" fill="none" stroke="#A3204F" strokeWidth="3" strokeDasharray="14 12" {...draw(1.2)} />
              {NOTES.map((n, i) => (
                <g key={n.t}>
                  <motion.path d={`M${n.from[0]} ${n.from[1]} L${n.to[0] - 70} ${n.to[1]} L${n.to[0] - 10} ${n.to[1]}`} fill="none" stroke="#A3204F" strokeWidth="3" {...draw(1.4 + i * .25)} />
                  <motion.circle cx={n.from[0]} cy={n.from[1]} r="9" fill="#A3204F" {...fade(1.4 + i * .25)} />
                  <motion.g {...fade(1.7 + i * .25)}>
                    <text x={n.to[0]} y={n.to[1] + 10} fill="#A3204F" fontSize="40" letterSpacing="5" fontFamily="IBM Plex Sans">{n.t.toUpperCase()}</text>
                    {n.d.map((l, j) => <text key={l} x={n.to[0]} y={n.to[1] + 64 + j * 48} fill="#17130F" fontSize="40" className="display">{l}</text>)}
                  </motion.g>
                </g>
              ))}
              <motion.g {...fade(2.4)}>
                <path d="M1240 1110 V1400 M1240 1110 h16 M1240 1400 h16 M1880 1110 V1400 M1880 1110 h-16 M1880 1400 h-16" stroke="#A3204F" strokeWidth="3" fill="none" />
                <path d="M1250 1380 H1870 M1250 1380 l18 -10 M1250 1380 l18 10 M1870 1380 l-18 -10 M1870 1380 l-18 10" stroke="#A3204F" strokeWidth="3" fill="none" />
                <text x="1560" y="1180" textAnchor="middle" fontSize="36" letterSpacing="5" fill="#17130F" fontFamily="IBM Plex Sans">COLLATERAL FLOOR</text>
                <text x="1560" y="1265" textAnchor="middle" fontSize="70" fill="#17130F" className="display">you set it</text>
                <text x="1560" y="1330" textAnchor="middle" fontSize="28" letterSpacing="4" fill="#6B6153" fontFamily="IBM Plex Sans">ENFORCED BY THE GOVERNOR</text>
              </motion.g>
            </svg>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
