// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Radar} from "../../src/account/Radar.sol";

// ---------------------------------------------------------------------------
// Mocks (local to this file: task 1.7 owns the rest of contracts/test/account/*
// and the shared mocks directory; nothing here is shared).
// ---------------------------------------------------------------------------

contract MockPriceFeed {
    uint256 public price;
    function setPrice(uint256 p) external { price = p; }
    function fetchPrice() external view returns (uint256) { return price; }
}

contract MockSortedTroves {
    // order[0] = head (highest NICR), order[last] = frontier (lowest NICR).
    address[] public order;
    function setOrder(address[] memory o) external { order = o; }
    function getLast() external view returns (address) {
        return order.length == 0 ? address(0) : order[order.length - 1];
    }
    function getPrev(address trove) external view returns (address) {
        for (uint256 i; i < order.length; i++) {
            if (order[i] == trove) return i == 0 ? address(0) : order[i - 1];
        }
        return address(0);
    }
    function getSize() external view returns (uint256) { return order.length; }
}

contract MockTroveManager {
    mapping(address => uint256) public coll;
    mapping(address => uint256) public principal;
    mapping(address => uint256) public interest;
    mapping(address => uint256) public icr;
    uint256 public tcr;
    bool public recoveryMode;

    function setTrove(address t, uint256 c, uint256 p, uint256 i, uint256 icr_) external {
        coll[t] = c; principal[t] = p; interest[t] = i; icr[t] = icr_;
    }
    function setTCR(uint256 t, bool rm) external { tcr = t; recoveryMode = rm; }
    function getCurrentICR(address borrower, uint256) external view returns (uint256) {
        return icr[borrower];
    }
    function getEntireDebtAndColl(address borrower)
        external
        view
        returns (uint256, uint256, uint256, uint256, uint256, uint256)
    {
        return (coll[borrower], principal[borrower], interest[borrower], 0, 0, 0);
    }
    function getTCR(uint256) external view returns (uint256) { return tcr; }
    function checkRecoveryMode(uint256) external view returns (bool) { return recoveryMode; }
}

// ---------------------------------------------------------------------------
// Unit tests (no RPC).
// ---------------------------------------------------------------------------

contract RadarUnitTest is Test {
    MockPriceFeed pf;
    MockSortedTroves st;
    MockTroveManager tm;
    Radar radar;

    // Five mock troves, head-first order (NICR descending). t4 is
    // non-redeemable (ICR 105% < 110% MCR).
    address t1 = address(0x1001);
    address t2 = address(0x1002);
    address t3 = address(0x1003);
    address t4 = address(0x1004);
    address t5 = address(0x1005);

    function setUp() public {
        pf = new MockPriceFeed();
        st = new MockSortedTroves();
        tm = new MockTroveManager();
        radar = new Radar(address(st), address(tm), address(pf));
        pf.setPrice(64_000e18);
        tm.setTCR(231.48e16, false);
        address[] memory o = new address[](5);
        // Head-first (NICR descending): t1 1.1348e-3, t2 2.854e-5,
        // t4 1.9990e-5, t3 1.9989e-5, t5 1.7491e-5 (frontier).
        o[0] = t1; o[1] = t2; o[2] = t4; o[3] = t3; o[4] = t5;
        st.setOrder(o);
        // (coll, principal, interest, icr). NICR = coll/debt: t1 highest, t5 lowest.
        tm.setTrove(t1, 16.0e18, 14_000e18, 100e18, 7361.20e16);
        tm.setTrove(t2, 0.28e18, 9_800e18, 10.65e18, 185.16e16);
        tm.setTrove(t3, 0.04e18, 2_000e18, 1.15e18, 141.13e16);
        tm.setTrove(t4, 0.04e18, 2_000e18, 1.00e18, 105.00e16); // NOT redeemable
        tm.setTrove(t5, 0.035e18, 2_000e18, 1.00e18, 114.04e16); // frontier
    }

    function test_constructor_revertsOnZeroAddress() public {
        vm.expectRevert(Radar.ZeroAddress.selector);
        new Radar(address(0), address(tm), address(pf));
        vm.expectRevert(Radar.ZeroAddress.selector);
        new Radar(address(st), address(0), address(pf));
        vm.expectRevert(Radar.ZeroAddress.selector);
        new Radar(address(st), address(tm), address(0));
    }

    function test_systemHealth() public {
        (uint256 price, uint256 tcr, bool rm, uint256 n) = radar.systemHealth();
        assertEq(price, 64_000e18);
        assertEq(tcr, 231.48e16);
        assertFalse(rm);
        assertEq(n, 5);
    }

    function test_frontier() public {
        (address trove, uint256 icr, uint256 debt) = radar.frontier();
        assertEq(trove, t5);
        assertEq(icr, 114.04e16);
        assertEq(debt, 2_001e18); // principal + interest
    }

    function test_frontier_empty() public {
        st.setOrder(new address[](0));
        (address trove, uint256 icr, uint256 debt) = radar.frontier();
        assertEq(trove, address(0));
        assertEq(icr, 0);
        assertEq(debt, 0);
    }

    function test_rank_frontier() public {
        (uint256 r, uint256 ahead, uint256 steps, bool done) = radar.rank(t5, 10);
        assertEq(r, 1);
        assertEq(ahead, 0);
        assertEq(steps, 1);
        assertTrue(done);
    }

    function test_rank_head() public {
        // Walk order from frontier: t5, t3, t4 (skipped), t2, t1.
        // Redeemable ahead of t1: t5 + t3 + t2 = 2001 + 2001.15 + 9810.65.
        (uint256 r, uint256 ahead, uint256 steps, bool done) = radar.rank(t1, 10);
        assertEq(r, 4); // 4 redeemable troves total (t4 excluded)
        assertEq(ahead, 13_812.80e18);
        assertEq(steps, 5);
        assertTrue(done);
    }

    function test_rank_middle_redeemable() public {
        // t3: ahead = t5 only (t4 sits behind t3 in the walk, non-redeemable).
        (uint256 r, uint256 ahead, uint256 steps, bool done) = radar.rank(t3, 10);
        assertEq(r, 2);
        assertEq(ahead, 2_001e18);
        assertEq(steps, 2);
        assertTrue(done);
    }

    function test_rank_nonRedeemableTarget() public {
        // t4 is found but ICR < MCR: rank 0, complete, debtAhead = redeemable
        // debt ahead of it (t5 + t3).
        (uint256 r, uint256 ahead, uint256 steps, bool done) = radar.rank(t4, 10);
        assertEq(r, 0);
        assertEq(ahead, 4_002.15e18);
        assertEq(steps, 3);
        assertTrue(done);
    }

    function test_rank_incomplete_maxSteps() public {
        (uint256 r, uint256 ahead, uint256 steps, bool done) = radar.rank(t1, 2);
        assertEq(r, 0);
        assertEq(ahead, 4_002.15e18); // t5 + t3 visited and counted
        assertEq(steps, 2);
        assertFalse(done);
    }

    function test_rank_notFound() public {
        (uint256 r, uint256 ahead, uint256 steps, bool done) = radar.rank(address(0x9999), 10);
        assertEq(r, 0);
        // All redeemable debt in the list (t4 excluded): t5+t3+t2+t1.
        assertEq(ahead, 27_912.80e18);
        assertEq(steps, 5);
        assertFalse(done);
    }

    function test_rank_zeroStepsOrZeroTrove() public {
        (uint256 r1,,, bool d1) = radar.rank(t1, 0);
        assertEq(r1, 0);
        assertFalse(d1);
        (uint256 r2,,, bool d2) = radar.rank(address(0), 10);
        assertEq(r2, 0);
        assertFalse(d2);
    }

    function test_debtAheadForNICR_belowFrontier() public {
        // NICR below the frontier's (0.035/2001 = 1.7491e-5): nothing ahead.
        (uint256 ahead, bool done) = radar.debtAheadForNICR(1.0e13, 10);
        assertEq(ahead, 0);
        assertTrue(done);
    }

    function test_debtAheadForNICR_between() public {
        // NICRs: t5 1.7491e-5, t3 1.9989e-5, t4 1.9990e-5, t2 2.854e-5,
        // t1 1.1348e-3. A NICR of 2.0e-5 sits above t5/t3/t4 and below t2:
        // ahead = t5 + t3 (t4 non-redeemable contributes 0).
        (uint256 ahead, bool done) = radar.debtAheadForNICR(2.0e13, 10);
        assertEq(ahead, 2_001e18 + 2_001.15e18);
        assertTrue(done);
    }

    function test_debtAheadForNICR_aboveHead() public {
        // Above every NICR: all redeemable debt is ahead (t5+t3+t2+t1).
        (uint256 ahead, bool done) = radar.debtAheadForNICR(type(uint256).max, 10);
        assertEq(ahead, 27_912.80e18);
        assertTrue(done);
    }

    function test_debtAheadForNICR_incomplete() public {
        (uint256 ahead, bool done) = radar.debtAheadForNICR(type(uint256).max, 2);
        assertEq(ahead, 4_002.15e18); // t5 + t3 visited (t4 skipped as non-redeemable)
        assertFalse(done);
    }

    function test_debtAheadForNICR_zeroSteps() public {
        (uint256 ahead, bool done) = radar.debtAheadForNICR(2.0e13, 0);
        assertEq(ahead, 0);
        assertFalse(done);
    }

    /// @notice Lab mainnet 4-trove output (lab/evidence/frontier_mainnet_r2.txt)
    /// replayed through mocks: rank #3 has 4,002.15 MUSD ahead; a 250% ICR
    /// trove would sit 4th of 5 with 13,812.80 MUSD ahead (plan §3.8).
    function test_labMainnetFourTrove_mock() public {
        pf.setPrice(64_330.11e18);
        address m1 = address(0xA7F5);
        address m2 = address(0x467F);
        address m3 = address(0x0827);
        address m4 = address(0x593C);
        address[] memory o = new address[](4);
        // Head-first (NICR descending): m4 1.1444e-3, m3 2.8783e-5,
        // m2 2.1936e-5, m1 1.7726e-5 (frontier).
        o[0] = m4; o[1] = m3; o[2] = m2; o[3] = m1;
        st.setOrder(o);
        tm.setTrove(m1, 0.03547e18, 2_001e18, 0, 114.04e16);
        tm.setTrove(m2, 0.04390e18, 2_001.15e18, 0, 141.13e16);
        tm.setTrove(m3, 0.28237e18, 9_810.65e18, 0, 185.16e16);
        tm.setTrove(m4, 16.58921e18, 14_497.44e18, 0, 7361.20e16);
        tm.setTCR(3851.81e16, false);

        (uint256 r3, uint256 ahead3, uint256 s3, bool d3) = radar.rank(m3, 10);
        assertEq(r3, 3);
        assertEq(ahead3, 4_002.15e18);
        assertEq(s3, 3);
        assertTrue(d3);

        (uint256 r1, uint256 ahead1,, bool d1) = radar.rank(m1, 10);
        assertEq(r1, 1);
        assertEq(ahead1, 0);
        assertTrue(d1);

        // 250% ICR trove: NICR = 2.5 / 64330.11 = 3.8861e-5, between m3 and m4.
        // (uint256 cast forces integer division: the raw rational 2.5e36 / 6.433011e22
        // is not an exact integer, so solc rejects the literal-only expression.)
        uint256 nicr250 = (uint256(250e16) * 1e18) / 64_330_11e16;
        (uint256 ahead250, bool done250) = radar.debtAheadForNICR(nicr250, 10);
        assertEq(ahead250, 13_812.80e18);
        assertTrue(done250);
    }
}

// ---------------------------------------------------------------------------
// Fork tests (read-only, no broadcasts). Gated on RADAR_FORK=1 so unit runs
// stay offline. PriceFeed is mocked to the verified-at-block price because
// the Mezo oracle precompile is unreadable on forks (plan G3; same pattern
// as contracts/test/fork/Fork.t.sol).
// ---------------------------------------------------------------------------

contract RadarForkTest is Test {
    // Plan §2.2 addresses.
    address constant ST_TEST = 0x722E4D24FD6Ff8b0AC679450F3D91294607268fA;
    address constant TM_TEST = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address constant PF_TEST = 0x86bCF0841622a5dAC14A313a15f96A95421b9366;
    address constant ST_MAIN = 0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f;
    address constant TM_MAIN = 0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193;
    address constant PF_MAIN = 0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88;

    // Lab radar run, testnet: block 16791591 is the block whose live price
    // ($64,451.3573) matches lab/evidence/radar_testnet.txt ($64,451.36).
    uint256 constant TESTNET_BLOCK = 16_791_591;
    uint256 constant TESTNET_PRICE = 64_451_357_300_000_000_000_000;
    // Mainnet: block 13,239,397 (LAB_REPORT §H9 / plan §3.8).
    uint256 constant MAINNET_BLOCK = 13_239_397;
    uint256 constant MAINNET_PRICE = 64_472_300_000_000_000_000_000;

    address constant V2 = 0x5A1166eC096e12C0C6187695F82B7F4b285389Df;
    address constant V1 = 0xABeb9514f5e4c0E116b679d03aabFdc6fd523F6E;
    address constant WAVE1 = 0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3;
    address constant WHALE = 0x5eaA8bdc315608E8Cf873CFAbA05e42826f68C4d;

    function _forkGate() internal {
        if (!vm.envOr("RADAR_FORK", false)) vm.skip(true);
    }

    /// @notice Testnet fork: reproduces lab/evidence/radar_testnet.txt —
    /// V2 rank 180/271, V1 rank 201, Wave-1 wallet rank 234.
    /// Debt tolerances are ±200 MUSD: the lab walk read live state over ~7
    /// minutes, so per-trove interest drifted between rows; rank is exact.
    function testForkTestnet_labRanks() public {
        _forkGate();
        vm.createSelectFork("mezo_testnet", TESTNET_BLOCK);
        vm.mockCall(PF_TEST, abi.encodeWithSignature("fetchPrice()"), abi.encode(TESTNET_PRICE));
        Radar radar = new Radar(ST_TEST, TM_TEST, PF_TEST);

        (uint256 price, uint256 tcr, bool rm, uint256 n) = radar.systemHealth();
        assertEq(price, TESTNET_PRICE);
        assertApproxEqAbs(tcr, 231.48e16, 0.01e16, "TCR 231.48%");
        assertFalse(rm);
        assertEq(n, 271, "271 troves");

        (address fTro, uint256 fIcr, uint256 fDebt) = radar.frontier();
        assertEq(fTro, WHALE, "frontier is the whale");
        assertApproxEqAbs(fIcr, 125.84e16, 0.01e16, "frontier ICR 125.84%");
        assertApproxEqAbs(fDebt, 426_001_487.08e18, 200e18, "frontier debt");

        (uint256 r2, uint256 a2, uint256 s2, bool d2) = radar.rank(V2, 300);
        assertEq(r2, 180, "V2 rank 180");
        assertApproxEqAbs(a2, 426_402_783.55e18, 200e18, "V2 debt ahead");
        assertEq(s2, 180);
        assertTrue(d2);

        (uint256 r1, uint256 a1,, bool d1) = radar.rank(V1, 300);
        assertEq(r1, 201, "V1 rank 201");
        assertApproxEqAbs(a1, 426_456_771.20e18, 200e18, "V1 debt ahead");
        assertTrue(d1);

        (uint256 rw, uint256 aw,, bool dw) = radar.rank(WAVE1, 300);
        assertEq(rw, 234, "Wave-1 wallet rank 234");
        assertApproxEqAbs(aw, 426_560_202.22e18, 200e18, "Wave-1 debt ahead");
        assertTrue(dw);

        // A 250% ICR trove at this price: NICR = 2.5/64451.36. First trove
        // with ICR >= 250% is row #245 (256.26%; row #244 is 249.65%, so
        // it counts as ahead); debt ahead = rows #1..#244
        // = cum #244 426,583,941.26 MUSD.
        uint256 nicr250 = (250e16 * 1e18) / TESTNET_PRICE;
        (uint256 ahead250, bool done250) = radar.debtAheadForNICR(nicr250, 300);
        assertApproxEqAbs(ahead250, 426_583_941.26e18, 200e18, "250% debt ahead");
        assertTrue(done250);
    }

    /// @notice Mainnet fork: reproduces the 4-trove output (LAB_REPORT §H9 /
    /// plan §3.8, block 13,239,397): TCR ~3,860%, 4 troves, frontier 114.3%.
    /// NOTE: lab/evidence/frontier_mainnet_r2.txt prints slightly different
    /// values (price $64,330.11, TCR 3,851.81%) — its block was not recorded,
    /// so this test pins the documented block 13,239,397 and asserts the
    /// LAB_REPORT's rounded figures for it (verified live with cast).
    function testForkMainnet_fourTroves() public {
        _forkGate();
        vm.createSelectFork("mezo_mainnet", MAINNET_BLOCK);
        vm.mockCall(PF_MAIN, abi.encodeWithSignature("fetchPrice()"), abi.encode(MAINNET_PRICE));
        Radar radar = new Radar(ST_MAIN, TM_MAIN, PF_MAIN);

        (uint256 price, uint256 tcr, bool rm, uint256 n) = radar.systemHealth();
        assertEq(price, MAINNET_PRICE);
        assertApproxEqAbs(tcr, 3859.8e16, 1e16, "TCR ~3859.8%");
        assertFalse(rm);
        assertEq(n, 4, "4 troves");

        (address fTro, uint256 fIcr, uint256 fDebt) = radar.frontier();
        assertEq(fTro, 0xA7F5Dc5955a599524A28DFf21389D88c49DBf738, "frontier #1");
        assertApproxEqAbs(fIcr, 114.3e16, 0.1e16, "frontier ICR 114.3%");
        assertApproxEqAbs(fDebt, 2_001e18, 5e18, "frontier debt 2001 MUSD");

        address m2 = 0x467FFa9B2b3300a14D44f0A2707E28014C673Fb4;
        address m3 = 0x08278D4b1c5F7D652095a2050f1d978AEc5377ac;
        address m4 = 0x593c427d8C7bf5C555Ed41cd7CB7cCe8C9F15bB5;
        (uint256 r2, uint256 a2,, bool d2) = radar.rank(m2, 10);
        assertEq(r2, 2);
        assertApproxEqAbs(a2, 2_001e18, 5e18, "debt ahead of #2");
        assertTrue(d2);
        (uint256 r3, uint256 a3,, bool d3) = radar.rank(m3, 10);
        assertEq(r3, 3);
        assertApproxEqAbs(a3, 4_002.15e18, 5e18, "debt ahead of #3");
        assertTrue(d3);
        (uint256 r4, uint256 a4,, bool d4) = radar.rank(m4, 10);
        assertEq(r4, 4);
        assertApproxEqAbs(a4, 13_812.81e18, 5e18, "debt ahead of #4");
        assertTrue(d4);

        // 250% ICR trove ranks 4th of 5 with 13,813 MUSD ahead (runbook §0).
        uint256 nicr250 = (250e16 * 1e18) / MAINNET_PRICE;
        (uint256 ahead250, bool done250) = radar.debtAheadForNICR(nicr250, 10);
        assertApproxEqAbs(ahead250, 13_812.81e18, 5e18, "250% debt ahead");
        assertTrue(done250);
    }
}
