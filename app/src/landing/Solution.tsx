import { Plate, Reveal } from './Plate'

const PARTS = [
  { k: 'Floor', t: 'ICR checked on chain', d: 'After every draw the Governor reads your trove from TroveManager and the BTC price from Mezo. Below your floor — 250% on the live Governor — the whole transaction reverts with Unsafe().' },
  { k: 'Gate', t: 'No way around it', d: 'Withdraw signatures name the Governor as recipient. Mezo calls back into the Governor during the withdraw, and the Governor accepts that call only inside its own draw(). A signature sent straight to Mezo reverts.' },
  { k: 'Defend', t: 'The account heals itself in a storm', d: 'Each draw comes with a repay signature for the next nonce. If ICR falls under your defend line, anyone can call defend() to repay from a buffer that can earn in sMUSD while it waits. Verified on testnet: defend() repaid 30 MUSD and lifted ICR from 2.3791 to 2.4081 (block 16794538).' },
  { k: 'Exit', t: 'One transaction stops everything', d: 'revoke() freezes draws and burns your Mezo nonce, so every signature you handed out stops working. And when you are done, closeAccount lets you exit — except in Recovery Mode, where close is blocked until the storm passes.' },
]

export function Solution() {
  return (
    <Plate id="solution" n="III" kicker="The solution" title={<>A Governor between your trove <em>and every app.</em></>}>
      <div className="grid gap-px overflow-hidden border border-ink/20 bg-ink/20 md:grid-cols-2 lg:grid-cols-4">
        {PARTS.map((p, i) => (
          <Reveal key={p.k} i={i} className="bg-paper p-8 transition-colors hover:bg-paper2">
            <p className="caps text-magenta">{p.k}</p>
            <h3 className="display mt-2 text-3xl leading-tight">{p.t}</h3>
            <p className="mt-4 text-ink/75">{p.d}</p>
          </Reveal>
        ))}
      </div>
      <Reveal className="mt-10 max-w-3xl text-ink/75">
        Each app gets its own budget, a per-draw cap, an expiry and an optional payee lock. <span className="mono">previewDraw()</span> tells you the reason a draw would fail before you sign anything. The Governor takes 10 bps per agent draw — immutable, capped at 50 bps. Redemptions settle through claimCollateral, the path built for the 0.0105 BTC surplus a lab redemption left stuck.
      </Reveal>
    </Plate>
  )
}
