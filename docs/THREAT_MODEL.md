# Threat model

## Assets
- The borrower's trove: its BTC collateral and its debt headroom.
- MUSD drawn for apps and agents, held in SpendWallets.
- The governor's reserve buffer, which may be parked in sMUSD.

## Actors
| Actor | Trust |
|---|---|
| Borrower | Owns the trove and the governor. Signs Mezo EIP-712 messages. |
| App | Untrusted. Holds a per-app policy: budget, per-draw cap, expiry, payee. |
| Agent | Untrusted session key for one SpendWallet, with an expiry and a Permit2 budget. |
| Keeper | Anyone. Can call `heal()` and `defend()`. |
| Mezo | Trusted protocol dependency. |

## How the gate works
A withdraw signature names the governor as `recipient`. During a withdraw, Mezo's ActivePool calls `sendCollateral(recipient, 0)`, which reaches the governor's `receive()`. The governor only accepts that call inside its own `draw()` (`inDraw`, sender is the ActivePool, value 0, first callback). Anywhere else it reverts, and so the whole Mezo withdraw reverts too. Inside `draw()` the governor then checks:

1. The app policy: authorized, not expired, per-draw cap, remaining budget, payee lock.
2. That the window is at most 120 s and that the heal signature at `nonce+1` is valid.
3. That exactly one callback was seen and exactly `amount` MUSD arrived.
4. The ICR after the draw is at or above `floorICR`, or the whole tx reverts.

## Threats and mitigations

| # | Threat | Mitigation | Evidence |
|---|---|---|---|
| 1 | An app submits the borrower's signature straight to Mezo | `receive()` reverts outside `draw()` | fork `directBypassReverts`; testnet tx `0xcb54e35d…` |
| 2 | A draw pushes the trove below the floor | Post-draw ICR check | fork `unsafeDrawRefused`; testnet tx `0xa489db6a…` |
| 3 | An app overspends or pays another address | Per-app budget, per-draw cap, payee lock | unit + fuzz + invariant |
| 4 | A leaked signature is replayed later | 120 s window, and the shared nonce advances on every use | unit |
| 5 | The borrower wants every outstanding signature dead now | `revoke()` freezes and burns the nonce (1 wei AddColl) | fork `revokeBurnsNonce`; tx `0xda372cf8…`, then `0xe783e1f4…` reverts |
| 6 | **Mezo removes the ActivePool callback** | `draw()` requires exactly one callback (`CallbackMismatch`), so draws fail closed. Without the callback the governor cannot block a direct submission, but the signature still pays MUSD to the governor, not to the app. | fork `callbackRemoved` |
| 7 | Reentrancy through MUSD, sMUSD or the callback | `nonReentrant`, a one-shot callback flag, CEI | `Reentrancy.t.sol`, slither |
| 8 | The price drops sharply after a draw | A permissionless `defend()` repays the armed standby from the buffer below `defendICR`, then freezes | fork `defend` |
| 9 | A stale standby: any other signed action uses the shared nonce | `standby().live` exposes it, the SDK explains it, and `rearm()` restores it | fork `nonceRace`; tx `0x1e1a5421…` |
| 10 | A compromised agent key | SpendWallet expiry, the Permit2 budget, `revokeAgent()`, and owner `sweep()` | `SpendWallet.t.sol` |

## Known limits (honest)
- **Dependency on the callback.** The gate depends on how Mezo's ActivePool behaves today, not on an interface Mezo guarantees. Threat 6 shows that removing the callback fails closed for draws. A Mezo upgrade could still change the semantics, so the governor should be redeployed after any Mezo BorrowerOperations or ActivePool upgrade.
- **Shared nonce.** Mezo has one nonce per borrower. Concurrent apps will invalidate each other's signatures. The SDK `NonceCoordinator` serialises signing within one process; it cannot do that across processes.
- **Defend needs a live standby and a funded buffer.** It is a best-effort guard, not liquidation protection.
- **The oracle.** All ICR math uses Mezo's PriceFeed. A manipulated oracle is out of scope.
- **Not audited, testnet only.** Mainnet support is limited to fork tests.
