// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ITroveAccount, Policy} from "./interfaces/ITroveAccount.sol";

/// @title TroveAccountFactory
/// @notice Deploys deterministic ERC-1167 clones of the TroveAccount
///         implementation, one per (owner, salt). No admin, no upgrade path,
///         no pause (plan section 0.1 R6). Fee parameters are immutable and
///         capped (plan sections 3.2 and 3.11).
/// @dev Mezo addresses live in the implementation's immutables (plan 3.3),
///      not in the Factory. Salt = keccak256(owner, userSalt, policy) so the
///      address is predictable and front-running a creation cannot change the
///      owner OR the policy (adversarial review of task 1.1, finding F1: the
///      salt used to bind (owner, userSalt) only, so an attacker could
///      front-run a victim's creation with an attacker-chosen Policy; the
///      victim's tx then reverted AlreadyCreated and their account existed
///      under the attacker's policy. Binding the policy hash into the salt
///      makes the attacker's creation land at a different address).
///      The CREATE2 salt emitted in AccountCreated is the user-supplied salt
///      passed to createAccount / createAndOpen.
///      Fee parity (finding F2): createAccount passes the Factory's
///      feeRecipient/feeBps into `initialize`, and the implementation
///      reverts unless they equal its immutables.
contract TroveAccountFactory {
    /// @notice Hard cap on the agent-draw fee, in basis points (0.5%).
    uint16 public constant MAX_FEE_BPS = 50;

    /// @notice Burn address: never an acceptable fee recipient.
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;

    /// @notice TroveAccount logic contract. Immutable; every clone delegates to it.
    address public immutable implementation;

    /// @notice Receives the agent-draw fee (10 bps default). Immutable.
    address public immutable feeRecipient;

    /// @notice Agent-draw fee in basis points, <= MAX_FEE_BPS. Immutable.
    uint16 public immutable feeBps;

    /// @notice True for every account this Factory created.
    mapping(address => bool) public isAccount;

    /// @notice Emitted for the leaderboard / indexer on every creation.
    event AccountCreated(
        address indexed owner,
        address indexed account,
        bytes32 salt,
        uint256 floorICR,
        uint256 shieldICR,
        uint256 targetICR
    );

    error FeeBpsTooHigh(uint16 feeBps);
    error InvalidFeeRecipient(address feeRecipient);
    error ImplementationHasNoCode(address implementation);
    error ImplementationFeeMismatch(address implementationFeeRecipient, uint16 implementationFeeBps);
    error BadPolicy();
    error BountyTooHigh();
    error ZeroOwner();
    error AlreadyCreated(address account);
    error CloneFailed();

    /// @param implementation_ TroveAccount logic contract (must have code).
    /// @param feeRecipient_ Receives the draw fee; never address(0) or the burn address.
    /// @param feeBps_ Draw fee in basis points; reverts if > MAX_FEE_BPS.
    /// @dev Fee parity (J3-extra round 2 item 1): the constructor asserts
    ///      the implementation's fee getters equal the Factory's own values.
    ///      Before this check the fee cap/recipient checks constrained only
    ///      Factory storage that no clone ever reads — the fee lives as
    ///      immutables in the implementation bytecode. `initialize` re-checks
    ///      the same parity at creation time as a second gate.
    constructor(address implementation_, address feeRecipient_, uint16 feeBps_) {
        if (implementation_.code.length == 0) revert ImplementationHasNoCode(implementation_);
        if (feeBps_ > MAX_FEE_BPS) revert FeeBpsTooHigh(feeBps_);
        if (feeRecipient_ == address(0) || feeRecipient_ == BURN) {
            revert InvalidFeeRecipient(feeRecipient_);
        }
        if (
            ITroveAccount(implementation_).feeBps() != feeBps_
                || ITroveAccount(implementation_).feeRecipient() != feeRecipient_
        ) {
            revert ImplementationFeeMismatch(
                ITroveAccount(implementation_).feeRecipient(), ITroveAccount(implementation_).feeBps()
            );
        }
        implementation = implementation_;
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
    }

    /// @notice Predict the clone address for (owner, userSalt, policy) before creation.
    /// @param owner The future account owner.
    /// @param salt The user-chosen salt (combined with owner and policy into the CREATE2 salt).
    /// @param p The policy the account will be initialized with; part of the
    ///        salt preimage (finding F1), so a different policy predicts a
    ///        different address.
    function predict(address owner, bytes32 salt, Policy calldata p) public view returns (address) {
        if (owner == address(0)) revert ZeroOwner();
        bytes32 finalSalt = _finalSalt(owner, salt, p);
        bytes32 initCodeHash = keccak256(_cloneInitCode(implementation));
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), finalSalt, initCodeHash))))
        );
    }

    /// @notice Deploy the clone for (owner, salt) and initialize it once.
    /// @dev Permissionless: anyone may create an account FOR any owner, but
    ///      the owner recorded is always the `owner` argument, so a
    ///      front-runner cannot steal the account. The policy is bound into
    ///      the CREATE2 salt (finding F1), so a front-runner cannot steal the
    ///      policy either: their creation lands at a different address.
    ///      The policy is validated here as defense-in-depth (J3-extra round
    ///      2 item 3): `initialize`/`setPolicy` validation in the account
    ///      remains the primary gate, but a bad policy must never reach a
    ///      clone. Reverts if this (owner, salt, policy) was already created.
    function createAccount(address owner, bytes32 salt, Policy calldata p) public returns (address account) {
        if (owner == address(0)) revert ZeroOwner();
        _validatePolicy(p);
        account = predict(owner, salt, p);
        if (isAccount[account]) revert AlreadyCreated(account);
        account = _clone(implementation, _finalSalt(owner, salt, p));
        if (account == address(0)) revert CloneFailed();
        ITroveAccount(account).initialize(owner, p, feeRecipient, feeBps);
        isAccount[account] = true;
        emit AccountCreated(owner, account, salt, p.floorICR, p.shieldICR, p.targetICR);
    }

    /// @notice One tx for the wizard: deploy the clone for msg.sender and open
    ///         its trove. msg.value is the BTC collateral, forwarded to openFor.
    /// @param salt User-chosen salt; the account owner is msg.sender.
    /// @param p Policy for the new account (production defaults: 2.50e18 /
    ///        1.60e18 / 2.00e18, bounty 1e18, cooldown 20).
    /// @param debt MUSD debt to open with (must satisfy the Mezo minimum net debt).
    /// @param upHint loHint SortedTroves insertion hints for the new trove.
    /// @param minDebtAhead MUSD of debt that must sit ahead of the new trove
    ///        in redemption order (0 = rank trigger off).
    function createAndOpen(bytes32 salt, Policy calldata p, uint256 debt, address upHint, address loHint, uint256 minDebtAhead)
        external
        payable
        returns (address account)
    {
        account = createAccount(msg.sender, salt, p);
        ITroveAccount(account).openFor{value: msg.value}(debt, upHint, loHint, minDebtAhead);
    }

    /// @notice CREATE2 salt: the owner and the policy hash are mixed in so
    ///         addresses are predictable per (owner, salt, policy) and cannot
    ///         be hijacked (plan S19 + finding F1).
    function _finalSalt(address owner, bytes32 salt, Policy calldata p) internal pure returns (bytes32) {
        return keccak256(abi.encode(owner, salt, p));
    }

    /// @notice Policy validation, duplicated from TroveAccount (defense in
    ///         depth, J3-extra round 2 item 3): production ordering
    ///         `1.15e18 <= shieldICR < targetICR <= 10e18`,
    ///         `shieldICR < floorICR`, `bounty <= 5e18`.
    function _validatePolicy(Policy calldata p) internal pure {
        if (
            p.shieldICR < 1.15e18 || p.shieldICR >= p.targetICR || p.targetICR > 10e18 || p.shieldICR >= p.floorICR
        ) revert BadPolicy();
        if (p.bounty > 5e18) revert BountyTooHigh();
    }

    /// @notice ERC-1167 minimal-proxy init code for `implementation_`.
    function _cloneInitCode(address implementation_) internal pure returns (bytes memory) {
        return abi.encodePacked(
            hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", implementation_, hex"5af43d82803e903d91602b57fd5bf3"
        );
    }

    function _clone(address implementation_, bytes32 salt_) internal returns (address account) {
        bytes memory initCode = _cloneInitCode(implementation_);
        assembly {
            account := create2(0, add(initCode, 0x20), mload(initCode), salt_)
        }
    }
}
