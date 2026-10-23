# Source verification

## Status (2026-10-23, Africa/Cairo)

Explorer source verification on Mezo testnet is **not done**: both public verifiers refused every attempt.

| Verifier | Attempt | Result |
|---|---|---|
| Blockscout `explorer.test.mezo.org` | `forge verify-contract --verifier blockscout --verifier-url https://api.explorer.test.mezo.org/api/` for Factory, Governor, SpendWallet | `Fail - Unable to verify` |
| Blockscout v2 API | `/verification/via/standard-input` (evm `paris`, then `london`) and `/via/flattened-code` | accepted, never marked verified |
| Control | a 3-line contract `T` deployed fresh (via-IR/paris **and** legacy/london) | same failure, so it is not specific to Sternpost |
| Sourcify (lists chain 31611 as supported) | `forge verify-contract --verifier sourcify` | `cannot_fetch_bytecode` (Sourcify cannot read Mezo's RPC) |

The Blockscout config endpoint lists no `paris` EVM version, and even the legacy/london control contract failed, so the verifier service looks unavailable for new submissions right now.

## What you can check instead: byte-for-byte match

```bash
cd contracts && forge build && python3 script/bytecode-match.py
```

The script downloads the runtime code of the three live contracts and compares it with a local build of this repo. It masks only the solc-reported immutable slots, which hold constructor values. The output today:

```
MATCH SternpostFactory   0x0632A9FeA303c0dB4544BF642a8aD0467C6c6980
MATCH SternpostGovernor  0x9eEa9762ED3c1dE2308c800687558064DFf0B832
MATCH SpendWallet        0x6330d69EbcA4ea00969a3f8085FE8BD5FC6D41FA
```

The trailing CBOR metadata contains the IPFS hash of the exact sources and compiler settings, and it matches too. So the live code is this commit's source, including the Slither hardening.

## Retry when the explorer recovers

```bash
cd contracts
V="--verifier blockscout --verifier-url https://api.explorer.test.mezo.org/api/ --chain 31611 --watch"
forge verify-contract 0x0632A9FeA303c0dB4544BF642a8aD0467C6c6980 src/SternpostFactory.sol:SternpostFactory --guess-constructor-args --rpc-url https://rpc.test.mezo.org $V
forge verify-contract 0x9eEa9762ED3c1dE2308c800687558064DFf0B832 src/SternpostGovernor.sol:SternpostGovernor --guess-constructor-args --rpc-url https://rpc.test.mezo.org $V
forge verify-contract 0x6330d69EbcA4ea00969a3f8085FE8BD5FC6D41FA src/SpendWallet.sol:SpendWallet --guess-constructor-args --rpc-url https://rpc.test.mezo.org $V
```
