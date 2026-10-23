/** Real Mezo testnet (chain 31611) transactions behind every claim on the site. */
export const EXPLORER = 'https://explorer.test.mezo.org'
export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`

export type Proof = { id: string; title: string; claim: string; status: 'success' | 'reverted'; hash: string }

export const PROOFS: Proof[] = [
  {
    id: 'bypass',
    title: 'The weakness',
    claim: 'A Governor-addressed withdraw signature sent straight to Mezo drew 50 MUSD and moved ICR from 3.08 to 3.02, past a 3.2 floor.',
    status: 'success',
    hash: '0xe87009546e383c3a45ff87596e2ffd61a242ede308e0e9098c6182d997cbf0ce',
  },
  {
    id: 'veto',
    title: 'Bypass vetoed',
    claim: 'The same direct submission against the gated Governor reverts in the same transaction. No debt, nonce unused.',
    status: 'reverted',
    hash: '0x48144c0725361a09372c8bcdcb2915a7e4ee9e0a180d80002d21d9a33b98416b',
  },
  {
    id: 'draw',
    title: 'Safe draw',
    claim: 'An in-policy draw routed through the Governor lands and is checked against live ICR.',
    status: 'success',
    hash: '0xf8aaae5813520b4c8966f6897f3aef868d4f48f7a1bc401811153c42abe4c56c',
  },
  {
    id: 'burn',
    title: 'Revoke by nonce burn',
    claim: 'One transaction advances the native Mezo nonce, so every outstanding signature dies.',
    status: 'success',
    hash: '0xd2ade71f1cb282eab3320f3d1c7a584fd572f00b91ee14c0988a2e061251bcf7',
  },
  {
    id: 'replay',
    title: 'Replay after revoke',
    claim: 'Re-submitting an old signature after the burn fails.',
    status: 'reverted',
    hash: '0x0ac2f3d40d516207981da48ce45815e8c07ef5f304a5ad579f1e62d148263235',
  },
  {
    id: 'x402',
    title: 'x402 payment settled',
    claim: '1 MUSD paid from an ERC-1271 spend wallet for an API call; the settlement transaction landed on-chain.',
    status: 'success',
    hash: '0x5c48fe58a5e0007a8daea716e84bc00621882352cdbe4c71ede2ceef78fe503f',
  },
]
