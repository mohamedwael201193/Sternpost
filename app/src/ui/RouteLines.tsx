import { useReducedMotion } from 'motion/react'
import { useEffect, useState, type RefObject } from 'react'

type Edge = 'top' | 'bottom' | 'left' | 'right'
export type Link = { from: RefObject<HTMLElement | null>; fromEdge: Edge; to: RefObject<HTMLElement | null>; toEdge: Edge }

const pt = (r: DOMRect, base: DOMRect, e: Edge) => {
  const x = e === 'left' ? r.left : e === 'right' ? r.right : r.left + r.width / 2
  const y = e === 'top' ? r.top : e === 'bottom' ? r.bottom : r.top + r.height / 2
  return [x - base.left, y - base.top] as const
}

// Passive effect: the host ref is attached after child layout effects run.
/** Dashed magenta courses between live cards, measured from the DOM so they follow any layout. */
export function RouteLines({ host, links }: { host: RefObject<HTMLElement | null>; links: Link[] }) {
  const reduce = useReducedMotion()
  const [paths, setPaths] = useState<string[]>([])
  useEffect(() => {
    const el = host.current
    if (!el) return
    const draw = () => {
      const base = el.getBoundingClientRect()
      setPaths(links.flatMap(({ from, fromEdge, to, toEdge }) => {
        if (!from.current || !to.current) return []
        const [x0, y0] = pt(from.current.getBoundingClientRect(), base, fromEdge)
        const [x1, y1] = pt(to.current.getBoundingClientRect(), base, toEdge)
        const vert = fromEdge === 'top' || fromEdge === 'bottom'
        const c = vert ? `${x0} ${(y0 + y1) / 2}, ${x1} ${(y0 + y1) / 2}` : `${(x0 + x1) / 2} ${y0}, ${(x0 + x1) / 2} ${y1}`
        return [`M${x0} ${y0} C${c}, ${x1} ${y1}`]
      }))
    }
    draw()
    const ro = new ResizeObserver(draw); ro.observe(el)
    window.addEventListener('resize', draw)
    return () => { ro.disconnect(); window.removeEventListener('resize', draw) }
  }, [host, links])
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none hidden xl:block" aria-hidden>
      {paths.map((d, i) => (
        <g key={i}>
          <path d={d} fill="none" stroke="#E5195E" strokeOpacity=".75" strokeWidth="1.3" strokeLinecap="round" className="route-line" />
          {!reduce && <circle r="3" fill="#F6EFE3" stroke="#E5195E" strokeWidth="1.2"><animateMotion dur={`${5 + i}s`} repeatCount="indefinite" path={d} /></circle>}
        </g>
      ))}
    </svg>
  )
}
