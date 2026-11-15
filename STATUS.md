# STATUS — Sternpost Wave 2 build (plan v4)

**Updated:** 2026-11-15 ~10:26 EET (build start). **Lead:** lead engineer + release manager (this agent).
**Repo:** `github.com/mohamedwael201193/Sternpost`, HEAD `2713e4e` (baseline pushed 10:13 EET). **Task board:** `~/workspace/mezo-wave2/TASK_BOARD.md`.
**Merge rule (user order):** NO PRs ever — direct push to main with the `.env` GITHUB_TOKEN (verified working after CRLF strip), clean commits under `mohamedwael201193`. Local checks green + 3 judges sign off + secret scan → push main immediately. NO remote-CI wait. Tests always.

## Done
- Wave 1 baseline (2026-10-25): 19 USDT milestone, scores 8/7/8/6/8. Contracts source-verified in lab round 2 (Factory/Governor/Router v2/SpendWallet).
- Analysis + resources (2026-11-15): top-20 field ranking, judge-signed; MEZO_RESOURCES.md; demo-filming/wallet research.
- Build pack verified: plan sha256 `fef0ff5d…beefad`; repo cloned clean at HEAD `17140e7`; `gh` authenticated as `mohamedwael201193`; git identity set.

## In progress (Wave 1, launched ~10:12 EET)
- Gov chain (0.1+0.2+0.3+0.4+0.7): previewDraw fix, defend clamp, Recovery Mode reasons, 30-day standby, draw fee.
- 0.5 Router maxSlippageBps. 0.6 X402_PAY_TO required. 0.8-scaffold (Makefile/scripts only).
- 1.1 Factory + interfaces (ERC-1167 clones). 1.5 Radar. 3.1 shell/routes/tokens.
- Infra probe: Vercel deploy route (REST API / real CLI / GitHub auto-deploy) — report to `~/workspace/mezo-wave2/VERCEL_DEPLOY_ROUTE.md`, no repo edits.

## Standing rules (user orders, permanent)
- **GitHub stays clean — no useless docs.** Commit ONLY plan-required docs with real verified content (README, proof table, security-triage, submission texts, plan-mandated files). NO scratch docs, analysis dumps, working notes, duplicates, generated junk, build artifacts, `.env`. Working notes stay in the workspace, out of the repo. `git status` check before every push; judges add a repo-cleanliness check.
- **Monitoring:** one owner per task, one owner per file, no duplicates ever; judges are separate from builders, 3 per agent, tracked on the board. Agent quiet >1h → re-spawn immediately.
- **DESIGN FREEZE (user order 2026-11-15 ~10:32 EET).** Do NOT redesign — the porcelain/cream design IS the design (Wave 1 video reference on disk). Dashboard flow follows the video's 12 demo chapters. Wave 2 video: same design language, MORE creative structure shaped by the new ideas; intro >50s, complete and cinematic (intro concept shown to parent before the full cut); demo section left as a marked placeholder slot for the user's own footage; new real numbers only; 3-judge video gate before any delivery.
- **FRONTEND WIRING IS TOP PRIORITY (user order 2026-11-15 ~10:37 EET).** Every new Wave 2 address + ABI goes into the ONE source of truth (`shared/deployments/testnet.json`, W3-owned; frontend reads, never writes elsewhere); no hardcoded stale addresses, no Wave 1 addresses pointing at old contracts. Browser QA (F1–F7) verifies the live UI calls the NEW contracts — a page that looks right but calls old contracts is a FAIL.
- **DEPLOY AFTER EVERY FRONTEND PUSH (mandatory).** Vercel project `sternpost` is NOT GitHub-connected (git link None) — pushes to main do NOT auto-deploy. After every frontend push to main: `vercel deploy --prod` with the token (real CLI `/usr/bin/vercel`, or REST API) or the live site stays stale. Env changes need a redeploy too (public vars baked at build). Vercel env edits AUTHORIZED (token, in-process only).

## Blocked / needs owner
- **FEE_RECIPIENT** — no address supplied. Interim for testnet deploys: deployer/team wallet `0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3` (verified live 2026-11-15) unless owner supplies one.
- **X402_PAY_TO** — same; interim deployer address for testnet.
- **PROVEIT_KEY** — owner supplies in his own shell for `prove-it --live`.
- **Akindo exact cutoff** — UNVERIFIED (background check only, never gates work).

## Verified environment (parent checked live, 2026-11-15 ~10:14 EET)
- Deployer key: `.env` had 3 CR chars (CRLF trap — raw key fails to decode in cast). Parent stripped all CRs in place (now LF-only, 0 CRs, verified 10:22 EET). Address `0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3`; testnet balance **0.013561434219294365 BTC** (dust deploys OK; demo-trove collateral is tight — faucet top-up may be needed for 1.9); mainnet balance 0 (testnet-only confirmed).
- GITHUB_TOKEN in `.env` is VALID (was never bad — the CRLF broke the Authorization header). Primary push auth; saved `gh` auth is the fallback. Both log in as `mohamedwael201193`.
- VERCEL_TOKEN validity UNVERIFIED (api.vercel.com unreachable from this VM — network failure, not a token verdict); deploy route being probed; build continues regardless.

## Deployed addresses (Wave 1, testnet 31611 — verified in lab round 2)
- Factory `0x0632A9FeA303c0dB4544BF642a8aD0467C6c6980` · Governor `0x9eEa9762ED3c1dE2308c800687558064DFf0B832` · Router v2 `0xEC30280134f06668f35753D640c6760984179674` · SpendWallet `0x6330d69EbcA4ea00969a3f8085FE8BD5FC6D41FA`

## Test counts
- Honest distinct count: **198** (README still says 203 — task 0.8 fixes via `make test-all` → TESTS.json).

## Outside users
- **0** outside addresses so far (true count; Muster roll reports it when live).
