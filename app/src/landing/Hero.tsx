import './hero.css'
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react'
import { Link } from 'react-router-dom'
import { BOT_URL, TelegramLogo } from './Telegram'

// Overlay shares a 1000×960 space; the ink plate fills x 0..590. Compass centre sits at (222, 411).
const CX = 222, CY = 411
const GX = 800, GY = 470, GR = 92
// Demo position shown on the landing page (labelled). Live values are on the dashboard.
const DEMO_ICR = 298, FLOOR = 250
const ang = (icr: number) => -120 + ((Math.min(Math.max(icr, 100), 400) - 100) / 300) * 240
const COURSE = `M${CX + 70} ${CY - 6} C 520 440, 620 520, ${GX - GR - 6} ${GY}`

export function Hero() {
  const reduce = !!useReducedMotion()
  const mx = useMotionValue(0), my = useMotionValue(0)
  const sx = useSpring(mx, { stiffness: 60, damping: 20 }), sy = useSpring(my, { stiffness: 60, damping: 20 })
  const bgX = useTransform(sx, v => v * -14), bgY = useTransform(sy, v => v * -10)
  const shipX = useTransform(sx, v => v * 6), shipY = useTransform(sy, v => v * 4)
  const onMove = (e: React.MouseEvent) => {
    if (reduce) return
    const r = e.currentTarget.getBoundingClientRect()
    mx.set((e.clientX - r.left) / r.width - .5); my.set((e.clientY - r.top) / r.height - .5)
  }
  const fade = (d: number) => (reduce ? {} : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: .7, delay: d } })

  return (
    <section onMouseMove={onMove} className="relative flex min-h-[calc(100svh-64px)] items-center overflow-hidden">
      <motion.div style={{ x: bgX, y: bgY }} className="contours absolute -inset-8 opacity-70" aria-hidden />
      <div className="hairgrid absolute inset-0 opacity-60 [mask-image:linear-gradient(to_bottom,#000_70%,transparent)]" aria-hidden />
      <div className="relative mx-auto grid w-full max-w-[1280px] items-center gap-8 px-6 pb-16 pt-12 lg:grid-cols-[1fr_1.3fr] lg:px-10">
        <div className="relative z-10">
          <motion.h1 {...fade(0)} className="display text-[clamp(2.8rem,5.6vw,5.2rem)] leading-[1.02] tracking-tight">
            Borrow against Bitcoin.<br />Never sail past the <em>floor.</em>
          </motion.h1>
          <motion.div {...fade(.2)} className="my-8 h-[3px] w-24 origin-left bg-magenta" />
          <motion.p {...fade(.3)} className="max-w-lg text-[1.2rem] leading-relaxed text-ink/80">
            Give apps and AI agents a MUSD budget on your Mezo trove. Every draw is checked on chain against the collateral floor you set, and anything below it reverts.
          </motion.p>
          <motion.div {...fade(.45)} className="mt-10 flex flex-wrap gap-3">
            <Link to="/app" className="pill !normal-case !tracking-normal text-base">Launch app <span aria-hidden>→</span></Link>
            <a href={BOT_URL} target="_blank" rel="noreferrer" className="pill-ghost !normal-case !tracking-normal text-base">
              <TelegramLogo size={22} /> Talk to @sternpost_bot
            </a>
          </motion.div>
        </div>

        <motion.div style={{ x: shipX, y: shipY }} className="relative mx-auto w-full max-w-[780px] lg:-my-10">
          <div className="relative" style={{ aspectRatio: '1000 / 960' }}>
            <motion.img src="/art/hero-stern.webp" width={590} height={895} fetchPriority="high"
              alt="Ink blueprint of a ship's stern and rudder with a Bitcoin compass"
              className="absolute left-0 top-0 h-full" style={{ width: '59%' }}
              {...(reduce ? {} : { initial: { clipPath: 'inset(0 0 100% 0)' }, animate: { clipPath: 'inset(0 0 0% 0)' }, transition: { duration: 1.4, ease: [.3, .7, .2, 1] } })} />
            <svg viewBox="0 0 1000 960" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
              <defs>
                <radialGradient id="hero-glow"><stop offset="0" stopColor="#E0306E" stopOpacity=".55" /><stop offset="1" stopColor="#E0306E" stopOpacity="0" /></radialGradient>
              </defs>
              {/* compass glow pulse + slow rotating bezel */}
              <circle cx={CX} cy={CY} r="120" fill="url(#hero-glow)" className={reduce ? '' : 'hero-pulse'} style={{ transformOrigin: `${CX}px ${CY}px` }} />
              <g className={reduce ? '' : 'hero-spin'} style={{ transformOrigin: `${CX}px ${CY}px` }}>
                <circle cx={CX} cy={CY} r="96" fill="none" stroke="#E0306E" strokeWidth="2" strokeDasharray="3 9" opacity=".8" />
                {[0, 90, 180, 270].map(a => <path key={a} d={`M${CX} ${CY - 104} v-14`} stroke="#E0306E" strokeWidth="3" transform={`rotate(${a} ${CX} ${CY})`} />)}
              </g>
              {/* course line flowing to the gauge */}
              <motion.path d={COURSE} fill="none" stroke="#A3204F" strokeWidth="3" strokeDasharray="10 9" className={reduce ? '' : 'hero-flow'} {...(reduce ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: .8, delay: 1.3 } })} />
              {/* callouts */}
              <motion.g {...fade(1.2)} fill="#17130F" fontFamily="Fraunces, serif" fontStyle="italic" fontSize="30">
                <text x="20" y="150">Floor</text><text x="20" y="186">250%</text>
                <path d="M30 200 v30 h60 v30" fill="none" stroke="#17130F" strokeWidth="1.5" />
                <text x="-10" y="790">Heal</text>
                <path d="M62 780 h50 M100 760 v40" fill="none" stroke="#17130F" strokeWidth="1.5" />
              </motion.g>
              {/* gauge */}
              <motion.g {...fade(1.6)}>
                <path d={`M${GX} ${GY - GR - 40} V${GY + 330} M${GX - 120} ${GY + 330} H${GX + 120}`} stroke="#17130F" strokeOpacity=".4" strokeWidth="1.5" strokeDasharray="4 6" />
                <circle cx={GX} cy={GY} r={GR + 8} fill="#F3EBDD" stroke="#17130F" strokeWidth="3" />
                <circle cx={GX} cy={GY} r={GR} fill="none" stroke="#17130F" strokeOpacity=".35" />
                {Array.from({ length: 13 }, (_, i) => -120 + i * 20).map(a => (
                  <path key={a} d={`M${GX} ${GY - GR} v${a % 60 === 0 ? 16 : 9}`} stroke="#17130F" strokeWidth={a % 60 === 0 ? 2.5 : 1.4} transform={`rotate(${a} ${GX} ${GY})`} />
                ))}
                <path d={`M${GX} ${GY - GR + 4} v18`} stroke="#A3204F" strokeWidth="4" transform={`rotate(${ang(FLOOR)} ${GX} ${GY})`} />
                <motion.g style={{ transformOrigin: `${GX}px ${GY}px` }}
                  initial={reduce ? { rotate: ang(DEMO_ICR) } : { rotate: -120 }} animate={{ rotate: ang(DEMO_ICR) }}
                  transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 70, damping: 9, delay: 1.9 }}>
                  <path d={`M${GX - 5} ${GY} L${GX} ${GY - GR + 14} L${GX + 5} ${GY} Z`} fill="#A3204F" />
                </motion.g>
                <circle cx={GX} cy={GY} r="9" fill="#17130F" />
                <text x={GX} y={GY + 52} textAnchor="middle" fontSize="40" fontWeight="600" fill="#A3204F" fontFamily="IBM Plex Mono">{DEMO_ICR}%</text>
                <rect x={GX - 118} y={GY + 130} width="236" height="48" fill="none" stroke="#A3204F" strokeWidth="2.5" strokeDasharray="7 5" />
                <text x={GX} y={GY + 162} textAnchor="middle" fontSize="22" letterSpacing="3" fill="#A3204F" fontFamily="IBM Plex Mono">COURSE: STEADY</text>
                <motion.path d={`M${GX - 100} ${GY + 300} L${GX + 100} ${GY + 300} L${GX + 100} ${GY + 232} Z`} fill="#A3204F"
                  {...(reduce ? {} : { initial: { scaleX: 0 }, animate: { scaleX: 1 }, transition: { duration: .8, delay: 2.1 } })} style={{ transformOrigin: `${GX - 100}px ${GY + 300}px` }} />
                <text x={GX} y={GY + 372} textAnchor="middle" fontSize="38" fontWeight="600" fill="#A3204F" fontFamily="IBM Plex Mono">{FLOOR}%</text>
                <text x={GX} y={GY + 404} textAnchor="middle" fontSize="22" letterSpacing="4" fill="#A3204F" fontFamily="IBM Plex Sans">FLOOR</text>
                <text x={GX} y={GY + 440} textAnchor="middle" fontSize="18" letterSpacing="2" fill="#6B6153" fontFamily="IBM Plex Sans">DEMO POSITION</text>
              </motion.g>
            </svg>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
