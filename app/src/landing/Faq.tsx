import { Plate } from './Plate'

const QA = [
  ['Does my trove move?', 'No. Your trove stays in your own wallet. The Governor only holds MUSD for the moment it takes to check the floor and pay it on.'],
  ['What stops an app from going around the Governor?', 'Withdraw signatures name the Governor as recipient. If anyone submits one straight to Mezo, the Governor refuses the zero-value callback Mezo sends, so the whole transaction reverts.'],
  ['How do I revoke?', 'Revoke freezes the Governor and burns your Mezo signature nonce in one transaction. Every signature you gave out becomes invalid.'],
  ['What if Mezo upgrades its contracts?', 'The veto depends on Mezo sending that callback today. Our test suite includes the case where it disappears, and heal() can repay any stray MUSD back into your trove.'],
  ['Is it audited or on mainnet?', 'Neither yet. Everything shown runs on Mezo testnet, with tests on testnet and mainnet forks.'],
]

export function Faq() {
  return (
    <Plate id="faq" n="XI" kicker="Margin notes" title={<>Questions, <em>answered in the margin.</em></>}>
      <div className="divide-y divide-ink/15 border-y border-ink/25">
        {QA.map(([q, a]) => (
          <details key={q} className="group py-6">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-6 display text-2xl">
              {q}<span className="text-magenta transition-transform group-open:rotate-45" aria-hidden>+</span>
            </summary>
            <p className="mt-4 max-w-3xl border-l-2 border-magenta/60 pl-5 text-ink/80">{a}</p>
          </details>
        ))}
      </div>
    </Plate>
  )
}
