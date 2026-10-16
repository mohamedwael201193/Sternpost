// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Faithful-enough stand-ins for the Mezo MUSD stack, used by unit, fuzz and invariant tests.
///      Signature digests match BorrowerOperationsSignatures (domain "BorrowerOperationsSignatures", "1").

contract MockMUSD {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function mint(address to, uint256 a) external { balanceOf[to] += a; totalSupply += a; }
    function burn(address from, uint256 a) external { balanceOf[from] -= a; totalSupply -= a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external returns (bool) { balanceOf[msg.sender] -= a; balanceOf[to] += a; return true; }
    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        if (msg.sender != f) allowance[f][msg.sender] -= a;
        balanceOf[f] -= a; balanceOf[to] += a; return true;
    }
}

contract MockPriceFeed {
    uint256 public price = 100_000e18;
    function set(uint256 p) external { price = p; }
    function fetchPrice() external view returns (uint256) { return price; }
}

contract MockTroveManager {
    MockPriceFeed public pf;
    mapping(address => uint256) public coll;
    mapping(address => uint256) public debt;
    constructor(MockPriceFeed p) { pf = p; }
    function setTrove(address b, uint256 c, uint256 d) external { coll[b] = c; debt[b] = d; }
    function addDebt(address b, uint256 d) external { debt[b] += d; }
    function subDebt(address b, uint256 d) external { debt[b] -= d; }
    function addColl(address b, uint256 c) external { coll[b] += c; }
    function getCurrentICR(address b, uint256 price) external view returns (uint256) {
        return debt[b] == 0 ? type(uint256).max : coll[b] * price / debt[b];
    }
    function getEntireDebtAndColl(address b) external view returns (uint256, uint256, uint256, uint256, uint256, uint256) {
        return (coll[b], debt[b], 0, 0, 0, 0);
    }
}

contract MockActivePool {
    bool public callbackEnabled = true;
    function setCallback(bool on) external { callbackEnabled = on; }
    function sendCollateral(address to, uint256 amt) external {
        if (amt == 0 && !callbackEnabled) return;
        (bool ok, bytes memory r) = to.call{value: amt}("");
        if (!ok) assembly { revert(add(r, 32), mload(r)) }
    }
    receive() external payable {}
}

contract MockBorrowerOperations {
    uint256 public rate = 1e15; // 0.1%
    function getBorrowingFee(uint256 d) external view returns (uint256) { return d * rate / 1e18; }
}

contract MockSignatures {
    MockMUSD public musd; MockTroveManager public tm; MockActivePool public ap; MockBorrowerOperations public bo;
    mapping(address => uint256) public nonces;
    bytes32 public immutable DOMAIN;
    bytes32 constant W = keccak256("WithdrawMUSD(uint256 amount,address borrower,address recipient,uint256 nonce,uint256 deadline)");
    bytes32 constant R = keccak256("RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline)");
    bytes32 constant A = keccak256("AddColl(uint256 assetAmount,address borrower,uint256 nonce,uint256 deadline)");

    constructor(MockMUSD m, MockTroveManager t, MockActivePool a, MockBorrowerOperations b) {
        musd = m; tm = t; ap = a; bo = b;
        DOMAIN = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("BorrowerOperationsSignatures"), keccak256("1"), block.chainid, address(this)));
    }
    function getNonce(address b) external view returns (uint256) { return nonces[b]; }
    function _check(bytes32 structHash, address b, bytes calldata sig, uint256 dl) internal {
        require(block.timestamp <= dl, "expired");
        bytes32 d = keccak256(abi.encodePacked("\x19\x01", DOMAIN, structHash));
        (bytes32 r, bytes32 s, uint8 v) = (bytes32(sig[0:32]), bytes32(sig[32:64]), uint8(sig[64]));
        require(ecrecover(d, v, r, s) == b, "bad sig");
        nonces[b]++;
    }
    function withdrawMUSDWithSignature(uint256 amt, address, address, address b, address rc, bytes calldata sig, uint256 dl) external {
        _check(keccak256(abi.encode(W, amt, b, rc, nonces[b], dl)), b, sig, dl);
        uint256 fee = bo.getBorrowingFee(amt);
        tm.addDebt(b, amt + fee);
        require(tm.getCurrentICR(b, tm.pf().fetchPrice()) >= 1.1e18, "ICR<MCR");
        musd.mint(rc, amt);
        ap.sendCollateral(rc, 0);
    }
    function repayMUSDWithSignature(uint256 amt, address, address, address b, bytes calldata sig, uint256 dl) external {
        _check(keccak256(abi.encode(R, amt, b, nonces[b], dl)), b, sig, dl);
        musd.burn(msg.sender, amt);
        tm.subDebt(b, amt);
    }
    function addCollWithSignature(address, address, address b, bytes calldata sig, uint256 dl) external payable {
        _check(keccak256(abi.encode(A, msg.value, b, nonces[b], dl)), b, sig, dl);
        tm.addColl(b, msg.value);
        (bool ok,) = address(ap).call{value: msg.value}(""); require(ok);
    }
}

contract MockSavings {
    MockMUSD public musd; mapping(address => uint256) public balanceOf;
    constructor(MockMUSD m) { musd = m; }
    function deposit(uint256 a) external { musd.transferFrom(msg.sender, address(this), a); balanceOf[msg.sender] += a; }
    function withdraw(uint256 a) external { balanceOf[msg.sender] -= a; musd.transfer(msg.sender, a); }
}
