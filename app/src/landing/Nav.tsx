import { Link } from 'react-router-dom'

const LINKS = [['How it works', '#how'], ['Safety', '#floor'], ['Routes', '#routes'], ['Proof', '#proof'], ['Docs', 'https://github.com/mohamedwael201193/Sternpost#readme'], ['FAQ', '#faq']] as const

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-ink/15 bg-paper/80 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-6 lg:px-10">
        <a href="/" className="display text-[1.7rem] leading-none">Sternpost</a>
        <ul className="hidden items-center gap-10 md:flex">
          {LINKS.map(([l, h]) => (
            <li key={l}><a href={h} className="caps ink-link text-ink/85 hover:text-ink">{l}</a></li>
          ))}
        </ul>
        <Link to="/app" className="pill">Launch app <span aria-hidden>→</span></Link>
      </nav>
    </header>
  )
}
