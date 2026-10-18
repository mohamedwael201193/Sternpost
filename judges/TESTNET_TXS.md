# Live testnet run (Mezo testnet, chain 31611)

Real Mezo contracts, no mocks. Produced by `cd sdk && MEZO_TESTNET_PK=... npm run e2e`.

- Factory `0x29bf11Cd948CE845687A21819b2844d5321432Cf`
- Governor `0x48C880DA27b91229d2FcB5992DdC00c9EaCA7fa6` (borrower `0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3`)
- SpendWallet `0x5433bc33e192d1675807306ef63a92fcD6ac2D87` (agent `0x62a4773191747994c0368664cA68BC476897c1d9`)
- App key `0x0508F05fD26811139cf0C3e139FD692Ae7612D1E`, x402 merchant `0x661E399Bf93b0Ee184bCe18da26Be03492E9D509`

| # | Step | Result | Revert reason | Tx |
|---|------|--------|---------------|----|
| 1 | createGovernor(floor 2.5, defend 1.6) | success |  | [`0xb3767ba3…`](https://explorer.test.mezo.org/tx/0xb3767ba3fe9de6ac5ca89cf3e10e0b5c5902dde70c24dcec40eca6744d053a4e) |
| 2 | createSpendWallet(agent, 30d) | success |  | [`0x93b7ae9f…`](https://explorer.test.mezo.org/tx/0x93b7ae9fad2c88e255ddd0191179b00454c929a2b187eb8679792596b704340f) |
| 3 | authorizeApp(budget 1500, perDraw 1000, payee=SpendWallet) | success |  | [`0x8a3c4668…`](https://explorer.test.mezo.org/tx/0x8a3c46689039fdea105cb3af5ee8d389062423c48e0e00933a2e9fbb22cb5ba1) |
| 4 | MUSD.approve(governor) | success |  | [`0xc6f7d4bf…`](https://explorer.test.mezo.org/tx/0xc6f7d4bfcbbc7e89d58f8407e14ffd84fbb6741c2952ccb04f4e8ab10d45747a) |
| 5 | fund(20 MUSD buffer) | success |  | [`0x7d2d666e…`](https://explorer.test.mezo.org/tx/0x7d2d666ec64bea525e57e772dbfed654f154543a78d6329cae0e44a7d6d62ccc) |
| 6 | parkReserve(5 MUSD -> sMUSD) | success |  | [`0xccb03b9c…`](https://explorer.test.mezo.org/tx/0xccb03b9cf44d9c79c820400e67404c8d781f3a0b45974b0097be0012f91babe0) |
| 7 | draw(10 MUSD) by app -> SpendWallet | success |  | [`0x656b1ed4…`](https://explorer.test.mezo.org/tx/0x656b1ed43e5661c9c9b264b8e263a57e5ffcf6e2fe43a0094fdbce4230f22247) |
| 8 | draw(900 MUSD) refused: Unsafe (below floor) | reverted (expected) | Unsafe(uint256,uint256) 0x5aa8ead1 | [`0xa489db6a…`](https://explorer.test.mezo.org/tx/0xa489db6ab1602ba8c2140ebe0451b2d3a84148491f43c37d8e9d73a83f47dd78) |
| 9 | direct withdrawMUSDWithSignature bypass blocked | reverted (expected) | Mezo ActivePool: 'Sending BTC failed' (governor receive() reverted BypassBlocked) | [`0xcb54e35d…`](https://explorer.test.mezo.org/tx/0xcb54e35d4608952fa0b1a1b379870dee8cf55eeefcae4c22c82690c9cba6aed1) |
| 10 | rearm(5 MUSD standby) | success |  | [`0x735cb4c3…`](https://explorer.test.mezo.org/tx/0x735cb4c31dd95cba6f9be6462026c842cdd00c98deef05b0aacddee3a86d4d54) |
| 11 | SpendWallet.setBudget(Permit2, 10 MUSD) | success |  | [`0x745e244c…`](https://explorer.test.mezo.org/tx/0x745e244c32a03df871d78d4d84223c0757e908fc81e3a488d5e92c09d76ebc48) |
| 12 | x402 settle 0.5 MUSD SpendWallet -> merchant | success |  | [`0xfdd4c73c…`](https://explorer.test.mezo.org/tx/0xfdd4c73ca9a8b85c62f801a0e1f0363196bfa1a6a5c01fc3e3d557598fb98f09) |
| 13 | revoke() + nonce burn (1 wei AddColl) | success |  | [`0xda372cf8…`](https://explorer.test.mezo.org/tx/0xda372cf83477fa33dce7d504681b13d6dcf1845427539b15f7ff746a1a60274e) |
| 14 | unfreeze() | success |  | [`0x27e251c0…`](https://explorer.test.mezo.org/tx/0x27e251c025ab26411d5a61b0438c634dfe6b9b361907aab0d0c3aa569c0952a6) |
| 15 | draw with pre-revoke signature fails (nonce burned) | reverted (expected) | BadHeal() 0x2cdd3c9a (signatures bound to the burned nonce) | [`0xe783e1f4…`](https://explorer.test.mezo.org/tx/0xe783e1f4223c0a9c9bd9544b17691a89ae6d02650f57319ac7d98459175614b5) |
| 16 | rearm() after burn | success |  | [`0x1e1a5421…`](https://explorer.test.mezo.org/tx/0x1e1a54213f98024059da76237d5c0dccffedd8a1dae73f96c6eb266684af84d8) |

Mezo charges at least half the gas limit on a reverted tx, so gasUsed on the three expected reverts is exactly 1.5M of 3M and says nothing about the cause. The reasons above come from replaying each tx with `eth_call` at the previous block.
