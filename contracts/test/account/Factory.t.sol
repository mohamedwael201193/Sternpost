// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {TroveAccountFactory} from "../../src/account/TroveAccountFactory.sol";
import {ITroveAccount, Policy} from "../../src/account/interfaces/ITroveAccount.sol";

/// @notice Minimal stand-in for TroveAccount (task 1.2 owns the real one).
///      Implements ONLY the surface the Factory calls: initialize (once,
///      factory only as first caller) and openFor (factory only, once).
///      It records what it was called with so the Factory tests can assert
///      wiring without touching Mezo.
contract StubTroveAccount is ITroveAccount {
    address public owner;
    address public factory;
    bool public initialized;
    bool public opened;
    Policy public policy;
    uint256 public openDebt;
    uint256 public openValue;
    address public openUpHint;
    address public openLoHint;
    uint256 public openMinDebtAhead;

    error AlreadyInitialized();
    error NotFactory();
    error AlreadyOpened();

    function initialize(address owner_, Policy calldata p) external {
        if (initialized) revert AlreadyInitialized();
        initialized = true;
        factory = msg.sender;
        owner = owner_;
        policy = p;
    }

    function openFor(uint256 debt, address upHint, address loHint, uint256 minDebtAhead) external payable {
        if (msg.sender != factory) revert NotFactory();
        if (opened) revert AlreadyOpened();
        opened = true;
        openDebt = debt;
        openValue = msg.value;
        openUpHint = upHint;
        openLoHint = loHint;
        openMinDebtAhead = minDebtAhead;
    }
}

/// @notice Task 1.1 acceptance tests (plan section 10, task 1.1):
///         predict == created, fee cap, no burn recipient, owner set once.
contract FactoryTest is Test {
    TroveAccountFactory public factory;
    StubTroveAccount public implementation;
    address public feeRecipient = makeAddr("feeRecipient");
    address public owner = makeAddr("owner");

    bytes32 public constant SALT = bytes32(uint256(0xA11CE));
    uint256 public constant DEBT = 2000e18;

    function setUp() public {
        implementation = new StubTroveAccount();
        factory = new TroveAccountFactory(address(implementation), feeRecipient, 10);
        vm.deal(address(this), 10 ether);
    }

    function _policy() internal pure returns (Policy memory) {
        // Production defaults (plan 3.3): floor 2.50, shield 1.60, target 2.00.
        return Policy({
            floorICR: uint64(2500000000000000000),
            shieldICR: uint64(1600000000000000000),
            targetICR: uint64(2000000000000000000),
            bounty: uint128(1000000000000000000),
            minDebtAhead: uint128(0),
            cooldownBlocks: uint32(20)
        });
    }

    // --- predict == created ---

    function test_predictMatchesCreated() public {
        address predicted = factory.predict(owner, SALT);
        assertFalse(factory.isAccount(predicted));
        address account = factory.createAccount(owner, SALT, _policy());
        assertEq(account, predicted, "created != predicted");
        assertTrue(factory.isAccount(account));
        assertEq(StubTroveAccount(account).owner(), owner);
        (uint64 f, uint64 s, uint64 t, uint128 b, uint128 m, uint32 c) =
            StubTroveAccount(account).policy();
        assertEq(f, uint64(2500000000000000000));
        assertEq(s, uint64(1600000000000000000));
        assertEq(t, uint64(2000000000000000000));
        assertEq(b, uint128(1000000000000000000));
        assertEq(m, uint128(0));
        assertEq(c, uint32(20));
    }

    function testFuzz_predictMatchesCreated(address fuzzOwner, bytes32 fuzzSalt) public {
        vm.assume(fuzzOwner != address(0));
        vm.assume(fuzzOwner != address(factory));
        address predicted = factory.predict(fuzzOwner, fuzzSalt);
        address account = factory.createAccount(fuzzOwner, fuzzSalt, _policy());
        assertEq(account, predicted);
        assertTrue(factory.isAccount(account));
    }

    function test_sameSaltDifferentOwnerGivesDifferentAccount() public {
        address a1 = factory.createAccount(owner, SALT, _policy());
        address other = makeAddr("other");
        address a2 = factory.createAccount(other, SALT, _policy());
        assertTrue(a1 != a2);
        assertTrue(factory.isAccount(a1));
        assertTrue(factory.isAccount(a2));
    }

    function test_sameOwnerDifferentSaltGivesDifferentAccount() public {
        address a1 = factory.createAccount(owner, SALT, _policy());
        address a2 = factory.createAccount(owner, bytes32(uint256(0xBEEF)), _policy());
        assertTrue(a1 != a2);
    }

    function test_createAccountEmitsAccountCreated() public {
        address predicted = factory.predict(owner, SALT);
        Policy memory p = _policy();
        vm.expectEmit(true, true, false, true, address(factory));
        emit TroveAccountFactory.AccountCreated(
            owner, predicted, SALT, p.floorICR, p.shieldICR, p.targetICR
        );
        factory.createAccount(owner, SALT, p);
    }

    // --- fee cap / fee recipient ---

    function test_constructorRevertsWhenFeeBpsAboveCap() public {
        vm.expectRevert(abi.encodeWithSelector(TroveAccountFactory.FeeBpsTooHigh.selector, uint16(51)));
        new TroveAccountFactory(address(implementation), feeRecipient, 51);
    }

    function test_constructorAcceptsFeeBpsAtCap() public {
        TroveAccountFactory f = new TroveAccountFactory(address(implementation), feeRecipient, 50);
        assertEq(f.feeBps(), 50);
        assertEq(f.MAX_FEE_BPS(), 50);
    }

    function test_constructorRevertsOnZeroFeeRecipient() public {
        vm.expectRevert(
            abi.encodeWithSelector(TroveAccountFactory.InvalidFeeRecipient.selector, address(0))
        );
        new TroveAccountFactory(address(implementation), address(0), 10);
    }

    function test_constructorRevertsOnBurnFeeRecipient() public {
        address burn = 0x000000000000000000000000000000000000dEaD;
        vm.expectRevert(abi.encodeWithSelector(TroveAccountFactory.InvalidFeeRecipient.selector, burn));
        new TroveAccountFactory(address(implementation), burn, 10);
    }

    function test_constructorRevertsOnImplementationWithoutCode() public {
        address noCode = makeAddr("noCode");
        vm.expectRevert(
            abi.encodeWithSelector(TroveAccountFactory.ImplementationHasNoCode.selector, noCode)
        );
        new TroveAccountFactory(noCode, feeRecipient, 10);
    }

    function test_constructorStoresImmutables() public view {
        assertEq(factory.implementation(), address(implementation));
        assertEq(factory.feeRecipient(), feeRecipient);
        assertEq(factory.feeBps(), 10);
    }

    // --- owner set once ---

    function test_secondCreateWithSameOwnerAndSaltReverts() public {
        address account = factory.createAccount(owner, SALT, _policy());
        vm.expectRevert(abi.encodeWithSelector(TroveAccountFactory.AlreadyCreated.selector, account));
        factory.createAccount(owner, SALT, _policy());
    }

    function test_reinitializeOnCloneReverts() public {
        address account = factory.createAccount(owner, SALT, _policy());
        vm.expectRevert(StubTroveAccount.AlreadyInitialized.selector);
        StubTroveAccount(account).initialize(owner, _policy());
    }

    function test_createAccountWithZeroOwnerReverts() public {
        vm.expectRevert(TroveAccountFactory.ZeroOwner.selector);
        factory.createAccount(address(0), SALT, _policy());
    }

    function test_openForDirectlyOnCloneRevertsForNonFactory() public {
        address account = factory.createAccount(owner, SALT, _policy());
        // The test contract is not the factory, so openFor must revert.
        vm.expectRevert(StubTroveAccount.NotFactory.selector);
        StubTroveAccount(account).openFor(DEBT, address(0), address(0), 0);
    }

    // --- createAndOpen ---

    function test_createAndOpenForwardsValueAndOpens() public {
        bytes32 salt = bytes32(uint256(0x0E9));
        address up = makeAddr("up");
        address lo = makeAddr("lo");
        uint256 minDebtAhead = 1000e18;
        address predicted = factory.predict(address(this), salt);
        address account = factory.createAndOpen{value: 0.01 ether}(salt, _policy(), DEBT, up, lo, minDebtAhead);
        assertEq(account, predicted);
        assertTrue(factory.isAccount(account));
        assertEq(StubTroveAccount(account).owner(), address(this));
        StubTroveAccount stub = StubTroveAccount(account);
        assertTrue(stub.opened());
        assertEq(stub.openDebt(), DEBT);
        assertEq(stub.openValue(), 0.01 ether);
        assertEq(stub.openUpHint(), up);
        assertEq(stub.openLoHint(), lo);
        assertEq(stub.openMinDebtAhead(), minDebtAhead);
    }
}
