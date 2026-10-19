# Security policy

Sternpost is hackathon software running on Mezo **testnet**. It has not been audited. Do not put mainnet funds behind it.

## Reporting

Report a vulnerability privately through GitHub's "Report a vulnerability" on this repository (Security → Advisories). Do not open a public issue. Please include a reproduction, ideally as a Foundry test against `contracts/test/Base.t.sol` or a fork test. We aim to reply within 72 hours.

## Scope

| In scope | Out of scope |
|---|---|
| `contracts/src/*` (Governor, Factory, SpendWallet) | Mezo's own contracts |
| `sdk/` signing and nonce logic | Third-party x402 facilitators |
| `backend/` x402 paywall verification | Testnet faucet and RPC availability |

## What we already test

- Unit, fuzz and invariant tests (mocks): budget conservation, the floor is never crossed, and nothing gets through the gate.
- Fork tests on the real Mezo testnet and mainnet contracts: direct bypass, safe and unsafe draws, callback removal, the nonce burn, the nonce race, and defend.
- Slither on every contract change, with triage in [judges/SLITHER_TRIAGE.md](judges/SLITHER_TRIAGE.md).

The threat model is in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).
