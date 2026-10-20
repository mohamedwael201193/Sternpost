# Slither triage

`cd contracts && slither . --filter-paths "lib|test|script"`. The full output is in [slither.txt](slither.txt).

Slither 0.11 ran 102 detectors over 9 contracts. The first run reported 27 results; the hardening commit fixed 7 of them, and the 20 that remain are triaged below.

## Fixed

| Detector | Where | Fix |
|---|---|---|
| unused-return (x4) | `approve` calls in Governor/SpendWallet | Return value checked; reverts `TransferFailed` |
| reentrancy-no-eth | `defend()` wrote `buffer` after the sMUSD withdraw | State is now updated before the external call (CEI) |
| uninitialized-local | `revoke()` `burned` | Initialised from `burnSig.length` |

## Accepted, with reasons

| Detector | Where | Why it is safe |
|---|---|---|
| reentrancy-balance | `draw()` reads the MUSD balance before the Mezo withdraw and compares the delta after it | This delta check is deliberate: it proves exactly `amount` arrived. `draw()` is `nonReentrant`, and the only re-entry allowed is the ActivePool's `receive()`, which accepts one zero-value callback while `inDraw` and nothing else. CI runs slither with this detector excluded and links this note. |
| reentrancy-benign / events | `draw`, `heal`, `defend`, `revoke` | Only events or the callback counter are written after trusted Mezo calls, all under `nonReentrant`. |
| missing-zero-check | SpendWallet constructor | Only the factory creates it, with `msg.sender` as owner. A zero agent means "no agent" by design. |
| timestamp | expiry and deadline checks | Second-level precision is fine for 120 s windows and day-level expiries. |
| cyclomatic-complexity, naming, too-many-digits | style | Informational. |

## Deployed bytecode

The hardened code is live. Factory `0x0632A9FeA303c0dB4544BF642a8aD0467C6c6980` was redeployed on 2026-10-23 after these fixes, and `script/bytecode-match.py` shows the live code equals this source. The pre-hardening factory `0x29bf11Cd…` is superseded.
