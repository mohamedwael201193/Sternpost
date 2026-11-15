// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Batcher
/// @notice Stateless, ownerless, fundless multicall for TroveAccounts (plan
///         sections 3.1, 3.5, 3.7; task 1.6). Promotes the proven lab
///         `Batcher` (lab/src/Batcher.sol, live testnet 31611 at
///         0x306CD9a34EE7a7f40080296A47373373367f895c, two-agent draw tx
///         0x6768014f8154ea96c06032a35535d2e3e9bc844bd799922cf0bc3efead05fe31)
///         with typed helpers for the permissionless account calls.
/// @dev BALANCE-ALWAYS-ZERO INVARIANT (threat-model rule S20: "Relayer/
///      Batcher hold no funds and have no privileges; a bad relayer can only
///      delay"): this contract has no `receive()`, no fallback and no
///      payable function, and it never forwards `msg.value` (every sub-call
///      is a plain `call` with no value attached). No function can ever
///      leave funds in the Batcher: MUSD fees go straight from the account
///      to the fee recipient, surplus BTC lands in the account (the owner
///      sweeps it), and yield stays in the account. The only way funds
///      could ever arrive here is a forced transfer (selfdestruct /
///      coinbase), which no contract function can spend.
///      TWO BATCH SEMANTICS, deliberately different:
///      - `multi` / `multiDraw` are ALL-OR-NOTHING (lab semantics): if any
///        sub-call reverts, the whole transaction reverts and nothing
///        executes. That is what same-block draws need (plan 3.5): either
///        both agents' draws land in one transaction or neither does, and
///        no intent nonce is consumed by a half-finished batch.
///      - `claimCollateralBatch` / `claimYieldBatch` / `checkpointBatch`
///        are BEST-EFFORT per account: each account is attempted with a
///        low-level call and its outcome is reported (`ok` + amount),
///        never reverting the batch. That is what the claim paths need,
///        because the live behaviour of a zero-surplus `claimCollateral`
///        is chain-dependent: Liquity's CollSurplusPool requires a
///        positive balance, so the live Mezo `BorrowerOperations.
///        claimCollateral` may REVERT on zero surplus instead of no-op.
///        A keeper sweeping many accounts must not have its whole batch
///        bricked by one already-claimed account. The fork test in
///        Batcher.t.sol (`testFork_claimCollateralAfterRedemption`)
///        establishes the live behaviour on a mainnet fork and asserts the
///        batch survives whichever it is.
///      The Batcher never checks trove status itself: each TroveAccount
///      enforces its own rules (`TroveNotActive`, `RecoveryMode`, session
///      checks); the Batcher only orders and reports the calls.
///      BATCH SIZE (J3 F2): every batch function enforces `MAX_BATCH`
///      (100 entries). Gas derivation: a per-account claim costs
///      ~50-100k gas (external BorrowerOperations / CollSurplusPool
///      calls plus the event), and Mezo's block gas limit is 10M, so
///      10M / 100k = 100 accounts fills a block at worst-case gas.
///      The hard cap keeps any full batch inside one block; keepers
///      SHOULD target <= 50 accounts (~5M gas, half a block) so the
///      batch fits alongside other block traffic. An oversized batch
///      reverts whole-transaction with `BatchTooLarge` (no partial
///      state, no fund risk); the keeper retries smaller.
interface IBatcherAccount {
    function claimCollateral() external;
    function claimYield() external returns (uint256);
    function checkpoint() external;
    function drawBySig(address agent, address payee, uint256 amount, uint256 deadline, bytes calldata sig) external;
}

contract Batcher {
    /// @notice One signed draw intent for `multiDraw` (plan 3.5): the agent
    ///         signs EIP-712 `DrawIntent(agent, payee, amount, nonce,
    ///         deadline)`; the domain is the ACCOUNT's
    ///         ("SternpostTroveAccount", "1", chainId, account).
    struct DrawIntent {
        address agent;
        address payee;
        uint256 amount;
        uint256 deadline;
        bytes sig;
    }

    /// @notice `multiDraw` / `multi` inputs of different lengths.
    error LengthMismatch(uint256 accounts, uint256 intents);

    /// @notice Maximum entries in any batch call (J3 F2). Derivation:
    ///         Mezo block gas limit 10M / ~100k worst-case gas per
    ///         account claim = 100; a full batch can never exceed one
    ///         block even at worst-case gas. Keepers should target
    ///         <= 50 accounts per batch for headroom (see the
    ///         contract-level NatSpec).
    uint256 public constant MAX_BATCH = 100;

    /// @notice A batch call exceeded `MAX_BATCH` (`length` entries
    ///         against a cap of `maxBatch`). Whole-transaction revert,
    ///         no partial state; the keeper retries smaller.
    error BatchTooLarge(uint256 length, uint256 maxBatch);

    /// @notice One `multiDraw` transaction executed.
    event DrawsBatched(uint256 count);
    /// @notice One account's `claimCollateral` attempt inside a batch.
    ///         `claimed` is the BTC that landed in the account (0 when the
    ///         call failed or the account had no surplus).
    event CollateralClaimBatched(address indexed account, bool ok, uint256 claimed);
    /// @notice One account's `claimYield` attempt inside a batch.
    ///         `yielded` is the MUSD claimed into the account (0 when the
    ///         call failed or no yield was owed).
    event YieldClaimBatched(address indexed account, bool ok, uint256 yielded);
    /// @notice One account's `checkpoint` attempt inside a batch.
    event CheckpointBatched(address indexed account, bool ok);

    /// @notice Generic multicall, promoted UNCHANGED from the lab
    ///         (lab/src/Batcher.sol). Executes the calls in order inside ONE
    ///         transaction (hence one block). Reverts the whole transaction
    ///         if any sub-call fails, bubbling its revert data.
    /// @dev No value is ever forwarded: `targets[i].call(data[i])` carries
    ///      no `msg.value`, and this function is not payable. A `MAX_BATCH`
    ///      length guard (J3 F2) bounds the call count; the semantics are
    ///      otherwise the lab's verbatim.
    function multi(address[] calldata targets, bytes[] calldata data) external returns (bytes[] memory out) {
        if (targets.length > MAX_BATCH) revert BatchTooLarge(targets.length, MAX_BATCH);
        out = new bytes[](targets.length);
        for (uint256 i; i < targets.length; i++) {
            (bool ok, bytes memory r) = targets[i].call(data[i]);
            if (!ok) {
                assembly {
                    revert(add(r, 32), mload(r))
                }
            }
            out[i] = r;
        }
    }

    /// @notice Typed batch of `drawBySig` calls (plan 3.1: "a typed
    ///         `multiDraw` helper"). One transaction, one block, no owner
    ///         signature: each agent signs its own intent off-chain and any
    ///         relayer submits the batch. ALL-OR-NOTHING like `multi`: a
    ///         single bad signature, expired deadline, over-budget or
    ///         below-floor draw reverts the whole batch and consumes no
    ///         nonce, so a batch is never half-applied.
    /// @param accounts The TroveAccount of each intent, in order.
    /// @param intents One signed intent per account, in the same order.
    function multiDraw(address[] calldata accounts, DrawIntent[] calldata intents) external {
        if (accounts.length > MAX_BATCH) revert BatchTooLarge(accounts.length, MAX_BATCH);
        if (accounts.length != intents.length) revert LengthMismatch(accounts.length, intents.length);
        for (uint256 i; i < accounts.length; i++) {
            DrawIntent calldata intent = intents[i];
            IBatcherAccount(accounts[i]).drawBySig(intent.agent, intent.payee, intent.amount, intent.deadline, intent.sig);
        }
        emit DrawsBatched(accounts.length);
    }

    /// @notice Batch `claimCollateral()` across accounts (plan 3.3, G9: the
    ///         redemption incident left 0.0105 BTC of surplus stuck because
    ///         the deployed account had no claim wrapper; the production
    ///         account does, and a keeper sweeps it through here).
    ///         BEST-EFFORT: each account is attempted independently and its
    ///         outcome is reported. A zero-surplus account whose live
    ///         `claimCollateral` reverts does NOT brick the batch.
    /// @dev The surplus BTC lands in the ACCOUNT, never in the Batcher:
    ///      `claimed` is measured as the account's own balance delta, so
    ///      the Batcher balance stays 0 by construction. The delta is
    ///      SATURATING (J3 F1): if an account's balance DECREASES during
    ///      its claim — possible for any non-clone address the keeper
    ///      passes, which can send ETH out mid-call — the account
    ///      reports `claimed == 0` instead of panicking (0x11) and
    ///      rolling back every good claim in the batch.
    /// @param accounts TroveAccounts to claim surplus BTC for.
    /// @return ok Per-account success of the `claimCollateral()` call.
    /// @return claimed Per-account BTC that landed in the account (0 when
    ///         the call failed or the account had no surplus).
    function claimCollateralBatch(address[] calldata accounts)
        external
        returns (bool[] memory ok, uint256[] memory claimed)
    {
        if (accounts.length > MAX_BATCH) revert BatchTooLarge(accounts.length, MAX_BATCH);
        ok = new bool[](accounts.length);
        claimed = new uint256[](accounts.length);
        for (uint256 i; i < accounts.length; i++) {
            address account = accounts[i];
            uint256 before = account.balance;
            (bool success,) = account.call(abi.encodeWithSelector(IBatcherAccount.claimCollateral.selector));
            ok[i] = success;
            uint256 afterBal = account.balance;
            claimed[i] = success && afterBal >= before ? afterBal - before : 0;
            emit CollateralClaimBatched(account, ok[i], claimed[i]);
        }
    }

    /// @notice Batch `claimYield()` across accounts (plan 3.10: sMUSD yield
    ///         is claimable in MUSD; it stays in the account). BEST-EFFORT
    ///         like `claimCollateralBatch`: a single account whose claim
    ///         reverts does not brick the batch.
    /// @param accounts TroveAccounts to claim sMUSD yield for.
    /// @return ok Per-account success of the `claimYield()` call.
    /// @return yields Per-account MUSD claimed into the account (0 when the
    ///         call failed or no yield was owed).
    function claimYieldBatch(address[] calldata accounts)
        external
        returns (bool[] memory ok, uint256[] memory yields)
    {
        if (accounts.length > MAX_BATCH) revert BatchTooLarge(accounts.length, MAX_BATCH);
        ok = new bool[](accounts.length);
        yields = new uint256[](accounts.length);
        for (uint256 i; i < accounts.length; i++) {
            address account = accounts[i];
            (bool success, bytes memory ret) = account.call(abi.encodeWithSelector(IBatcherAccount.claimYield.selector));
            ok[i] = success && ret.length == 32;
            yields[i] = ok[i] ? abi.decode(ret, (uint256)) : 0;
            emit YieldClaimBatched(account, ok[i], yields[i]);
        }
    }

    /// @notice Batch `checkpoint()` across accounts (plan 3.3: the health
    ///         checkpoint emits `Checkpoint(status, icr, tcr, recoveryMode)`
    ///         so the indexer / Telegram bot can record health; views cannot
    ///         emit). BEST-EFFORT like the claim batches.
    /// @param accounts TroveAccounts to checkpoint.
    /// @return ok Per-account success of the `checkpoint()` call.
    function checkpointBatch(address[] calldata accounts) external returns (bool[] memory ok) {
        if (accounts.length > MAX_BATCH) revert BatchTooLarge(accounts.length, MAX_BATCH);
        ok = new bool[](accounts.length);
        for (uint256 i; i < accounts.length; i++) {
            address account = accounts[i];
            (bool success,) = account.call(abi.encodeWithSelector(IBatcherAccount.checkpoint.selector));
            ok[i] = success;
            emit CheckpointBatched(account, ok[i]);
        }
    }
}
