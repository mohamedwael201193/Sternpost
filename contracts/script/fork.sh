#!/usr/bin/env bash
# Run the real-contract fork suite. Usage: script/fork.sh testnet|mainnet
set -euo pipefail
cd "$(dirname "$0")/.."
case "${1:-testnet}" in
  testnet) export RPC=https://rpc.test.mezo.org SIG=0xD757e3646AF370b15f32EB557F0F8380Df7D639e BO=0xCdF7028ceAB81fA0C6971208e83fa7872994beE5 PF=0x86bCF0841622a5dAC14A313a15f96A95421b9366 MUSD=0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503 TM=0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0 P0=${P0:-81353575800000000000000} ;;
  mainnet) export RPC=https://rpc-http.mezo.boar.network SIG=0xB57ab578BF20b3e318f3EFAA587C51DBccE5df7a BO=0x44b1bac67dDA612a41a58AAf779143B181dEe031 PF=0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88 MUSD=0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186 TM=0x94AfB503dBca74aC3E4929BACEeDfCE19B93c193 P0=${P0:-81354900000000000000000} ;;
esac
FORK_ON=true forge test --match-path "test/fork/*" "${@:2}"
