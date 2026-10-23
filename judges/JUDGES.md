# For judges

Sternpost gives apps and agents a guarded MUSD credit line on a Mezo trove. Every draw goes through the governor, which checks the app's budget and payee and re-checks the borrower's collateral ratio after the withdraw. A signature submitted straight to Mezo cannot get around it.

## Reproduce in one command

```bash
git clone https://github.com/mohamedwael201193/Sternpost && cd Sternpost/contracts \
  && git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std && forge test
```

| What | Command | Result |
|------|---------|--------|
| Unit, fuzz, invariant tests (mocks) | `cd contracts && forge test --no-match-path 'test/fork/*'` | 56 pass |
| Fork tests against the real Mezo testnet | `cd contracts && ./script/fork.sh testnet` | 7/7 pass ([log](logs/fork_testnet.txt)) |
| Fork tests against the real Mezo mainnet | `cd contracts && ./script/fork.sh mainnet` | 7/7 pass ([log](logs/fork_mainnet.txt)) |
| Live bytecode equals this repo's build | `cd contracts && forge build && python3 script/bytecode-match.py` | 3/3 MATCH ([why not explorer-verified](VERIFY.md)) |
| SDK tests (EIP-712 parity with Solidity, nonce coordination) | `cd sdk && npm ci && npm test` | 9 pass |
| Live testnet flow | `cd sdk && MEZO_TESTNET_PK=0x… npm run e2e` | 16 txs, [table](TESTNET_TXS.md) |
| Paid API over x402, paid from the SpendWallet | `cd backend && AGENT_PK=0x… SPEND_WALLET=0x… node scripts/pay-brief.mjs` | HTTP 200 + settlement tx |

## Key transactions (Mezo testnet, chain 31611)

| Proof | Tx |
|-------|----|
| Factory deployed | [0xfc32c758…](https://explorer.test.mezo.org/tx/0xfc32c7584b4c14b12f2d171d787b5bc6a5098d79535bd3c967923ef37c53c50c) |
| Safe draw by an app key, paid to its SpendWallet | [0xba4eb129…](https://explorer.test.mezo.org/tx/0xba4eb1299298aa6ad661cb6ed83accc9ed07ff2a42ec1b4576bb3c5f67c71523) |
| Unsafe draw refused on-chain (`Unsafe`) | [0xf3920683…](https://explorer.test.mezo.org/tx/0xf3920683b0a0b6a3db2ab9227c747112ecda5aa501ca4c426c3408df7fa19bbf) |
| Direct Mezo submission blocked (`BypassBlocked` via ActivePool) | [0xfd93314c…](https://explorer.test.mezo.org/tx/0xfd93314cb952bf5542b76fd4fe69de500f88dd061e482170e11a4cc7f90a36e2) |
| Revoke + nonce burn | [0xf0763cf4…](https://explorer.test.mezo.org/tx/0xf0763cf43766a93d921e3085f6eaa727c0fa6d09047130388a53297b3b0d72eb) |
| A signature from before the revoke is dead (`BadHeal`) | [0x1938e472…](https://explorer.test.mezo.org/tx/0x1938e4723094d02f1b36b9e100885b7e4833f462d34b8dd75e023a0827b0be6f) |
| x402 settle from the SpendWallet (SDK `pay`, facilitator) | [0x4833c4a8…](https://explorer.test.mezo.org/tx/0x4833c4a878d7efc6a7d7c47baca8a6901b12dfa7e3ca63d9985a5b565f114140) |
| x402 purchase of the paid API brief at sternpost-api.vercel.app, from the SpendWallet to the treasury `0xFbB4b0edf723Dc4Ef4d5AeDdA5c12e5d598AE757` | [0x2a6d515c…](https://explorer.test.mezo.org/tx/0x2a6d515c2f325a917e33a77c7f611ca86ffbd7fb21489d0225f296e4ecf38d06) |

Addresses and every hash are in [`shared/deployments/testnet.json`](../shared/deployments/testnet.json).

## Honest limits

- The gate depends on Mezo's ActivePool calling the recipient with `sendCollateral(recipient, 0)` during a withdraw. If Mezo removes that callback, `draw()` fails closed (`CallbackMismatch`): draws stop, and nothing can be stolen. A fork test covers this.
- Mezo uses one signature nonce per borrower, so any other signed action disarms the defend standby. The SDK detects this, and `rearm()` restores it.
- Governor branch coverage is 93.6%. The three branches never hit are the `nonReentrant` re-entry revert, the `AmountMismatch` guard (both unreachable with an honest MUSD), and a modifier branch that the IR-minimum coverage mode reports even though tests hit it.
- Everything here runs on testnet. The mainnet fork tests run against the real mainnet contracts, but nothing is deployed on mainnet.
