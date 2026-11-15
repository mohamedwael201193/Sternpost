#!/usr/bin/env bash
# count-tests.sh — run every Sternpost suite and record the REAL executed
# counts into out/*.json; scripts/summarize.mjs then merges them into
# TESTS.json at the repo root.
#
# Usage:
#   scripts/count-tests.sh            # offline suites + vitest (no RPC)
#   FORK=1 scripts/count-tests.sh     # also run the fork suites on the
#                                     # Mezo testnet + mainnet RPCs (slow)
#
# Design (plan §7.1; repo audit §G):
# - The offline forge suite runs in SPLIT passes, one per test directory
#   (unit / invariant / fork-offline). The full `forge test` in one process
#   was OOM-killed in solc (via_ir, 6 GB VM; see also the plan's 783 s
#   OOM note). Splitting keeps each solc/forge invocation small enough to
#   finish, and each pass writes its own file, so a failure in one pass
#   cannot silently eat another pass's counts.
# - Fork tests are SEPARATE passes/files (forge-fork-testnet.json,
#   forge-fork-mainnet.json) and are NEVER added into the total twice:
#   summarize.mjs excludes every kind:"fork" suite from total. The same
#   10 fork tests also appear as skipped in forge-fork-offline.json
#   (FORK_ON unset) — that line is likewise excluded from the total.
# - Vitest runs with `--maxWorkers=1`. The default pool runs one worker
#   per test file and the backend boots an in-memory Postgres (PGlite)
#   per file; on this shared 6 GB VM the parallel run was OOM-killed
#   mid-suite and reported numbers for tests that never executed. One
#   worker is slower but finishes. NOTE: `--poolOptions.*` is NOT a CLI
#   flag in vitest 3/4/5 (CACError "Unknown option"); `--maxWorkers`
#   is the CLI flag that exists in all three.
# - Every runner's output file is DELETED before its run: a crashed
#   runner must leave an "error" marker (via check_json), never the
#   previous run's file silently re-reported as fresh.
# - mcp/ and keeper/ do not exist yet: they are recorded as "missing",
#   not failed. Any other missing/unparseable output is recorded as an
#   error, never silently dropped and never invented.
# - This script does NOT use `set -e`: a suite that fails its tests must
#   still be counted, and the remaining suites must still run. The exit
#   code is non-zero iff summarize.mjs reports a failed or errored suite.
# - No secrets are read, printed or exported here. No private key is
#   needed (fork tests use vm.deal / anvil-style local accounts only).
#
# Expected durations (shared 6 GB VM, cold cache): forge compile ~3 min
# once, then each forge pass ~1 min; vitest per package ~1-3 min after
# `npm ci`. Fork passes: several minutes each over RPC (SortedTroves
# walks); the lab measured 382 s for the testnet fork suite alone.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/out"
mkdir -p "$OUT"

# Foundry is installed under ~/.foundry/bin (forge 1.8.6); it is not on
# PATH by default on this machine.
if [ -d "$HOME/.foundry/bin" ]; then
  export PATH="$HOME/.foundry/bin:$PATH"
fi

# --- helpers ---------------------------------------------------------------
# Write a marker JSON so summarize.mjs can report a suite honestly instead
# of guessing: {"status":"missing"|"error","note":"..."}.
write_marker() { # $1=file $2=status $3=note
  printf '{"status":"%s","note":"%s"}\n' "$2" "$3" > "$OUT/$1"
}

# Validate that a runner actually produced parseable JSON; otherwise replace
# it with an error marker (a crashed/OOM-killed runner must not look like
# "0 tests ran" and must not be silently skipped).
check_json() { # $1=file $2=suite-label
  if [ ! -s "$OUT/$1" ] || ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$OUT/$1" 2>/dev/null; then
    write_marker "$1" "error" "$2: no parseable output (runner crashed, was OOM-killed, or never ran)"
    return 1
  fi
  return 0
}

# --- forge -----------------------------------------------------------------
# forge-std is a dev dependency of the contracts but is NOT vendored in the
# repo (contracts/lib/ is gitignored and there is no .gitmodules upstream).
# Bootstrap it as a plain directory — never as a git submodule (a submodule
# would add .gitmodules + a gitlink to the repo, which this task must not do).
if [ ! -f "$ROOT/contracts/lib/forge-std/src/Test.sol" ]; then
  echo "count-tests: bootstrapping contracts/lib/forge-std (plain directory, no submodule)..."
  mkdir -p "$ROOT/contracts/lib"
  if ! (cd "$ROOT/contracts" && forge install --no-git foundry-rs/forge-std 2>"$OUT/forge-install.stderr"); then
    rm -rf "$ROOT/contracts/lib/forge-std"
    git clone --depth 1 https://github.com/foundry-rs/forge-std "$ROOT/contracts/lib/forge-std" >>"$OUT/forge-install.stderr" 2>&1 || true
  fi
fi

# Split forge passes (see header: OOM defence). Each pass writes its own
# file. The fork directory runs WITHOUT FORK_ON here, so all 10 fork tests
# are recorded as skipped; the real fork runs are separate passes below.
run_forge() { # $1=match-path $2=outfile $3=label ; extra forge args follow
  local match="$1" out="$2" label="$3"; shift 3
  echo "count-tests: forge $label ..."
  rm -f "$OUT/$out" "$OUT/${out%.json}.stderr"
  (cd "$ROOT/contracts" && forge test --match-path "$match" --json "$@" > "$OUT/$out" 2> "$OUT/${out%.json}.stderr") || true
  check_json "$out" "$label" || true
}
run_forge "test/unit/*"      forge-unit.json         "forge unit+fuzz (offline)"
run_forge "test/invariant/*" forge-invariant.json    "forge invariant (offline)"
run_forge "test/fork/*"      forge-fork-offline.json "forge fork (offline, FORK_ON unset -> skipped)"

# Fork passes: separate files, only when FORK=1. Env values are the public
# Mezo contract addresses from contracts/script/fork.sh (testnet/mainnet).
# P0 pins the live BTC price because the oracle precompile is unavailable
# in forks. FORK_ON=1 selects the fork path inside the tests; --fork-url
# gives forge its default fork (the tests also createSelectFork(RPC)).
if [ "${FORK:-0}" = "1" ]; then
  echo "count-tests: forge fork testnet (FORK=1; slow over RPC) ..."
  rm -f "$OUT/forge-fork-testnet.json" "$OUT/forge-fork-testnet.stderr"
  (cd "$ROOT/contracts" && FORK_ON=1 RPC=https://rpc.test.mezo.org \
    SIG=0xD757e3646AF370b15f32EB557F0F8380Df7D639e \
    BO=0xCdF7028ceAB81fA0C6971208e83fa7872994beE5 \
    PF=0x86bCF0841622a5dAC14A313a15f96A95421b9366 \
    MUSD=0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503 \
    TM=0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0 \
    P0=81353575800000000000000 \
    forge test --match-path "test/fork/*" --fork-url https://rpc.test.mezo.org --json \
    > "$OUT/forge-fork-testnet.json" 2> "$OUT/forge-fork-testnet.stderr") || true
  check_json "forge-fork-testnet.json" "forge fork testnet" || true

  echo "count-tests: forge fork mainnet (FORK=1; slow over RPC) ..."
  rm -f "$OUT/forge-fork-mainnet.json" "$OUT/forge-fork-mainnet.stderr"
  (cd "$ROOT/contracts" && FORK_ON=1 RPC=https://rpc-http.mezo.boar.network \
    SIG=0xB57ab578BF20b3e318f3EFAA587C51DBccE5df7a \
    BO=0x44b1bac67dDA612a41a58AAf779143B181dEe031 \
    PF=0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88 \
    MUSD=0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186 \
    TM=0x94AfB503dBca74aC3E4929BACEeDfCE19B93c193 \
    P0=81354900000000000000000 \
    forge test --match-path "test/fork/*" --fork-url https://rpc-http.mezo.boar.network --json \
    > "$OUT/forge-fork-mainnet.json" 2> "$OUT/forge-fork-mainnet.stderr") || true
  check_json "forge-fork-mainnet.json" "forge fork mainnet" || true
else
  echo "count-tests: fork passes skipped (set FORK=1 to run them over RPC)"
fi

# --- vitest ----------------------------------------------------------------
# run_vitest $1=package dir $2=outfile $3=label
# A package that does not exist yet (mcp, keeper) is recorded as "missing"
# and does not fail the run. A package whose install/test crashes gets an
# error marker with the real counts absent, never a fabricated zero.
run_vitest() {
  local pkg="$1" out="$2" label="$3"
  if [ ! -d "$ROOT/$pkg" ]; then
    echo "count-tests: $label missing (no $pkg/ directory yet) — recorded as missing, not failed"
    write_marker "$out" "missing" "$pkg package does not exist yet"
    return 0
  fi
  if [ ! -f "$ROOT/$pkg/package.json" ]; then
    write_marker "$out" "missing" "$pkg has no package.json"
    return 0
  fi
  echo "count-tests: vitest $label ..."
  (
    cd "$ROOT/$pkg"
    if [ ! -d node_modules ]; then
      npm ci --no-audit --no-fund > "$OUT/${out%.json}.npm.log" 2>&1 || {
        echo "count-tests: $label: npm ci failed (see out/${out%.json}.npm.log)"
        write_marker "$out" "error" "$label: npm ci failed"
        exit 0
      }
    fi
    # Delete any stale output first: a crashed vitest must not leave the
    # previous run's JSON in place to be re-reported as fresh (this bit
    # run3: --poolOptions CACErrored in backend+sdk, but their run2 files
    # were still counted). --maxWorkers=1: one worker for all files (see
    # header: PGlite-per-file OOM defence on the shared 6 GB VM).
    rm -f "$OUT/$out" "$OUT/${out%.json}.stdout.log" "$OUT/${out%.json}.stderr"
    npx vitest run --maxWorkers=1 --reporter=json --outputFile="$OUT/$out" > "$OUT/${out%.json}.stdout.log" 2> "$OUT/${out%.json}.stderr" || true
  )
  check_json "$out" "$label" || true
}
run_vitest "sdk"     sdk.json     "sdk"
run_vitest "backend" backend.json "backend"
run_vitest "app"     app.json     "app"
run_vitest "mcp"     mcp.json     "mcp"
run_vitest "keeper"  keeper.json  "keeper"

# --- summarize -------------------------------------------------------------
echo "count-tests: summarizing out/*.json -> TESTS.json ..."
node "$ROOT/scripts/summarize.mjs" "$OUT"
status=$?
if [ "$status" -eq 0 ]; then
  echo "count-tests: TESTS.json written (all completed suites green)"
else
  echo "count-tests: TESTS.json written with failures/errors (exit $status) — see TESTS.json"
fi
exit "$status"
