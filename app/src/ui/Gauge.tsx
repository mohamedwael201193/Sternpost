import { motion, useReducedMotion } from 'motion/react'

const PIVOT = { transformOrigin: '100px 100px', transformBox: 'view-box' } as const
const MIN = 100, MAX = 500, SWEEP = 270
const angle = (pct: number) => -135 + (Math.min(Math.max(pct, MIN), MAX) - MIN) / (MAX - MIN) * SWEEP
const polar = (a: number, r: number) => {
  const rad = ((a - 90) * Math.PI) / 180
  return [100 + r * Math.cos(rad), 100 + r * Math.sin(rad)] as const
}
const arc = (a0: number, a1: number, r: number) => {
  const [x0, y0] = polar(a0, r), [x1, y1] = polar(a1, r)
  return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`
}

/** Compass-style ICR dial. `value`/`floor`/`projected` are percentages (e.g. 312). `value` null = no trove. */
export function Gauge({ value, floor, projected, size = 320, label = 'Collateral ratio' }: {
  value: number | null; floor?: number; projected?: number | null; size?: number; label?: string
}) {
  const reduce = useReducedMotion()
  const ticks = Array.from({ length: 41 }, (_, i) => i)
  const unsafe = projected != null && floor != null && projected < floor
  return (
    <figure className="relative select-none" style={{ width: size }} aria-label={`${label}: ${value == null ? 'no trove' : value.toFixed(0) + '%'}`}>
      <svg viewBox="0 0 200 214" className="w-full overflow-visible">
        {/* bow + crown like a pocket compass */}
        <circle cx="100" cy="-4" r="9" fill="none" stroke="#17130F" strokeWidth="1.4" />
        <rect x="92" y="4" width="16" height="9" rx="2" fill="#EFE5D3" stroke="#17130F" strokeWidth="1" />
        <circle cx="100" cy="100" r="92" fill="#EFE5D3" stroke="#17130F" strokeWidth="2.2" />
        <circle cx="100" cy="100" r="86" fill="none" stroke="#17130F" strokeWidth=".6" />
        <circle cx="100" cy="100" r="62" fill="none" stroke="#17130F" strokeOpacity=".35" strokeWidth=".5" strokeDasharray="1 2" />
        {ticks.map((i) => {
          const a = -135 + (i / 40) * SWEEP, major = i % 5 === 0
          const [x0, y0] = polar(a, 84), [x1, y1] = polar(a, major ? 74 : 79)
          const [tx, ty] = polar(a, 66)
          return (
            <g key={i}>
              <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="#17130F" strokeWidth={major ? 1.1 : .5} />
              {major && <text x={tx} y={ty + 2.5} fontSize="6.5" textAnchor="middle" className="mono" fill="#17130F">{MIN + (i / 40) * (MAX - MIN)}</text>}
            </g>
          )
        })}
        {floor != null && (
          <>
            <motion.path d={arc(-135, angle(floor), 80)} fill="none" stroke="#A3204F" strokeWidth="6" strokeLinecap="round" strokeOpacity=".9"
              initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: 'easeOut' }} />
            <line x1={polar(angle(floor), 88)[0]} y1={polar(angle(floor), 88)[1]} x2={polar(angle(floor), 70)[0]} y2={polar(angle(floor), 70)[1]} stroke="#A3204F" strokeWidth="1.6" />
          </>
        )}
        {projected != null && value != null && (
          <motion.g initial={false} animate={{ rotate: angle(projected) }} style={PIVOT} transition={{ type: 'spring', stiffness: 120, damping: 18 }}>
            <line x1="100" y1="100" x2="100" y2="30" stroke={unsafe ? '#FF004D' : '#2F7D4F'} strokeWidth="1.2" strokeDasharray="3 2" />
          </motion.g>
        )}
        {value != null && (
          <motion.g initial={reduce ? false : { rotate: -135 }} animate={{ rotate: angle(value) }} style={PIVOT}
            transition={{ type: 'spring', stiffness: 70, damping: 14, delay: .2 }}>
            <path d="M100 30 L106 100 L100 108 L94 100 Z" fill="#A3204F" stroke="#17130F" strokeWidth=".8" />
          </motion.g>
        )}
        {floor != null && <text x="100" y="176" textAnchor="middle" className="display" fontStyle="italic" fontSize="9" fill="#A3204F">Floor {floor.toFixed(0)}%</text>}
        <circle cx="100" cy="100" r="7" fill="#EFE5D3" stroke="#17130F" strokeWidth="1.6" />
        <text x="100" y="146" textAnchor="middle" className="display" fontSize="25" fill="#17130F">{value == null ? '—' : `${value >= 1000 ? '999+' : value.toFixed(0)}%`}</text>
        <text x="100" y="160" textAnchor="middle" fontSize="5.6" letterSpacing="1.4" fill="#6B6153">{label.toUpperCase()}</text>
      </svg>
    </figure>
  )
}
