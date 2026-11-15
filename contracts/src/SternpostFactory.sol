// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SternpostGovernor} from "./SternpostGovernor.sol";
import {SpendWallet} from "./SpendWallet.sol";
import {
    IERC20Min,
    IBorrowerOperationsSignatures,
    ITroveManager,
    IPriceFeed,
    IBorrowerOperations,
    ISavingsMUSD
} from "./interfaces/IMezo.sol";

/// @title SternpostFactory
/// @notice One governor per borrower, deployed with CREATE2 so its address is known before the first signature.
contract SternpostFactory {
    IBorrowerOperationsSignatures public immutable signatures;
    IBorrowerOperations public immutable borrowerOperations;
    ITroveManager public immutable troveManager;
    IPriceFeed public immutable priceFeed;
    IERC20Min public immutable musd;
    address public immutable activePool;
    ISavingsMUSD public immutable savings;
    /// @notice Immutable draw-fee parameters every governor created here inherits: `feeBps` (<= 50) of each
    ///         draw goes to `feeRecipient`. No setter, no owner, no upgrade path.
    uint16 public immutable feeBps;
    address public immutable feeRecipient;

    uint256 public constant MAX_FEE_BPS = 50;
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;

    mapping(address => address) public governorOf;
    mapping(address => address[]) internal _walletsOf;

    event GovernorCreated(address indexed borrower, address governor, uint256 floorICR, uint256 defendICR);
    event SpendWalletCreated(address indexed owner, address wallet, address agent, uint64 expiry);

    error AlreadyCreated(address governor);
    error BadFee();

    constructor(
        IBorrowerOperationsSignatures signatures_,
        IBorrowerOperations borrowerOperations_,
        ITroveManager troveManager_,
        IPriceFeed priceFeed_,
        IERC20Min musd_,
        address activePool_,
        ISavingsMUSD savings_,
        uint16 feeBps_,
        address feeRecipient_
    ) {
        if (feeBps_ > MAX_FEE_BPS || feeRecipient_ == address(0) || feeRecipient_ == BURN) revert BadFee();
        signatures = signatures_;
        borrowerOperations = borrowerOperations_;
        troveManager = troveManager_;
        priceFeed = priceFeed_;
        musd = musd_;
        activePool = activePool_;
        savings = savings_;
        feeBps = feeBps_;
        feeRecipient = feeRecipient_;
    }

    function createGovernor(uint256 floorICR, uint256 defendICR) external returns (SternpostGovernor g) {
        if (governorOf[msg.sender] != address(0)) revert AlreadyCreated(governorOf[msg.sender]);
        g = new SternpostGovernor{salt: bytes32(uint256(uint160(msg.sender)))}(
            msg.sender, signatures, borrowerOperations, troveManager, priceFeed, musd, activePool, savings, floorICR, defendICR, feeBps, feeRecipient
        );
        governorOf[msg.sender] = address(g);
        emit GovernorCreated(msg.sender, address(g), floorICR, defendICR);
    }

    function predictGovernor(address borrower, uint256 floorICR, uint256 defendICR) external view returns (address) {
        bytes32 h = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                bytes32(uint256(uint160(borrower))),
                keccak256(
                    abi.encodePacked(
                        type(SternpostGovernor).creationCode,
                        abi.encode(
                            borrower, signatures, borrowerOperations, troveManager, priceFeed, musd, activePool, savings, floorICR, defendICR, feeBps, feeRecipient
                        )
                    )
                )
            )
        );
        return address(uint160(uint256(h)));
    }

    function createSpendWallet(address agent, uint64 expiry) external returns (SpendWallet w) {
        w = new SpendWallet(msg.sender, agent, expiry);
        _walletsOf[msg.sender].push(address(w));
        emit SpendWalletCreated(msg.sender, address(w), agent, expiry);
    }

    function walletsOf(address owner) external view returns (address[] memory) {
        return _walletsOf[owner];
    }
}
