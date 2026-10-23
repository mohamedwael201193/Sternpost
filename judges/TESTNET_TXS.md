# Live testnet run (Mezo testnet, chain 31611)

Real Mezo contracts, no mocks. Produced by `cd sdk && MEZO_TESTNET_PK=... npm run e2e` against the **hardened** deployment of 2026-10-23. The live code is byte-identical to this repo's build; see [VERIFY.md](VERIFY.md).

- Factory `0x0632A9FeA303c0dB4544BF642a8aD0467C6c6980` (deploy tx [`0xfc32c758…`](https://explorer.test.mezo.org/tx/0xfc32c7584b4c14b12f2d171d787b5bc6a5098d79535bd3c967923ef37c53c50c))
- Governor `0x9eEa9762ED3c1dE2308c800687558064DFf0B832` (borrower `0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3`)
- SpendWallet `0x6330d69EbcA4ea00969a3f8085FE8BD5FC6D41FA` (agent `0x62a4773191747994c0368664cA68BC476897c1d9`)
- App key `0x0508F05fD26811139cf0C3e139FD692Ae7612D1E`, x402 merchant `0x661E399Bf93b0Ee184bCe18da26Be03492E9D509`

| # | Step | Result | Revert reason | Tx |
|---|------|--------|---------------|----|
| 1 | createGovernor(floor 2.5, defend 1.6) | success |  | [`0x88b60613…`](https://explorer.test.mezo.org/tx/0x88b6061302eaaa0611476350991b923e204516dd1cff2a709fca16587657b2a3) |
| 2 | createSpendWallet(agent, 30d) | success |  | [`0xb1ffe771…`](https://explorer.test.mezo.org/tx/0xb1ffe7713d798f203581e7b6b52022ca50b7a724da7ccf68c35a8309ad0c007f) |
| 3 | authorizeApp(budget 1500, perDraw 1000, payee=SpendWallet) | success |  | [`0x5fe5825b…`](https://explorer.test.mezo.org/tx/0x5fe5825bd976919d89f18f95b79203220632616b566d19a38eda347ebd7f32f2) |
| 4 | MUSD.approve(governor) | success |  | [`0x5e124015…`](https://explorer.test.mezo.org/tx/0x5e12401517f49f24d1ed9b5ccf25e07fe5bfbc35da99a019e5197595a4233f5a) |
| 5 | fund(20 MUSD buffer) | success |  | [`0x48e6a6b5…`](https://explorer.test.mezo.org/tx/0x48e6a6b53d5aa84daf3c98d960f87538ef4db74bb31ea98e1d22b52541e523ad) |
| 6 | parkReserve(5 MUSD -> sMUSD) | success |  | [`0x00a348fc…`](https://explorer.test.mezo.org/tx/0x00a348fc43ea08e94451d4c340ef5af1d3f74ed98738b1bd27fb39f243ffb3e6) |
| 7 | draw(10 MUSD) by app -> SpendWallet | success |  | [`0xba4eb129…`](https://explorer.test.mezo.org/tx/0xba4eb1299298aa6ad661cb6ed83accc9ed07ff2a42ec1b4576bb3c5f67c71523) |
| 8 | draw(900 MUSD) refused: Unsafe (below floor) | reverted (expected) | Unsafe(icrAfter=2.183e18, floor=2.5e18) (0x5aa8ead1) | [`0xf3920683…`](https://explorer.test.mezo.org/tx/0xf3920683b0a0b6a3db2ab9227c747112ecda5aa501ca4c426c3408df7fa19bbf) |
| 9 | direct withdrawMUSDWithSignature bypass blocked | reverted (expected) | Mezo: "Sending BTC failed" (ActivePool callback rejected by governor.receive gate) | [`0xfd93314c…`](https://explorer.test.mezo.org/tx/0xfd93314cb952bf5542b76fd4fe69de500f88dd061e482170e11a4cc7f90a36e2) |
| 10 | rearm(5 MUSD standby) | success |  | [`0x9a1fe317…`](https://explorer.test.mezo.org/tx/0x9a1fe31787be4283688871e0baecc7e0ac043db8cecdb0e81368dff9fa3418e3) |
| 11 | SpendWallet.setBudget(Permit2, 10 MUSD) | success |  | [`0xfa3c58ad…`](https://explorer.test.mezo.org/tx/0xfa3c58ad0707c32532270381a06f613ce125f97cda128577a9b435ecce8d5d30) |
| 12 | x402 settle 0.5 MUSD SpendWallet -> merchant | success |  | [`0x4833c4a8…`](https://explorer.test.mezo.org/tx/0x4833c4a878d7efc6a7d7c47baca8a6901b12dfa7e3ca63d9985a5b565f114140) |
| 13 | revoke() + nonce burn (1 wei AddColl) | success |  | [`0xf0763cf4…`](https://explorer.test.mezo.org/tx/0xf0763cf43766a93d921e3085f6eaa727c0fa6d09047130388a53297b3b0d72eb) |
| 14 | unfreeze() | success |  | [`0xd07c8470…`](https://explorer.test.mezo.org/tx/0xd07c8470475d1a6d5c4dcfb746f34cb34153b0b3eea4f8b250b2775c0d9d01fa) |
| 15 | draw with pre-revoke signature fails (nonce burned) | reverted (expected) | BadHeal() (0x2cdd3c9a): nonce burned by revoke | [`0x1938e472…`](https://explorer.test.mezo.org/tx/0x1938e4723094d02f1b36b9e100885b7e4833f462d34b8dd75e023a0827b0be6f) |
| 16 | rearm() after burn | success |  | [`0xeb436557…`](https://explorer.test.mezo.org/tx/0xeb4365573f274c75a070facf13186bef3784b59d606e8eddb3ee9220a01b2ff3) |

Mezo charges at least half the gas limit on a reverted tx, so gasUsed on the three expected reverts is exactly 1.5M of 3M and says nothing about the cause. The reasons above come from replaying each tx with `eth_call` at the previous block.

The first run of the hardened flow stopped after step 2 because of a gas-estimate bug in `createSpendWallet`, fixed in `2e79dfc`. A later re-run stopped after `revoke()`. Before the final run the script called `unfreeze()` ([`0x92743630…`](https://explorer.test.mezo.org/tx/0x92743630495e9a6b099d8c9f365a9b0f8e27ee92783d268e2225a44438c84c8b)). Those earlier partial txs are on-chain but not listed here.

## Previous (pre-hardening) deployment, superseded

Factory `0x29bf11Cd948CE845687A21819b2844d5321432Cf`, governor `0x48C880DA27b91229d2FcB5992DdC00c9EaCA7fa6`, SpendWallet `0x5433bc33e192d1675807306ef63a92fcD6ac2D87`. Its 16-tx run is in git history (`git log -- judges/TESTNET_TXS.md`).
