/** Real Mezo testnet (chain 31611) transactions behind every claim on the site.
 *  Rows are steps 7-9, 12-13, 15 of the 16-step Wave 1 run (23 Oct 2026) in
 *  judges/TESTNET_TXS.md, on the superseded hardened deployment. */
export const EXPLORER = 'https://explorer.test.mezo.org'
export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`

export type Proof = { id: string; title: string; claim: string; status: 'success' | 'reverted'; hash: string }

export const PROOFS: Proof[] = [
  {
    id: 'floor',
    title: 'Floor enforced',
    claim: 'A 900 MUSD draw that would drop ICR below the 2.5 floor reverts as Unsafe — no debt drawn.',
    status: 'reverted',
    hash: '0xf3920683b0a0b6a3db2ab9227c747112ecda5aa501ca4c426c3408df7fa19bbf',
  },
  {
    id: 'veto',
    title: 'Bypass vetoed',
    claim: 'The same direct submission against the gated Governor reverts in the same transaction. No debt, nonce unused.',
    status: 'reverted',
    hash: '0xfd93314cb952bf5542b76fd4fe69de500f88dd061e482170e11a4cc7f90a36e2',
  },
  {
    id: 'draw',
    title: 'Safe draw',
    claim: 'An in-policy draw routed through the Governor lands and is checked against live ICR.',
    status: 'success',
    hash: '0xba4eb1299298aa6ad661cb6ed83accc9ed07ff2a42ec1b4576bb3c5f67c71523',
  },
  {
    id: 'burn',
    title: 'Revoke by nonce burn',
    claim: 'One transaction advances the native Mezo nonce, so every outstanding signature dies.',
    status: 'success',
    hash: '0xf0763cf43766a93d921e3085f6eaa727c0fa6d09047130388a53297b3b0d72eb',
  },
  {
    id: 'replay',
    title: 'Replay after revoke',
    claim: 'Re-submitting an old signature after the burn fails.',
    status: 'reverted',
    hash: '0x1938e4723094d02f1b36b9e100885b7e4833f462d34b8dd75e023a0827b0be6f',
  },
  {
    id: 'x402',
    title: 'x402 payment settled',
    claim: '0.5 MUSD paid from an ERC-1271 spend wallet for an API call; the settlement transaction landed on-chain.',
    status: 'success',
    hash: '0x4833c4a878d7efc6a7d7c47baca8a6901b12dfa7e3ca63d9985a5b565f114140',
  },
]
