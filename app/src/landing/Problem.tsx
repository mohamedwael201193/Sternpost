import { Plate, Reveal } from './Plate'

const CARDS = [
  { k: 'Option A', t: 'Hand the agent your keys', d: 'It can borrow until liquidation. There is no limit you can enforce, only hope.', fig: 'M10 40 h40 M30 40 V14 a8 8 0 1 1 0.1 0 M30 24 h8 M30 30 h6' },
  { k: 'Option B', t: 'Move the trove into a vault', d: 'Custody leaves your wallet, and the vault becomes one more contract to trust and migrate.', fig: 'M8 18 h44 v28 h-44 z M8 26 h44 M24 34 h12' },
  { k: 'Option C', t: 'Sign raw Mezo withdrawals', d: 'Mezo signatures bind amount, recipient, nonce and deadline. Not your collateral floor.', fig: 'M10 46 C20 10 40 10 50 46 M10 30 h40' },
]

export function Problem() {
  return (
    <Plate id="problem" n="II" kicker="The problem" title={<>Agents need money. <em>Your trove needs a rudder.</em></>}>
      <div className="grid gap-px overflow-hidden border border-ink/20 bg-ink/20 md:grid-cols-3">
        {CARDS.map((c, i) => (
          <Reveal key={c.t} i={i} className="group bg-paper p-8 transition-colors hover:bg-paper2">
            <svg viewBox="0 0 60 56" className="mb-8 h-16 w-16" aria-hidden>
              <path d={c.fig} fill="none" stroke="#17130F" strokeWidth="1.2" />
              <path d="M6 52 L54 4" stroke="#A3204F" strokeWidth="1.4" className="origin-center scale-0 transition-transform duration-500 group-hover:scale-100" />
            </svg>
            <p className="caps text-muted">{c.k}</p>
            <h3 className="display mt-2 text-3xl leading-tight">{c.t}</h3>
            <p className="mt-4 text-ink/75">{c.d}</p>
          </Reveal>
        ))}
      </div>
      <Reveal className="mt-10 max-w-2xl display text-2xl italic text-ink/80">
        Sternpost is the fourth option: the trove never moves, and every draw passes a floor you set, in the same transaction.
      </Reveal>
    </Plate>
  )
}
