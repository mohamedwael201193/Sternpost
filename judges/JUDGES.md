# For judges

Sternpost gives apps and agents a guarded MUSD credit line on a Mezo trove. Every draw goes through the governor, which checks the app's budget and payee and re-checks the borrower's collateral ratio after the withdraw. A signature submitted straight to Mezo cannot get around it.

## Reproduce in one command

```bash
git clone https://github.com/mohamedwael201193/Sternpost && cd Sternpost/contracts \
  && git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std && forge test
```

| What | Command | Result |
|------|---------|--------|
| Unit, fuzz, invariant tests (mocks) | `cd contracts && forge test` | 33 pass |
| Fork tests against the real Mezo testnet | `cd contracts && ./script/fork.sh testnet` | 7/7 pass ([log](logs/fork_testnet.txt)) |
| Fork tests against the real Mezo mainnet | `cd contracts && ./script/fork.sh mainnet` | 7/7 pass ([log](logs/fork_mainnet.txt)) |
| SDK tests (EIP-712 parity with Solidity, nonce coordination) | `cd sdk && npm ci && npm test` | 9 pass |
| Live testnet flow | `cd sdk && MEZO_TESTNET_PK=0x… npm run e2e` | 16 txs, [table](TESTNET_TXS.md) |
| Paid API over x402, paid from the SpendWallet | `cd backend && AGENT_PK=0x… SPEND_WALLET=0x… node scripts/pay-brief.mjs` | HTTP 200 + settlement tx |

## Key transactions (Mezo testnet, chain 31611)

| Proof | Tx |
|-------|----|
| Factory deployed | [0x8206c91c…](https://explorer.test.mezo.org/tx/0x8206c91ca528588c27002e408b5c0b45c95b3a21ee1f84f3fe49aeaac5c26e0a) |
| Safe draw by an app key, paid to its SpendWallet | [0x656b1ed4…](https://explorer.test.mezo.org/tx/0x656b1ed43e5661c9c9b264b8e263a57e5ffcf6e2fe43a0094fdbce4230f22247) |
| Unsafe draw refused on-chain (`Unsafe`) | [0xa489db6a…](https://explorer.test.mezo.org/tx/0xa489db6ab1602ba8c2140ebe0451b2d3a84148491f43c37d8e9d73a83f47dd78) |
| Direct Mezo submission blocked (`BypassBlocked` via ActivePool) | [0xcb54e35d…](https://explorer.test.mezo.org/tx/0xcb54e35d4608952fa0b1a1b379870dee8cf55eeefcae4c22c82690c9cba6aed1) |
| Revoke + nonce burn | [0xda372cf8…](https://explorer.test.mezo.org/tx/0xda372cf83477fa33dce7d504681b13d6dcf1845427539b15f7ff746a1a60274e) |
| A signature from before the revoke is dead (`BadHeal`) | [0xe783e1f4…](https://explorer.test.mezo.org/tx/0xe783e1f4223c0a9c9bd9544b17691a89ae6d02650f57319ac7d98459175614b5) |
| x402 settle from the SpendWallet (SDK `pay`, facilitator) | [0xfdd4c73c…](https://explorer.test.mezo.org/tx/0xfdd4c73ca9a8b85c62f801a0e1f0363196bfa1a6a5c01fc3e3d557598fb98f09) |
| x402 purchase of the paid API brief at sternpost-api.vercel.app, from the SpendWallet to the treasury `0xFbB4b0edf723Dc4Ef4d5AeDdA5c12e5d598AE757` | [0x6ec3ca88…](https://explorer.test.mezo.org/tx/0x6ec3ca884a6040e830f9d7548567323f1c42a09a37fed6d534448fcc7637b46b) |

Addresses and every hash are in [`shared/deployments/testnet.json`](../shared/deployments/testnet.json).

## Honest limits

- The gate depends on Mezo's ActivePool calling the recipient with `sendCollateral(recipient, 0)` during a withdraw. If Mezo removes that callback, `draw()` fails closed (`CallbackMismatch`): draws stop, and nothing can be stolen. A fork test covers this.
- Mezo uses one signature nonce per borrower, so any other signed action disarms the defend standby. The SDK detects this, and `rearm()` restores it.
- Everything here runs on testnet. The mainnet fork tests run against the real mainnet contracts, but nothing is deployed on mainnet.
