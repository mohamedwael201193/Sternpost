import { Link } from 'react-router-dom'
import { RoseRule } from '../ui/Rose'
import { BOT_URL, TelegramButton, TelegramLogo } from './Telegram'

export function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-ink/20">
      <div className="contours absolute inset-0 opacity-60" aria-hidden />
      <div className="relative mx-auto max-w-[1280px] px-6 py-24 text-center lg:px-10">
        <p className="display text-[clamp(2.4rem,5vw,4.5rem)] leading-none">Set the floor. <em>Let them steer.</em></p>
        <RoseRule className="mx-auto my-10 max-w-sm" />
        <div className="flex flex-wrap justify-center gap-3">
          <Link to="/app" className="pill">Launch app <span aria-hidden>→</span></Link>
          <TelegramButton />
        </div>
        <div className="mt-20 flex flex-wrap items-center justify-between gap-4 border-t border-ink/20 pt-6 text-sm text-muted">
          <span className="display text-xl text-ink">Sternpost</span>
          <span>Built for the Mezo Buildathon · Testnet 31611 · Not audited</span>
          <span className="flex items-center gap-5">
            <a className="ink-link inline-flex items-center gap-1.5" href={BOT_URL} target="_blank" rel="noreferrer"><TelegramLogo size={16} /> Telegram ↗</a>
            <a className="ink-link" href="https://github.com/mohamedwael201193/Sternpost">GitHub ↗</a>
          </span>
        </div>
      </div>
    </footer>
  )
}
