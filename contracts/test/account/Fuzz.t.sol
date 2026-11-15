// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockMUSD, MockPriceFeed} from "../mocks/MockMezo.sol";
import {TroveAccount} from "../../src/account/TroveAccount.sol";
import {TroveAccountFactory} from "../../src/account/TroveAccountFactory.sol";
import {Batcher} from "../../src/account/Batcher.sol";
import {TroveAccountMainnet} from "../../src/account/TroveAccountMainnet.sol";
import {Policy} from "../../src/account/interfaces/ITroveAccount.sol";
import {TestTroveManager, TestBorrowerOperations, TestSavings, TestSortedTroves} from "./TroveAccount.t.sol";

/// @notice Task 1.7 fuzz + unit suite (plan section 10, row 1.7; invariants
///         section 3.12; threat-model rules section 7.2). Named fuzz tests
///         for the properties the invariant handler cannot isolate: fee
///         rounding (I10), preview/draw agreement, policy validation,
///         per-agent nonce isolation (I11), cross-account replay (S8),
///         signature malleability (S9), min-debt open/repay bounds (G1),
///         owner-always-exits (I5), zero-price draws (S17) and the Batcher
///         balance rule (S20).
/// @dev Harness mirrors TroveAccount.t.sol (same mocks, same main account:
///      owner = this test contract, 0.1 BTC collateral, 2000 MUSD debt,
///      price 100_000e18 -> ICR ~4.995e18, production policy floor 2.50 /
///      shield 1.60 / target 2.00, fee 10 bps).
contract TroveAccountFuzzTest is Test {
    MockMUSD public musd;
    MockPriceFeed public pf;
    TestTroveManager public tm;
    TestBorrowerOperations public bo;
    TestSavings public smusd;
    TestSortedTroves public sorted;
    TroveAccount public implementation;
    TroveAccountFactory public factory;
    TroveAccount public account;
    Batcher public batcher;
    address public feeRecipient = makeAddr("feeRecipient");
    address public owner = address(this);
    address public agent = makeAddr("agent");
    address public agent2 = makeAddr("agent2");
    address public payee = makeAddr("payee");
    address public attacker = makeAddr("attacker");

    bytes32 public constant SALT = bytes32(uint256(0xACC0));
    uint256 public constant COLL = 0.1 ether;
    uint256 public constant DEBT = 2000e18;
    uint256 public constant SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    receive() external payable {}

    function setUp() public {
        musd = new MockMUSD();
        pf = new MockPriceFeed();
        tm = new TestTroveManager();
        bo = new TestBorrowerOperations(musd, tm, pf);
        smusd = new TestSavings(musd);
        sorted = new TestSortedTroves();
        batcher = new Batcher();
        vm.deal(address(this), 100 ether);
        vm.deal(address(bo), 100 ether);
        musd.mint(address(smusd), 100_000e18);
        implementation = new TroveAccount(
            address(bo), address(tm), address(pf), address(musd), address(smusd), address(sorted), feeRecipient, 10
        );
        factory = new TroveAccountFactory(address(implementation), feeRecipient, 10);
        address a = factory.createAndOpen{value: COLL}(SALT, _policy(), DEBT, address(0), address(0), 0);
        account = TroveAccount(payable(a));
    }

    function _policy() internal pure returns (Policy memory) {
        return Policy({
            floorICR: uint64(2500000000000000000),
            shieldICR: uint64(1600000000000000000),
            targetICR: uint64(2000000000000000000),
            bounty: uint128(1000000000000000000),
            minDebtAhead: uint128(0),
            cooldownBlocks: uint32(20)
        });
    }

    function _setSession(address a, uint128 budget, uint128 perTx, uint128 daily, bool anyPayee, bool canSign)
        internal
    {
        account.setSession(a, budget, perTx, daily, uint64(block.timestamp + 7 days), anyPayee, canSign);
    }

    function _debtOf(address b) internal view returns (uint256) {
        (, uint256 principal, uint256 interest,,,) = tm.getEntireDebtAndColl(b);
        return principal + interest;
    }

    function _signIntent(uint256 pk, address a, address p, uint256 amount, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 d = account.intentDigest(a, p, amount, account.intentNonce(a), deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        return abi.encodePacked(r, s, v);
    }

    function _spent(address a) internal view returns (uint128) {
        (, uint128 spent,,,,,,,,,,) = account.sessions(a);
        return spent;
    }

    // ============ I10: fee is exactly ceil(amount * 10 / 10000) ============

    function testFuzz_feeIsCeil(uint256 amountRaw) public view {
        uint256 amount = bound(amountRaw, 1, 1e24);
        (,,, uint256 fee) = account.previewDraw(agent, payee, amount);
        assertEq(fee, (amount * 10 + 9999) / 10000, "I10: fee must be the ceiling");
        assertLe(fee, amount * 10 / 10000 + 1, "I10: fee never exceeds ceil by more than 1 wei");
    }

    // ============ previewDraw agrees with draw on every amount ============

    function testFuzz_previewMatchesDraw(uint256 amountRaw) public {
        uint256 amount = bound(amountRaw, 1, 2000e18);
        _setSession(agent, 10000e18, 5000e18, 0, true, false);
        (bool ok, uint8 reason,,) = account.previewDraw(agent, payee, amount);
        bool succeeded;
        vm.prank(agent);
        try account.draw(payee, amount) {
            succeeded = true;
        } catch {}
        assertEq(succeeded, ok, "preview/draw agreement");
        if (!ok) assertTrue(reason == 3 || reason == 4 || reason == 5 || reason == 6, "reason is a cap/floor code");
        if (ok) assertLe(_spent(agent), 10000e18, "I2: spent within budget after a preview-ok draw");
    }

    // ============ Policy validation: setPolicy succeeds iff the ordering holds ============

    function testFuzz_policyValidation(
        uint64 floorRaw,
        uint64 shieldRaw,
        uint64 targetRaw,
        uint128 bountyRaw
    ) public {
        uint256 floor = bound(floorRaw, 1e18, 5e18);
        uint256 shield = bound(shieldRaw, 1e18, 5e18);
        uint256 target = bound(targetRaw, 1e18, 12e18);
        uint256 bounty = bound(bountyRaw, 0, 10e18);
        Policy memory p = Policy({
            floorICR: uint64(floor),
            shieldICR: uint64(shield),
            targetICR: uint64(target),
            bounty: uint128(bounty),
            minDebtAhead: 0,
            cooldownBlocks: 20
        });
        bool valid = shield >= 1.15e18 && shield < target && target <= 10e18 && shield < floor
            && bounty <= 5e18;
        bool succeeded;
        try account.setPolicy(p) {
            succeeded = true;
        } catch {}
        assertEq(succeeded, valid, "setPolicy succeeds iff the policy ordering holds");
    }

    // ============ I11: nonces are per-agent and never interfere ============

    function testFuzz_nonceIsolation(uint256 amountRaw) public {
        uint256 amount = bound(amountRaw, 1, 100e18);
        uint256 pk1 = 0xC10C;
        uint256 pk2 = 0xC10D;
        address signer1 = vm.addr(pk1);
        address signer2 = vm.addr(pk2);
        _setSession(signer1, 1000e18, 500e18, 0, true, false);
        _setSession(signer2, 1000e18, 500e18, 0, true, false);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes memory sig1 = _signIntent(pk1, signer1, payee, amount, deadline);
        bytes memory sig2 = _signIntent(pk2, signer2, payee, amount, deadline);
        account.drawBySig(signer1, payee, amount, deadline, sig1);
        assertEq(account.intentNonce(signer1), 1, "I11: signer1 nonce is 1");
        assertEq(account.intentNonce(signer2), 0, "I11: signer2 nonce untouched");
        account.drawBySig(signer2, payee, amount, deadline, sig2);
        assertEq(account.intentNonce(signer1), 1, "I11: signer1 nonce still 1");
        assertEq(account.intentNonce(signer2), 1, "I11: signer2 nonce is 1");
        assertEq(musd.balanceOf(payee), 2 * amount, "both intents paid");
    }

    // ============ S8: an intent cannot replay on another account ============

    function testFuzz_replayAcrossAccounts(uint256 amountRaw) public {
        uint256 amount = bound(amountRaw, 1, 100e18);
        uint256 pk = 0xC10C;
        address signer = vm.addr(pk);
        _setSession(signer, 1000e18, 500e18, 0, true, false);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes memory sig = _signIntent(pk, signer, payee, amount, deadline);
        // Second account, same owner/session setup, different verifyingContract.
        // NOTE: a different salt is required: createAccount with the setUp
        // salt would predict the main account and revert AlreadyCreated.
        address b = factory.createAccount(owner, bytes32(uint256(0xACC1)), _policy());
        TroveAccount other = TroveAccount(payable(b));
        vm.expectRevert(TroveAccount.BadSig.selector);
        other.drawBySig(signer, payee, amount, deadline, sig);
        // The same intent works exactly once on its own account.
        account.drawBySig(signer, payee, amount, deadline, sig);
        assertEq(account.intentNonce(signer), 1, "I11: nonce consumed once");
        vm.expectRevert(TroveAccount.BadSig.selector);
        account.drawBySig(signer, payee, amount, deadline, sig);
    }

    // ============ S8: domain binds chainId and account ============

    function test_domainBindsChainAndAccount() public {
        address b = factory.createAccount(owner, bytes32(uint256(0xACC1)), _policy());
        TroveAccount other = TroveAccount(payable(b));
        bytes32 d1 = account.intentDigest(agent, payee, 10e18, 0, block.timestamp + 600);
        bytes32 d2 = other.intentDigest(agent, payee, 10e18, 0, block.timestamp + 600);
        assertTrue(d1 != d2, "S8: digest differs across accounts");
        bytes32 sep1 = account.domainSeparator();
        vm.chainId(31612);
        bytes32 sep2 = account.domainSeparator();
        assertTrue(sep1 != sep2, "S8: domain separator differs across chains");
        vm.chainId(31337);
    }

    // ============ S9: signature malleability is rejected ============

    function testFuzz_sigMalleabilityRejected(uint256 amountRaw) public {
        uint256 amount = bound(amountRaw, 1, 100e18);
        uint256 pk = 0xC10C;
        address signer = vm.addr(pk);
        _setSession(signer, 1000e18, 500e18, 0, true, false);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes32 d = account.intentDigest(signer, payee, amount, account.intentNonce(signer), deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        bytes memory sig = abi.encodePacked(r, s, v);
        // High-s with flipped v recovers the same signer but must be rejected.
        bytes32 sHigh = bytes32(SECP256K1_N - uint256(s));
        uint8 vHigh = v == 27 ? 28 : 27;
        vm.expectRevert(TroveAccount.BadSig.selector);
        account.drawBySig(signer, payee, amount, deadline, abi.encodePacked(r, sHigh, vHigh));
        // Bad v.
        vm.expectRevert(TroveAccount.BadSig.selector);
        account.drawBySig(signer, payee, amount, deadline, abi.encodePacked(r, s, uint8(29)));
        // Short signature (length checked before slicing).
        vm.expectRevert(TroveAccount.BadSig.selector);
        account.drawBySig(signer, payee, amount, deadline, abi.encodePacked(r, s));
        // Zero signature: ecrecover returns address(0).
        vm.expectRevert(TroveAccount.BadSig.selector);
        account.drawBySig(signer, payee, amount, deadline, new bytes(65));
        // The original low-s intent still works exactly once.
        account.drawBySig(signer, payee, amount, deadline, sig);
        assertEq(account.intentNonce(signer), 1, "I11: nonce consumed by the good intent only");
        // EIP-1271 path rejects high-s too.
        bytes32 h = keccak256("x402 payload");
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(pk, h);
        _setSession(signer, 1000e18, 500e18, 0, true, true);
        assertEq(account.isValidSignature(h, abi.encodePacked(r2, s2, v2)), bytes4(0x1626ba7e));
        bytes32 s2High = bytes32(SECP256K1_N - uint256(s2));
        assertEq(
            account.isValidSignature(h, abi.encodePacked(r2, s2High, v2 == 27 ? 28 : 27)),
            bytes4(0xffffffff),
            "S9: high-s invalid for EIP-1271"
        );
    }

    // ============ G1: open below the 1800 MUSD min net debt reverts ============

    function testFuzz_openBelowMinDebt(uint256 debtRaw) public {
        uint256 debt = bound(debtRaw, 1, 5000e18);
        bool succeeded;
        try factory.createAndOpen{value: COLL}(bytes32(uint256(0x0A11)), _policy(), debt, address(0), address(0), 0) returns (
            address
        ) {
            succeeded = true;
        } catch {}
        assertEq(succeeded, debt >= 1800e18, "G1: open succeeds iff debt >= minNetDebt");
    }

    // ============ G1: repay is bounded so debt never drops below 1800 ============

    function testFuzz_repayBounded(uint256 amountRaw) public {
        uint256 amount = bound(amountRaw, 1, 3000e18);
        uint256 debtBefore = _debtOf(address(account));
        uint256 balBefore = musd.balanceOf(address(account));
        bool expectOk = amount <= balBefore && amount <= debtBefore - 1800e18;
        bool succeeded;
        try account.repay(amount, address(0), address(0)) {
            succeeded = true;
        } catch {}
        assertEq(succeeded, expectOk, "G1: repay succeeds iff balance allows and debt stays >= 1800");
        assertGe(_debtOf(address(account)), 1800e18, "G1: debt never below min net debt");
    }

    // ============ I5: the owner can always exit ============

    function testFuzz_closeAlwaysExits(uint256 amountRaw) public {
        uint256 amount = bound(amountRaw, 1, 100e18);
        _setSession(agent, 1000e18, 500e18, 0, true, false);
        vm.prank(agent);
        account.draw(payee, amount);
        uint256 debt = _debtOf(address(account));
        uint256 need = debt > 200e18 ? debt - 200e18 : 0;
        uint256 bal = musd.balanceOf(address(account));
        if (bal < need) musd.mint(address(account), need - bal);
        uint256 ownerEthBefore = address(this).balance;
        account.closeAccount();
        assertEq(account.status(), 2, "I5: closed by owner");
        assertEq(address(account).balance, 0, "I5: no BTC left in the account");
        assertEq(musd.balanceOf(address(account)), 0, "I5: no MUSD left in the account");
        assertEq(address(this).balance, ownerEthBefore + COLL, "I5: collateral returned to the owner");
        // Sessions are dead after close (I3/I8: closeAccount revokes all
        // sessions first, so the draw fails the session check before the
        // status check — SessionInactive, not TroveNotActive).
        vm.prank(agent);
        vm.expectRevert(TroveAccount.SessionInactive.selector);
        account.draw(payee, 1e18);
    }

    // ============ S17: a zero price reverts draws instead of mispricing ============

    function testFuzz_priceZeroDrawReverts(uint256 amountRaw) public {
        uint256 amount = bound(amountRaw, 1, 100e18);
        _setSession(agent, 1000e18, 500e18, 0, true, false);
        pf.set(0);
        (bool ok, uint8 reason,,) = account.previewDraw(agent, payee, amount);
        assertFalse(ok, "S17: preview fails at zero price");
        assertEq(reason, 7, "S17: reason is RECOVERY_MODE (TCR 0 at price 0)");
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TroveAccount.RecoveryMode.selector, uint256(0)));
        account.draw(payee, amount);
    }

    // ============ S20: the Batcher holds no funds after a two-agent batch ============

    function test_batcherHoldsNoFunds() public {
        uint256 pk1 = 0xC10C;
        uint256 pk2 = 0xC10D;
        address signer1 = vm.addr(pk1);
        address signer2 = vm.addr(pk2);
        _setSession(signer1, 1000e18, 500e18, 0, true, false);
        _setSession(signer2, 1000e18, 500e18, 0, true, false);
        uint256 deadline = block.timestamp + 10 minutes;
        address[] memory accts = new address[](2);
        accts[0] = address(account);
        accts[1] = address(account);
        Batcher.DrawIntent[] memory intents = new Batcher.DrawIntent[](2);
        intents[0] = Batcher.DrawIntent({
            agent: signer1,
            payee: payee,
            amount: 50e18,
            deadline: deadline,
            sig: _signIntent(pk1, signer1, payee, 50e18, deadline)
        });
        intents[1] = Batcher.DrawIntent({
            agent: signer2,
            payee: payee,
            amount: 40e18,
            deadline: deadline,
            sig: _signIntent(pk2, signer2, payee, 40e18, deadline)
        });
        batcher.multiDraw(accts, intents);
        assertEq(musd.balanceOf(payee), 90e18, "S20: both draws paid the payee");
        assertEq(musd.balanceOf(address(batcher)), 0, "S20: Batcher holds no MUSD");
        assertEq(address(batcher).balance, 0, "S20: Batcher holds no BTC");
        assertEq(account.intentNonce(signer1), 1, "I11: batch consumed signer1 nonce");
        assertEq(account.intentNonce(signer2), 1, "I11: batch consumed signer2 nonce");
    }

    // ============ I2: daily window rolls after 24h ============

    function testFuzz_dailyRollover(uint256 amountRaw) public {
        uint256 amount = bound(amountRaw, 1, 400e18);
        _setSession(agent, 10000e18, 5000e18, 500e18, true, false);
        vm.prank(agent);
        account.draw(payee, amount);
        vm.warp(block.timestamp + 25 hours);
        vm.prank(agent);
        account.draw(payee, amount); // daySpent reset; must not revert
        assertEq(_spent(agent), 2 * (amount + (amount * 10 + 9999) / 10000), "I2: spent accumulates across days");
    }

    // ============ 1.10: mainnet variant caps the per-session budget ============

    function test_mainnetSessionCap() public {
        TroveAccountMainnet mainnetImpl = new TroveAccountMainnet(
            address(bo), address(tm), address(pf), address(musd), address(smusd), address(sorted), feeRecipient, 10, 20e18
        );
        TroveAccountFactory mainnetFactory = new TroveAccountFactory(address(mainnetImpl), feeRecipient, 10);
        address a = mainnetFactory.createAccount(owner, bytes32(uint256(0xCA9)), _policy());
        TroveAccountMainnet acct = TroveAccountMainnet(payable(a));
        assertEq(acct.MAX_SESSION_BUDGET(), 20e18, "1.10: cap is 20 MUSD");
        // Exactly at the cap: allowed.
        acct.setSession(agent, 20e18, 10e18, 0, uint64(block.timestamp + 7 days), true, false);
        // One wei above the cap: reverts.
        vm.expectRevert(
            abi.encodeWithSelector(
                TroveAccountMainnet.SessionBudgetAboveCap.selector, uint128(20e18 + 1), uint256(20e18)
            )
        );
        acct.setSession(agent, uint128(20e18 + 1), 10e18, 0, uint64(block.timestamp + 7 days), true, false);
        // The cap is immutable: a re-issue at the cap still works after the revert.
        acct.setSession(agent, 20e18, 10e18, 0, uint64(block.timestamp + 7 days), true, false);
    }

    // ============ Session expiry is bounded: now < expiry <= now + 90 days ============

    function testFuzz_sessionExpiryBound(uint64 expiryRaw) public {
        uint256 expiry = bound(expiryRaw, block.timestamp, block.timestamp + 120 days);
        bool expectOk = expiry > block.timestamp && expiry <= block.timestamp + 90 days;
        bool succeeded;
        try account.setSession(agent, 1000e18, 500e18, 0, uint64(expiry), true, false) {
            succeeded = true;
        } catch {}
        assertEq(succeeded, expectOk, "expiry must be in the future and at most 90 days out");
    }
}
