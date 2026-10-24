import type { ReactNode } from 'react'

/**
 * Reveals are pure CSS scroll-driven animations (`.reveal` in index.css). Content is visible by default and only
 * fades in where the browser supports view timelines and motion is allowed, so no-JS, no-IntersectionObserver,
 * reduced-motion and full-page captures all see every section.
 */
export function Plate({ id, n, kicker, title, children, className = '' }: {
  id?: string; n: string; kicker: string; title: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <section id={id} className={`relative scroll-mt-20 border-t border-ink/15 ${className}`}>
      <div className="mx-auto max-w-[1280px] px-6 py-24 lg:px-10 lg:py-32">
        <header className="reveal mb-14 grid gap-4 lg:grid-cols-[180px_1fr]">
          <p className="caps text-magenta">Plate {n}<br /><span className="text-muted">{kicker}</span></p>
          <h2 className="display max-w-3xl text-[clamp(2.2rem,4.4vw,3.8rem)] leading-[1.02]">{title}</h2>
        </header>
        {children}
      </div>
    </section>
  )
}

export function Reveal({ children, className = '' }: { children: ReactNode; i?: number; className?: string }) {
  return <div className={`reveal ${className}`}>{children}</div>
}
