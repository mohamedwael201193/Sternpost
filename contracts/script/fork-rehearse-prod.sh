#!/bin/bash
# fork-rehearse-prod.sh — Production-contract rehearsal on a LOCAL anvil fork
# of Mezo mainnet (chain 31612). Plan task 6.1.
#
# What it does (nothing is broadcast to mainnet; everything runs against the
# local fork on 127.0.0.1:8546, fork-only anvil dev keys):
#   1. deploy TroveAccount implementation + TroveAccountFactory (production
#      contracts from this repo, main HEAD)
#   2. Account A: Factory.createAndOpen at ICR 2.5 (250%)
#   3. Account B: Factory.createAndOpen at ICR 3.0 (300%)
#   4. session for an agent + agent draw of 5 MUSD on B
#   5. park 1000 MUSD into real mainnet sMUSD on A
#   6. crash the fork price 38% (×0.62), read needed() (shield trigger) + probe
#      shield() — EXPECTED TO FAIL: shield() is task 1.4 and is NOT in the
#      production contract on main yet; the probe evidences the gap.
#   7. close both accounts, sweep, verify trove status 2 (closedByOwner)
#
# Prerequisite: start the fork first, e.g.
#   anvil --fork-url https://rpc-http.mezo.boar.network \
#         --fork-block-number <N> --port 8546 --hardfork shanghai
# (--hardfork shanghai is REQUIRED on this VM: anvil 1.8.6 with the default
# Cancun hardfork fails every eth_call on a Mezo mainnet fork with
# "Excess blob gas not set"; Shanghai executes the same contracts fine.)
# then run: bash contracts/script/fork-rehearse-prod.sh
# The fork block number is printed in the log; re-run with the same block for
# a reproducible rehearsal.
#
# Labels: every result here is "mainnet fork-tested" — NEVER "live on mainnet".
set -u
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"
PY=python3
F=http://127.0.0.1:8546
LIVE=https://rpc-http.mezo.boar.network
D0=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266; K0=$(cast wallet private-key --mnemonic "test test test test test test test test test test test junk" --mnemonic-index 0)
AG=0x70997970C51812dc3A010C7d01b50e0d17dc79C8; KA=$(cast wallet private-key --mnemonic "test test test test test test test test test test test junk" --mnemonic-index 1)
KEEP=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC; KP=$(cast wallet private-key --mnemonic "test test test test test test test test test test test junk" --mnemonic-index 2)
MBO=0x44b1bac67dDA612a41a58AAf779143B181dEe031; MTM=0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193; MPF=0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88
MMUSD=0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186; MSM=0xb4D498029af77680cD1eF828b967f010d06C51CC
MST=0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f
POLICY="(2500000000000000000,1600000000000000000,2000000000000000000,1000000000000000000,0,20)"
DEBT=1800000000000000000000

echo "fork block $(cast block-number --rpc-url $F) (chain $(cast chain-id --rpc-url $F)); live mainnet block $(cast block-number --rpc-url $LIVE)"
PRICE=""
for i in 1 2 3 4 5; do
  PRICE=$(cast call $MPF "fetchPrice()(uint256)" --rpc-url $LIVE 2>/dev/null | cut -d' ' -f1 || true)
  [ -n "$PRICE" ] && break
  sleep 3
done
[ -n "$PRICE" ] || { echo "FATAL: could not read live mainnet price"; exit 1; }
echo "live mainnet price $PRICE"
setprice() { # anvil cannot read Mezo's oracle precompile: stub PriceFeed with a constant-return contract
  local target=$1 h got i
  h=$(cast to-uint256 $target | cut -c3-)
  for i in 1 2 3; do
    cast rpc anvil_setCode $MPF "0x7f${h}5f5260205ff3" --rpc-url $F >/dev/null 2>&1
    got=$(cast call $MPF 'fetchPrice()(uint256)' --rpc-url $F 2>/dev/null | cut -d' ' -f1 || echo 0)
    if [ "$got" = "$target" ]; then return 0; fi
    sleep 2
  done
  echo "FATAL: PriceFeed stub failed (want $target, got $got)"; exit 1
}
setprice $PRICE
echo "stub price now $(cast call $MPF 'fetchPrice()(uint256)' --rpc-url $F)"

snd() { cast send "$@" --gas-limit 9000000 --rpc-url $F --json | $PY -c "import sys,json;d=json.load(sys.stdin);print('  tx',d.get('status'),'gasUsed',int(d.get('gasUsed','0x0'),16))"; }
icr() { cast call $MTM "getCurrentICR(address,uint256)(uint256)" "$1" "$(cast call $MPF 'fetchPrice()(uint256)' --rpc-url $F | cut -d' ' -f1)" --rpc-url $F; }
status() { cast call $MTM "getTroveStatus(address)(uint256)" "$1" --rpc-url $F | cut -d' ' -f1; }
# hints: walk SortedTroves from the head (4 troves on mainnet) and pick the
# exact neighbours for the new trove's nominal ICR (coll*1e20/debt).
hints() { # $1 = nicr (integer, 1e20 scale) -> prints "up lo"
  local nicr=$1 cur=$(cast call $MST "getFirst()(address)" --rpc-url $F | cut -d' ' -f1) up=0x0000000000000000000000000000000000000000
  while [ "$cur" != "0x0000000000000000000000000000000000000000" ]; do
    local vals coll debt cnicr
    vals=$(cast call $MTM "getEntireDebtAndColl(address)(uint256,uint256,uint256,uint256,uint256,uint256)" $cur --rpc-url $F | awk '{print $1}')
    coll=$(echo "$vals" | sed -n 1p); debt=$(echo "$vals" | sed -n 2p)
    cnicr=$($PY -c "print(int($coll)*10**20//int($debt))")
    if [ "$cnicr" -ge "$nicr" ]; then up=$cur; cur=$(cast call $MST "getNext(address)(address)" $cur --rpc-url $F | cut -d' ' -f1); else break; fi
  done
  echo "$up $cur"
}

cast rpc anvil_setBalance $D0 0x21E19E0C9BAB2400000 --rpc-url $F >/dev/null   # 10000 BTC fork-only
cast rpc anvil_setBalance $AG 0x56BC75E2D63100000 --rpc-url $F >/dev/null
cast rpc anvil_setBalance $KEEP 0x56BC75E2D63100000 --rpc-url $F >/dev/null
read COLL250 COLL300 <<<$( $PY - <<PY
P=$PRICE/1e18; debt=1800*1.001+200
print(f"{int(2.5*debt/P*1e18)} {int(3.0*debt/P*1e18)}")
PY
)
echo "composite debt 2001.8 MUSD; BTC for ICR 250% = $(cast from-wei $COLL250), 300% = $(cast from-wei $COLL300)"

echo "== deploy TroveAccount implementation (production, fee 10 bps to fork owner)"
OUT=$(forge create src/account/TroveAccount.sol:TroveAccount --rpc-url $F --private-key $K0 --broadcast --gas-limit 8000000 --constructor-args $MBO $MTM $MPF $MMUSD $MSM $MST $D0 10 2>&1)
echo "$OUT" | grep -E "Deployed to|Compiler run" || { echo "$OUT"; exit 1; }
IMPL=$(echo "$OUT" | grep "Deployed to" | awk '{print $3}'); echo "implementation $IMPL"
echo "== deploy TroveAccountFactory"
OUT=$(forge create src/account/TroveAccountFactory.sol:TroveAccountFactory --rpc-url $F --private-key $K0 --broadcast --gas-limit 8000000 --constructor-args $IMPL $D0 10 2>&1)
echo "$OUT" | grep -E "Deployed to|Compiler run" || { echo "$OUT"; exit 1; }
FACTORY=$(echo "$OUT" | grep "Deployed to" | awk '{print $3}'); echo "factory $FACTORY"

NICR250=$($PY -c "print($COLL250*10**20//1800000000000000000000)")
NICR300=$($PY -c "print($COLL300*10**20//1800000000000000000000)")
read UP250 LO250 <<<$(hints $NICR250); echo "hints 250%: up=$UP250 lo=$LO250"
read UP300 LO300 <<<$(hints $NICR300); echo "hints 300%: up=$UP300 lo=$LO300"

echo "== Account A: createAndOpen at ICR 2.5 (250%)"
SALT_A=0x0000000000000000000000000000000000000000000000000000000000000001
ACC_A=$(cast call $FACTORY "predict(address,bytes32,(uint64,uint64,uint64,uint128,uint128,uint32))(address)" $D0 $SALT_A "$POLICY" --rpc-url $F | cut -d' ' -f1)
echo "predicted account A $ACC_A"
cast send $FACTORY "createAndOpen(bytes32,(uint64,uint64,uint64,uint128,uint128,uint32),uint256,address,address,uint256)" $SALT_A "$POLICY" $DEBT $UP250 $LO250 0 --value $COLL250 --private-key $K0 --gas-limit 9000000 --rpc-url $F --json | $PY -c "import sys,json;d=json.load(sys.stdin);print('  createAndOpen tx',d.get('status'),'gasUsed',int(d.get('gasUsed','0x0'),16))"
echo "  status A $(status $ACC_A) (1 = active); ICR A $(icr $ACC_A) (expect ~2.5e18)"

echo "== Account B: createAndOpen at ICR 3.0 (300%)"
SALT_B=0x0000000000000000000000000000000000000000000000000000000000000002
ACC_B=$(cast call $FACTORY "predict(address,bytes32,(uint64,uint64,uint64,uint128,uint128,uint32))(address)" $D0 $SALT_B "$POLICY" --rpc-url $F | cut -d' ' -f1)
echo "predicted account B $ACC_B"
cast send $FACTORY "createAndOpen(bytes32,(uint64,uint64,uint64,uint128,uint128,uint32),uint256,address,address,uint256)" $SALT_B "$POLICY" $DEBT $UP300 $LO300 0 --value $COLL300 --private-key $K0 --gas-limit 9000000 --rpc-url $F --json | $PY -c "import sys,json;d=json.load(sys.stdin);print('  createAndOpen tx',d.get('status'),'gasUsed',int(d.get('gasUsed','0x0'),16))"
echo "  status B $(status $ACC_B) (1 = active); ICR B $(icr $ACC_B) (expect ~3.0e18)"

echo "== session for agent + draw 5 MUSD JIT to a payee (account B)"
# NOTE: the draw runs on B (opened at ICR 3.0), NOT on A. The production
# policy floor is 2.50, so an account opened at exactly 2.50 has zero draw
# headroom: any draw leaves ICR < floor and reverts BelowFloor by design
# (verified: draw on a 2.50 account reverts BelowFloor(2.493e18, 2.5e18)).
# B at 3.0 leaves ICR ~2.99 after the draw, above the floor.
EXP=$(( $(date +%s) + 86400 ))
snd $ACC_B "setSession(address,uint128,uint128,uint128,uint64,bool,bool)" $AG 50000000000000000000 10000000000000000000 10000000000000000000 $EXP true false --private-key $K0
cast send $ACC_B "draw(address,uint256)" 0x000000000000000000000000000000000000dEaD 5000000000000000000 --private-key $KA --gas-limit 9000000 --rpc-url $F --json | $PY -c "import sys,json;d=json.load(sys.stdin);print('  draw tx',d.get('status'),'gasUsed',int(d.get('gasUsed','0x0'),16))"
echo "  status B $(status $ACC_B); ICR B $(icr $ACC_B); payee MUSD $(cast call $MMUSD 'balanceOf(address)(uint256)' 0x000000000000000000000000000000000000dEaD --rpc-url $F)"

echo "== park 1000 MUSD in real mainnet sMUSD (account A)"
snd $ACC_A "park(uint256)" 1000000000000000000000 --private-key $K0
echo "  sMUSD balance A $(cast call $MSM 'balanceOf(address)(uint256)' $ACC_A --rpc-url $F)"
echo "  status A $(status $ACC_A)"

echo "== crash the price 38% (×0.62, fork-only), read the shield trigger, probe shield()"
setprice $($PY -c "print(int($PRICE*0.62))")
echo "  ICR A at crashed price $(icr $ACC_A)"
echo "  needed() A: $(cast call $ACC_A 'needed()(uint256,uint256,uint256,uint8)' --rpc-url $F) (icr, repayWanted, collWanted, reason; reason 1 = ICR trigger)"
SHIELD_OUT=$(cast send $ACC_A "shield()" --private-key $KP --gas-limit 9000000 --rpc-url $F 2>&1 || true)
echo "  shield() probe: $SHIELD_OUT"
echo "  NOTE: shield() is task 1.4 and is NOT in the production TroveAccount on main yet — the probe above is EXPECTED to fail. The trigger (needed reason 1) is verified; the actuator is not."
setprice $PRICE
echo "  price restored; ICR A $(icr $ACC_A); status A $(status $ACC_A)"

echo "== CLOSE A: unpark everything, fund the fee/interest shortfall (impersonated holder, fork-only), closeAccount"
cast send $ACC_A "unpark(uint256)" 1000000000000000000000 --private-key $K0 --gas-limit 9000000 --rpc-url $F >/dev/null || true
cast rpc anvil_impersonateAccount $MSM --rpc-url $F >/dev/null; cast rpc anvil_setBalance $MSM 0xDE0B6B3A7640000 --rpc-url $F >/dev/null
cast send $MMUSD "transfer(address,uint256)" $ACC_A 30000000000000000000 --from $MSM --unlocked --rpc-url $F >/dev/null
echo "  account A MUSD $(cast call $MMUSD 'balanceOf(address)(uint256)' $ACC_A --rpc-url $F), debt $(cast call $MTM 'getEntireDebtAndColl(address)(uint256,uint256,uint256,uint256,uint256,uint256)' $ACC_A --rpc-url $F | head -2 | tr '\n' ' ')"
BEFORE_A=$(cast balance $D0 --rpc-url $F)
snd $ACC_A "closeAccount()" --private-key $K0
echo "  account A BTC after close $(cast balance $ACC_A --rpc-url $F) (closeAccount sweeps to owner)"
echo "  trove status A $(status $ACC_A) (2 = closedByOwner); owner BTC delta $( $PY -c "print(($(cast balance $D0 --rpc-url $F)-$BEFORE_A)/1e18)")"

echo "== CLOSE B: fund shortfall, closeAccount"
cast send $MMUSD "transfer(address,uint256)" $ACC_B 30000000000000000000 --from $MSM --unlocked --rpc-url $F >/dev/null
BEFORE_B=$(cast balance $D0 --rpc-url $F)
snd $ACC_B "closeAccount()" --private-key $K0
echo "  account B BTC after close $(cast balance $ACC_B --rpc-url $F)"
echo "  trove status B $(status $ACC_B) (2 = closedByOwner); owner BTC delta $( $PY -c "print(($(cast balance $D0 --rpc-url $F)-$BEFORE_B)/1e18)")"

echo "== SUMMARY (mainnet fork-tested, never live on mainnet)"
echo "  implementation $IMPL"
echo "  factory $FACTORY"
echo "  account A $ACC_A (opened 2.5, closed, status $(status $ACC_A))"
echo "  account B $ACC_B (opened 3.0, closed, status $(status $ACC_B))"
echo "  shield(): NOT PRESENT in production TroveAccount on main (task 1.4 unmerged); trigger verified via needed(), actuator missing."
