# Sternpost — test-all
#
# `make test-all` runs every suite and writes TESTS.json at the repo root
# (see scripts/count-tests.sh). Fork suites run only with FORK=1; they are
# listed separately in TESTS.json and never added into the total twice.
#
#   make test-all            # offline suites + vitest (no RPC needed)
#   FORK=1 make test-all     # also runs the fork suites on testnet + mainnet
#                            # (measured 2026-11-15 re-run: testnet ~74s,
#                            # mainnet ~34s — contract durations summed,
#                            # not ~50s)
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
# errored suite) or stale (sources changed since the commit it was
# generated from): stamping a green "N passing" badge over red or stale
# counts would be a lie. Fix the failing suites, re-run `make test-all`,
# then sync. `make check-tests` FAILS (exit 1) on a red or stale
# TESTS.json even when the numbers match — the old behaviour (warn, exit
# 0) let red counts ship as a passing drift gate. `total.passed` in
# TESTS.json is a NON-FORK subtotal: the README line reads "N passing
# (non-fork subtotal; E2E not counted)", never "N in total" (plan C12:
# 198 distinct declared vs 179 passed non-fork on the pre-merge tree).
#
# NOTE (0.8 fix pass, 2026-11-15): gov-chain merged to main (019fece),
# so the fork delta fix is in and the counts below are re-run on the
# merged tree. The README table breakdowns in parentheses ("Governor
# 21 + …") are still owned prose and must be refreshed by their owners;
# the bold headline numbers are generated. Fork-failure diagnosis,
# corrected: the old testnet 9/10 was the line-42 ABSOLUTE payee-balance
# assertion (0xBEEF pre-held 5.36 MUSD on live testnet), NOT the
# previewDraw double-count — see scripts/count-tests.sh header.

.PHONY: test-all check-tests sync-proof

test-all:
	bash scripts/count-tests.sh

check-tests:
	node scripts/sync-proof.mjs --check

sync-proof:
	node scripts/sync-proof.mjs
