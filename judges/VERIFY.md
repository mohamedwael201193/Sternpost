# Source verification

## Status — 0.9 Classic redeploy (2026-11-15, Mezo testnet 31611)

All four redeployed contracts are **source-verified on Blockscout** (`is_verified: true`
via `https://api.explorer.test.mezo.org/api/v2/smart-contracts/<addr>`), and their
deployed bytecode matches a local `forge build` (immutable slots masked).

| Contract | Address | Deploy tx | Block | `is_verified` | Bytecode |
|---|---|---|---|---|---|
| SternpostFactory | `0x39779A8678424CF78c841F9AfEa1EAFF3Cf7F6d8` | `0x1c66a1c572024a808645abbb7163496c4b7252c800246a1b9aabc6f303cbd1e1` | 16794393 | true | MATCH (21,962 bytes, 27 immutable slots masked) |
| SternpostGovernor | `0x1bF45cFE654a397F4FF3B33bC1b157c88Ee71F38` | `0x3d7ea01d4016f3eded413568f2859934d8efde0268c78a22f51701b4b51d1e22` | 16794411 | true | MATCH (15,651 bytes, 71 immutable slots masked) |
| SpendWallet | `0x4F878203175B1BB6C63Ec02CEEBE1af4A7c9Ee4a` | `0x448c58f3f5d856fb6e636f9c5545eaf55e58b0dd525647711fc92dbdb252112e` | 16794411 | true | MATCH (1,761 bytes, 5 immutable slots masked) |
| SternpostRouter | `0xd6833f811e987f06a1e55a435d4be38c6d4188d4` | `0x7c425bc1be3bd8993d2e8caec32571e312ab09a7e1cc4d7a2e44996a96e81d43` | 16794452 | true | MATCH (9,508 bytes, 38 immutable slots masked) |

The redeploy bundles the gov-chain fixes 0.1–0.7 (previewDraw double count,
defend clamp, Recovery Mode / redemption reasons, 30-day standby, 250/160
defaults, draw fee) and the 0.5 slippage cap. Factory fee: 10 bps to the
deployer (`0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3`, interim fee recipient).
Governor policy: floor 2.5e18, defend 1.6e18. SpendWallet agent
`0x62a4773191747994c0368664cA68BC476897c1d9`, expiry 1797330675 (+30 days).

## How it was verified

```bash
cd contracts
V="--chain-id 31611 --verifier blockscout --verifier-url https://api.explorer.test.mezo.org/api/ --compiler-version 0.8.24 --watch"
# Factory: ctor (SIG, BO, TM, PF, MUSD, ActivePool, sMUSD, 10, deployer)
ARGS_F=$(cast abi-encode "f(address,address,address,address,address,address,address,uint16,address)" $SIG $BO $TM $PF $MUSD $AP $SMUSD 10 $W)
forge verify-contract 0x39779A8678424CF78c841F9AfEa1EAFF3Cf7F6d8 src/SternpostFactory.sol:SternpostFactory --constructor-args $ARGS_F --rpc-url https://rpc.test.mezo.org $V
# Governor: ctor (borrower, SIG, BO, TM, PF, MUSD, AP, SMUSD, 2.5e18, 1.6e18, 10, deployer)
ARGS_G=$(cast abi-encode "f(address,address,address,address,address,address,address,address,uint256,uint256,uint16,address)" $W $SIG $BO $TM $PF $MUSD $AP $SMUSD 2500000000000000000 1600000000000000000 10 $W)
forge verify-contract 0x1bF45cFE654a397F4FF3B33bC1b157c88Ee71F38 src/SternpostGovernor.sol:SternpostGovernor --constructor-args $ARGS_G --rpc-url https://rpc.test.mezo.org $V
# SpendWallet: ctor (owner, agent, 1797330675)
ARGS_SW=$(cast abi-encode "f(address,address,uint64)" $W 0x62a4773191747994c0368664cA68BC476897c1d9 1797330675)
forge verify-contract 0x4F878203175B1BB6C63Ec02CEEBE1af4A7c9Ee4a src/SpendWallet.sol:SpendWallet --constructor-args $ARGS_SW --rpc-url https://rpc.test.mezo.org $V
# Router: ctor (factory, SIG, MUSD, sMUSD, dexRouter, dexFactory, BTC, false)
ARGS_R=$(cast abi-encode "f(address,address,address,address,address,address,address,bool)" $F $SIG $MUSD $SMUSD $DEX $DEXF $BTC false)
forge verify-contract 0xd6833f811e987f06a1e55a435d4be38c6d4188d4 src/routes/SternpostRouter.sol:SternpostRouter --constructor-args $ARGS_R --rpc-url https://rpc.test.mezo.org $V
# check:
curl -s https://api.explorer.test.mezo.org/api/v2/smart-contracts/<addr> | jq '.is_verified'   # true for all four
```

Bytecode match (Factory/Governor/SpendWallet via the script; Router via the same
masked comparison inline, since the script only covers three targets):

```bash
cd contracts && forge build && python3 script/bytecode-match.py
```

```
MATCH SternpostFactory   0x39779A8678424CF78c841F9AfEa1EAFF3Cf7F6d8 (21962 bytes, 27 immutable slots masked, ipfs metadata 0x122042bd39ab4721…)
MATCH SternpostGovernor  0x1bF45cFE654a397F4FF3B33bC1b157c88Ee71F38 (15651 bytes, 71 immutable slots masked, ipfs metadata 0x12209196abecd146…)
MATCH SpendWallet        0x4F878203175B1BB6C63Ec02CEEBE1af4A7c9Ee4a (1761 bytes, 5 immutable slots masked, ipfs metadata 0x122066b2f33f61fe…)
MATCH SternpostRouter    0xd6833f811e987f06a1e55a435d4be38c6d4188d4 (9508 bytes, 38 immutable slots masked)
```

The trailing CBOR metadata contains the IPFS hash of the exact sources and
compiler settings, and it matches too. Compiler settings: solc 0.8.24,
optimizer 200, `via_ir`, `evm_version = "paris"` (`contracts/foundry.toml`).

## `defend()` re-run on the new deployment (2026-11-15)

`defend()` **`0x3e57c0b2b71099c01cbb4e47facd97eccece12f46bbe675bed0f4013f87600c2`**,
block 16794538, status 1, called from a fresh single-use outside EOA
`0x27aeBa9c609b21Ea4112d8bd0a21E779901D62A6` (funded 0.0002 BTC for gas only).
`Defended` event: repaid 30 MUSD, ICR 2.3791 → 2.4081, `frozen = true`,
buffer 30 → 0, Mezo nonce 44 → 45. Disclosure (same as Wave 1): triggered by
raising the policy line (`setPolicy(2.5e18, 2.4e18)` while ICR was 2.377e18),
not by a price move. Restored afterwards: `unfreeze`, `setPolicy(2.5e18,
1.6e18)`, re-funded 30 MUSD, re-armed 30 MUSD at Mezo nonce 45 (deadline
1797331299). Full tx list: `shared/deployments/testnet.json`
(`sternpost.classicRedeploy.defend.flow`) and [TESTNET_TXS.md](TESTNET_TXS.md).

## History (Wave 1 hardened deployment, superseded)

Factory `0x0632A9FeA303c0dB4544BF642a8aD0467C6c6980`, governor
`0x9eEa9762ED3c1dE2308c800687558064DFf0B832`, SpendWallet
`0x6330d69EbcA4ea00969a3f8085FE8BD5FC6D41FA`, Router v2
`0xEC30280134f06668f35753D640c6760984179674`. Its 16-tx run is below in
[TESTNET_TXS.md](TESTNET_TXS.md); its verification note follows (obsolete as
of the 0.9 redeploy — Blockscout verification works with the flags above).

### Old note (2026-10-23, Africa/Cairo) — obsolete

Explorer source verification on Mezo testnet was **not done** at the time: both
public verifiers refused every attempt.

| Verifier | Attempt | Result |
|---|---|---|
| Blockscout `explorer.test.mezo.org` | `forge verify-contract --verifier blockscout --verifier-url https://api.explorer.test.mezo.org/api/` for Factory, Governor, SpendWallet | `Fail - Unable to verify` |
| Blockscout v2 API | `/verification/via/standard-input` (evm `paris`, then `london`) and `/via/flattened-code` | accepted, never marked verified |
| Control | a 3-line contract `T` deployed fresh (via-IR/paris **and** legacy/london) | same failure, so it is not specific to Sternpost |
| Sourcify (lists chain 31611 as supported) | `forge verify-contract --verifier sourcify` | `cannot_fetch_bytecode` (Sourcify cannot read Mezo's RPC) |

The Blockscout config endpoint listed no `paris` EVM version, and even the
legacy/london control contract failed, so the verifier service looked
unavailable for new submissions right now. Byte-for-byte match was used
instead (see above); the Wave 1 contracts were later verified ("Pass -
Verified") with the flags in 4.11 of the plan.
