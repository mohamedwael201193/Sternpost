import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'

export function Plate({ id, n, kicker, title, children, className = '' }: {
  id?: string; n: string; kicker: string; title: ReactNode; children: ReactNode; className?: string
}) {
  const reduce = useReducedMotion()
  return (
    <section id={id} className={`relative scroll-mt-20 border-t border-ink/15 cv-auto ${className}`}>
      <div className="mx-auto max-w-[1280px] px-6 py-24 lg:px-10 lg:py-32">
        <motion.header
          initial={reduce ? false : { opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: .7, ease: [.2, .7, .2, 1] }}
          className="mb-14 grid gap-4 lg:grid-cols-[180px_1fr]">
          <p className="caps text-magenta">Plate {n}<br /><span className="text-muted">{kicker}</span></p>
          <h2 className="display max-w-3xl text-[clamp(2.2rem,4.4vw,3.8rem)] leading-[1.02]">{title}</h2>
        </motion.header>
        {children}
      </div>
    </section>
  )
}

export function Reveal({ children, i = 0, className = '' }: { children: ReactNode; i?: number; className?: string }) {
  const reduce = useReducedMotion()
  return (
    <motion.div className={className} initial={reduce ? false : { opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }} transition={{ duration: .65, delay: i * .08, ease: [.2, .7, .2, 1] }}>
      {children}
    </motion.div>
  )
}
