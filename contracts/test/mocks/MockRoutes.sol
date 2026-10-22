// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MockMUSD} from "./MockMezo.sol";

/// @dev sMUSD stand-in: 1:1, transferable share token, yield claimed separately (like MUSDSavingsRate).
contract MockSavingsRate {
    MockMUSD public musd;
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public claimableYield;
    constructor(MockMUSD m) { musd = m; }
    function deposit(uint256 a) external { musd.transferFrom(msg.sender, address(this), a); balanceOf[msg.sender] += a; }
    function withdraw(uint256 a) external { balanceOf[msg.sender] -= a; musd.transfer(msg.sender, a); }
    function claimYield() external { uint256 y = claimableYield[msg.sender]; claimableYield[msg.sender] = 0; musd.mint(msg.sender, y); }
    function accrue(address a, uint256 y) external { claimableYield[a] += y; }
    function transfer(address to, uint256 a) external returns (bool) { balanceOf[msg.sender] -= a; balanceOf[to] += a; return true; }
}

/// @dev Mezo BTC: the ERC-20 view of the native balance.
contract MockBTC {
    function balanceOf(address a) external view returns (uint256) { return a.balance; }
    function transfer(address, uint256) external pure returns (bool) { return true; }
    function approve(address, uint256) external pure returns (bool) { return true; }
    function transferFrom(address, address, uint256) external pure returns (bool) { return true; }
}

/// @dev Velodrome-style router: MUSD in, native BTC out at `price` MUSD per BTC (18 decimals), minus 0.3%.
contract MockDex {
    struct Route { address from; address to; bool stable; address factory; }
    MockMUSD public musd;
    uint256 public price = 80_000e18;
    uint256 public skimBps; // simulate a worse fill than quoted (sandwich)
    address public reenterTarget; bytes public reenterData;
    constructor(MockMUSD m) { musd = m; }
    receive() external payable {}
    function setPrice(uint256 p) external { price = p; }
    function setSkim(uint256 b) external { skimBps = b; }
    function setReenter(address t, bytes calldata d) external { reenterTarget = t; reenterData = d; }
    function _out(uint256 i) internal view returns (uint256) { return i * 1e18 / price * 997 / 1000; }
    function getAmountsOut(uint256 i, Route[] calldata) external view returns (uint256[] memory a) {
        a = new uint256[](2); a[0] = i; a[1] = _out(i);
    }
    function swapExactTokensForTokens(uint256 i, uint256 minOut, Route[] calldata, address to, uint256 dl)
        external returns (uint256[] memory a)
    {
        require(block.timestamp <= dl, "expired");
        musd.transferFrom(msg.sender, address(this), i);
        if (reenterTarget != address(0)) {
            (bool okR, bytes memory r) = reenterTarget.call(reenterData);
            if (!okR) assembly { revert(add(r, 32), mload(r)) }
        }
        uint256 o = _out(i) * (10_000 - skimBps) / 10_000;
        require(o >= minOut, "INSUFFICIENT_OUTPUT_AMOUNT");
        (bool ok,) = to.call{value: o}(""); require(ok, "send");
        a = new uint256[](2); a[0] = i; a[1] = o;
    }
}
