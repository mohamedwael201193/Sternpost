import { txUrl } from '../lib/proofs'
import { Plate, Reveal } from './Plate'
import { BOT_URL, TelegramLogo } from './Telegram'

const BOT = ['/link: connect your wallet with one gas-free signature', '/status: collateral ratio, floor and balances', 'Alerts when your ratio nears the floor', 'Draw requests with Approve and Reject buttons', 'Revoke in one tap']

export function Agents() {
  return (
    <Plate id="agents" n="VII" kicker="Payments and access" title={<>Agents pay in MUSD. <em>You steer from Telegram.</em></>}>
      <div className="grid gap-px overflow-hidden border border-ink/20 bg-ink/20 lg:grid-cols-2">
        <Reveal className="bg-paper p-8 lg:p-10">
          <p className="caps text-magenta">x402 payments</p>
          <h3 className="display mt-2 text-3xl leading-tight">An agent buys an API call with MUSD</h3>
          <p className="mt-4 text-ink/75">Draws land in a SpendWallet: an EIP-1271 wallet run by the agent's session key, with a Permit2 budget. It pays per request over x402, and a facilitator pays the gas. The receipt is a settlement transaction on Mezo.</p>
          <a href={txUrl('0x2a6d515c2f325a917e33a77c7f611ca86ffbd7fb21489d0225f296e4ecf38d06')} target="_blank" rel="noreferrer" className="mono ink-link mt-6 inline-block text-sm text-magenta">Paid API brief, 0x2a6d515c… ↗</a>
        </Reveal>
        <Reveal i={1} className="bg-paper p-8 lg:p-10">
          <p className="caps flex items-center gap-2 text-magenta"><TelegramLogo size={18} /> Telegram bot</p>
          <h3 className="display mt-2 text-3xl leading-tight">@sternpost_bot</h3>
          <ul className="mt-4 space-y-2 text-ink/75">{BOT.map(b => <li key={b} className="border-l-2 border-magenta/50 pl-3">{b}</li>)}</ul>
          <p className="mt-4 text-sm text-muted">The bot holds no keys. Approving still needs your wallet signature on chain, so a tap in chat can never spend money.</p>
          <a href={BOT_URL} target="_blank" rel="noreferrer" className="pill mt-6 inline-flex items-center gap-2"><TelegramLogo size={20} /> Open in Telegram</a>
        </Reveal>
      </div>
    </Plate>
  )
}
