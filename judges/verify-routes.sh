#!/usr/bin/env bash
# Re-checks the Track-1 route txs on Mezo testnet (31611) with read-only cast calls. No key needed.
set -euo pipefail
R=${RPC:-https://rpc.test.mezo.org}
J=$(dirname "$0")/../shared/deployments/testnet.json
RT=$(python3 -c "import json;print(json.load(open('$J'))['sternpost']['SternpostRouter']['address'])")
[ "$(cast chain-id -r $R)" = 31611 ] || { echo "wrong chain"; exit 1; }
[ "$(cast code $RT -r $R | wc -c)" -gt 10 ] || { echo "router has no code"; exit 1; }
fail=0
while IFS=$'\t' read -r step tx; do
  s=$(cast receipt "$tx" status -r $R)
  [[ $s == 1* || $s == true ]] && echo "ok    $step" || { echo "FAIL  $step ($s)"; fail=1; }
done < <(python3 -c "import json;[print(f\"{x['step']}\t{x['tx']}\") for x in json.load(open('$J'))['routeFlow']]")
MUSD=0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503; SM=0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16
for t in $MUSD $SM; do b=$(cast call $t "balanceOf(address)(uint256)" $RT -r $R | cut -d' ' -f1); [ "$b" = 0 ] || { echo "router holds $b of $t"; fail=1; }; done
[ "$(cast balance $RT -r $R)" = 0 ] || { echo "router holds BTC"; fail=1; }
echo "router residue: none"; exit $fail
