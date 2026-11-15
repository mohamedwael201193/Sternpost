# Sternpost — test-all
#
# `make test-all` runs every suite and writes TESTS.json at the repo root
# (see scripts/count-tests.sh). Fork suites run only with FORK=1; they are
# listed separately in TESTS.json and never added into the total twice.
#
#   make test-all            # offline suites + vitest (no RPC needed)
#   FORK=1 make test-all     # also runs the fork suites on testnet + mainnet
#                            # (slow: Mezo SortedTroves walks over RPC)
#
# Generation wiring (task 0.8, plan §7.1 / C12): the numbers in README.md,
# app/src/landing/Proof.tsx and judges/JUDGES.md are GENERATED from
# TESTS.json by scripts/sync-proof.mjs — never hand-edited. `make
# check-tests` is the CI drift gate: it fails if any of those numbers
# differs from the committed TESTS.json.
#
#   make sync-proof          # rewrite README/Proof/JUDGES numbers from TESTS.json
#   make check-tests         # fail if those numbers drift from TESTS.json
#
# sync-proof REFUSES to write while TESTS.json is red (any failed test or
# errored suite): stamping a green "N passing" badge over red counts would
# be a lie. Fix the failing suites, re-run `make test-all`, then sync.
# check-tests still runs on a red TESTS.json (it reports drift, and warns
# loudly about the red state) so the failure stays visible in CI.
#
# NOTE (0.8 scaffold): the full sync lands after tasks 0.1–0.7 merge —
# their fixes add/change tests, so the counts move again and the README
# table breakdowns in parentheses ("Governor 21 + …") must be refreshed by
# their owners. What is ready NOW: the runner, the summarizer, the sync
# script, the drift check and the CI job below. What waits: re-running
# test-all + sync-proof on the merged tree (and the fork rows, which need
# FORK=1) before the numbers can be called final.

.PHONY: test-all check-tests sync-proof

test-all:
	bash scripts/count-tests.sh

check-tests:
	node scripts/sync-proof.mjs --check

sync-proof:
	node scripts/sync-proof.mjs
