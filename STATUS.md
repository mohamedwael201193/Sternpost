# STATUS — Sternpost Wave 2 build (plan v4)

**Updated:** 2026-11-15 ~10:12 EET (build start). **Lead:** lead engineer + release manager (this agent).
**Repo:** `github.com/mohamedwael201193/Sternpost`, HEAD `17140e7` at start. **Task board:** `~/workspace/mezo-wave2/TASK_BOARD.md`.
**Merge rule (user order):** local checks green → merge + push main immediately. NO remote-CI wait. Secret scan before every push. 3 judges per agent. Tests always.

## Done
- Wave 1 baseline (2026-10-25): 19 USDT milestone, scores 8/7/8/6/8. Contracts source-verified in lab round 2 (Factory/Governor/Router v2/SpendWallet).
- Analysis + resources (2026-11-15): top-20 field ranking, judge-signed; MEZO_RESOURCES.md; demo-filming/wallet research.
- Build pack verified: plan sha256 `fef0ff5d…beefad`; repo cloned clean at HEAD `17140e7`; `gh` authenticated as `mohamedwael201193`; git identity set.

## In progress (Wave 1, launched ~10:12 EET)
- Gov chain (0.1+0.2+0.3+0.4+0.7): previewDraw fix, defend clamp, Recovery Mode reasons, 30-day standby, draw fee.
- 0.5 Router maxSlippageBps. 0.6 X402_PAY_TO required. 0.8-scaffold (Makefile/scripts only).
- 1.1 Factory + interfaces (ERC-1167 clones). 1.5 Radar. 3.1 shell/routes/tokens.

## Blocked / needs owner
- **FEE_RECIPIENT** — no address supplied. Interim for testnet deploys: deployer address unless owner supplies one.
- **X402_PAY_TO** — same; interim deployer address for testnet.
- **PROVEIT_KEY** — owner supplies in his own shell for `prove-it --live`.
- **Akindo exact cutoff** — UNVERIFIED (background check only, never gates work).

## Deployed addresses (Wave 1, testnet 31611 — verified in lab round 2)
- Factory `0x0632A9FeA303c0dB4544BF642a8aD0467C6c6980` · Governor `0x9eEa9762ED3c1dE2308c800687558064DFf0B832` · Router v2 `0xEC30280134f06668f35753D640c6760984179674` · SpendWallet `0x6330d69EbcA4ea00969a3f8085FE8BD5FC6D41FA`

## Test counts
- Honest distinct count: **198** (README still says 203 — task 0.8 fixes via `make test-all` → TESTS.json).

## Outside users
- **0** outside addresses so far (true count; Muster roll reports it when live).
