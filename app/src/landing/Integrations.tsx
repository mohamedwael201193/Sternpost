import { Token, type TokenSym } from '../ui/Token'
import { Plate, Reveal } from './Plate'

const TOKENS: [TokenSym, string][] = [['BTC', 'Collateral'], ['MUSD', 'What gets drawn'], ['sMUSD', 'Optional reserve'], ['MEZO', 'Network'], ['tBTC', 'Bridged BTC']]
const MEZO = [
  ['BorrowerOperationsSignatures', 'withdrawMUSDWithSignature, repay, addColl (nonce burn)'],
  ['TroveManager', 'Live debt and collateral for ICR'],
  ['PriceFeed', 'BTC price used in every floor check'],
  ['MUSD', 'Drawn, budgeted, paid'],
  ['x402 facilitator', 'Per-request API payments settled on Mezo'],
]

export function Integrations() {
  return (
    <Plate id="integrations" n="X" kicker="Built on Mezo" title={<>Native to Mezo. <em>No new token, no new custody.</em></>} className="bg-paper2/60">
      <div className="grid gap-12 lg:grid-cols-2">
        <Reveal>
          <ul className="grid grid-cols-2 gap-px border border-ink/20 bg-ink/20 sm:grid-cols-3">
            {TOKENS.map(([s, d]) => (
              <li key={s} className="flex flex-col items-start gap-4 bg-paper p-6 transition hover:bg-paper2">
                <Token sym={s} size={44} />
                <div><p className="display text-2xl">{s}</p><p className="caps text-muted">{d}</p></div>
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal i={1}>
          <ul className="divide-y divide-ink/15 border-y border-ink/25">
            {MEZO.map(([t, d]) => (
              <li key={t} className="flex flex-wrap items-baseline justify-between gap-2 py-4">
                <span className="mono text-[.95rem]">{t}</span><span className="text-ink/70">{d}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </Plate>
  )
}
