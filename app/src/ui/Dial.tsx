import { motion, useReducedMotion } from 'motion/react'

const MIN = 100, MAX = 500, A0 = -120, SWEEP = 240
const ang = (p: number) => A0 + (Math.min(Math.max(p, MIN), MAX) - MIN) / (MAX - MIN) * SWEEP
const pol = (a: number, r: number) => { const t = ((a - 90) * Math.PI) / 180; return [100 + r * Math.cos(t), 100 + r * Math.sin(t)] as const }
const arc = (a0: number, a1: number, r: number) => {
  const [x0, y0] = pol(a0, r), [x1, y1] = pol(a1, r)
  return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`
}

/** Chartroom collateral-ratio dial: hairline bezel, magenta health arc, spring needle, floor mark. Percentages in. */
export function Dial({ value, floor, size = 260 }: { value: number | null; floor?: number; size?: number }) {
  const reduce = useReducedMotion()
  const healthy = value != null && (floor == null || value >= floor + 20)
  const state = value == null ? '—' : floor != null && value < floor ? 'Below floor' : healthy ? 'Healthy' : 'Near floor'
  return (
    <figure className="relative select-none" style={{ width: size }} aria-label={`Collateral ratio ${value == null ? 'unknown' : value.toFixed(0) + '%'}`}>
      <svg viewBox="0 0 200 200" className="w-full overflow-visible">
        <circle cx="100" cy="100" r="96" fill="#F6EFE3" stroke="#17130F" strokeOpacity=".5" strokeWidth=".8" />
        <circle cx="100" cy="100" r="90" fill="none" stroke="#17130F" strokeOpacity=".2" strokeWidth=".5" />
        {Array.from({ length: 49 }, (_, i) => {
          const a = A0 + (i / 48) * SWEEP, major = i % 6 === 0
          const [x0, y0] = pol(a, 86), [x1, y1] = pol(a, major ? 76 : 81)
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke="#17130F" strokeOpacity={major ? .8 : .4} strokeWidth={major ? 1 : .5} />
        })}
        <path d={arc(A0, A0 + SWEEP, 70)} fill="none" stroke="#17130F" strokeOpacity=".12" strokeWidth="5" />
        {value != null && (
          <motion.path d={arc(A0, ang(value), 70)} fill="none" stroke={healthy ? '#E5195E' : '#FF004D'} strokeWidth="5" strokeLinecap="round"
            initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, ease: [.2, .8, .2, 1] }} />
        )}
        {floor != null && (() => {
          const [x0, y0] = pol(ang(floor), 92), [x1, y1] = pol(ang(floor), 62)
          return <g><line x1={x0} y1={y0} x2={x1} y2={y1} stroke="#A3204F" strokeWidth="1.6" /><circle cx={x0} cy={y0} r="2.2" fill="#A3204F" /></g>
        })()}
        {value != null && (
          <motion.g initial={reduce ? false : { rotate: A0 }} animate={{ rotate: ang(value) }} style={{ transformOrigin: '100px 100px', transformBox: 'view-box' }}
            transition={{ type: 'spring', stiffness: 60, damping: 11, delay: .25 }}>
            <path d="M100 22 L103 96 L100 100 L97 96 Z" fill="#17130F" />
          </motion.g>
        )}
        <circle cx="100" cy="100" r="3.2" fill="#17130F" />
      </svg>
      <div className="absolute inset-x-0 top-[50%] text-center pointer-events-none">
        <div className="display leading-none" style={{ fontSize: size * .2 }} data-testid="dial-value">
          {value == null ? '—' : value >= 1000 ? '999+' : value.toFixed(0)}<span className="text-magenta" style={{ fontSize: size * .11 }}>%</span>
        </div>
        <div className={`mt-1 inline-flex items-center gap-1 text-sm ${healthy || value == null ? 'text-ink' : 'text-signal'}`}>
          <svg viewBox="0 0 24 24" className="w-4 h-4 text-magenta" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>
          {state}
        </div>
      </div>
      <figcaption className="absolute inset-x-6 bottom-[6%] flex justify-between items-end text-[10px] caps text-muted">
        <span>Floor</span><span className="mono text-ink normal-case tracking-normal text-xs">{floor != null ? `${floor.toFixed(0)}%` : '—'}</span>
      </figcaption>
    </figure>
  )
}
