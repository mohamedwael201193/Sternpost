import { Plate } from './Plate'

const QA = [
  ['Does my trove move?', 'No. Your trove stays in your own wallet. The Governor only holds MUSD for the moment it takes to check the floor and pay it on.'],
  ['What stops an app from going around the Governor?', 'Withdraw signatures name the Governor as recipient. If anyone submits one straight to Mezo, the Governor refuses the zero-value callback Mezo sends, so the whole transaction reverts.'],
  ['How do I revoke?', 'Revoke freezes the Governor and burns your Mezo signature nonce in one transaction. Every signature you gave out becomes invalid.'],
  ['What happens in a storm — does anything defend the trove?', 'Yes. If ICR falls under your defend line, anyone can call defend() and repay from your buffer. On testnet it repaid 30 MUSD and lifted ICR from 2.3791 to 2.4081 (tx 0x3e57c0b2…87600c2, block 16794538). In Recovery Mode draws are blocked while repay and add collateral stay open. Fork tests cover draw, heal, revoke and defend; Recovery Mode itself is unit-tested.'],
  ['Can a stranger shield my trove?', 'Shield by a stranger is deployed in the TroveAccount implementation (Blockscout-verified), never yet called on a live production account. The design: anyone tops up your defence for a keeper bounty you set, capped at 5 MUSD per shield. Lab shield: ICR 1.4649 to 1.5999, bounty 1 MUSD.'],
  ['What about redemptions — can value get stuck?', 'claimCollateral is deployed on the TroveAccount contracts but never run on a production account yet. In the lab, a redemption left surplus stuck in Mezo\'s CollSurplusPool because the deployed V3 account had no claimCollateral wrapper — that is the case it exists for.'],
  ['Can I sign in with a Bitcoin wallet?', 'Yes, via OrangeKit — but be honest about the limit: a Bitcoin wallet can own and steer, it cannot draw, because Mezo checks ECDSA.recover only.'],
  ['Can I always exit?', 'The live exit is revoke(): it freezes draws and burns your Mezo nonce in one transaction, so every signature you gave out becomes invalid. A one-call closeAccount is deployed on the TroveAccount contracts but never run on a production account yet. In Recovery Mode draws are already blocked; repay and add collateral stay open.'],
  ['What if Mezo upgrades its contracts?', 'The veto depends on Mezo sending that callback today. Our test suite includes the case where it disappears, and heal() can repay any stray MUSD back into your trove.'],
  ['Is it audited or on mainnet?', 'Neither yet. Everything shown runs on Mezo testnet 31611 — the 0.9 contracts are Blockscout-verified there — with tests on testnet and mainnet forks: 908 passing / 954 distinct / 918 incl. fork / 312 contracts. Contracts: Factory 0x39779A8678424CF78c841F9AfEa1EAFF3Cf7F6d8 (block 16794393), Governor 0x1bF45cFE654a397F4FF3B33bC1b157c88Ee71F38, SpendWallet 0x4F878203175B1BB6C63Ec02CEEBE1af4A7c9Ee4a, Router 0xd6833f811e987f06a1e55a435d4be38c6d4188d4.'],
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
