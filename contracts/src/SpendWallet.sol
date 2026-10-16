// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20Min} from "./interfaces/IMezo.sol";

/// @title SpendWallet
/// @notice A small contract wallet that receives drawn MUSD and pays x402 resources. The x402 "exact" scheme
///         (Permit2 transfer) asks this wallet for an EIP-1271 signature; a short-lived agent session key provides it.
///         The owner can rotate or revoke the agent and sweep funds at any time. The wallet holds no keys and the
///         agent can never move funds except by signing a Permit2 transfer within the Permit2 allowance set here.
contract SpendWallet {
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    bytes4 internal constant MAGIC = 0x1626ba7e;

    address public immutable owner;
    address public agent;
    uint64 public agentExpiry;

    event AgentSet(address indexed agent, uint64 expiry);
    event AgentRevoked();
    event BudgetSet(address indexed token, uint256 amount);
    event Swept(address indexed token, uint256 amount);

    error OnlyOwner();
    error TransferFailed();

    constructor(address owner_, address agent_, uint64 expiry_) {
        owner = owner_;
        agent = agent_;
        agentExpiry = expiry_;
        emit AgentSet(agent_, expiry_);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    function setAgent(address agent_, uint64 expiry_) external onlyOwner {
        agent = agent_;
        agentExpiry = expiry_;
        emit AgentSet(agent_, expiry_);
    }

    function revokeAgent() external onlyOwner {
        agent = address(0);
        agentExpiry = 0;
        emit AgentRevoked();
    }

    /// @notice Cap what Permit2 may pull for x402 payments.
    function setBudget(address token, uint256 amount) external onlyOwner {
        IERC20Min(token).approve(PERMIT2, amount);
        emit BudgetSet(token, amount);
    }

    function sweep(address token, uint256 amount) external onlyOwner {
        if (!IERC20Min(token).transfer(owner, amount)) revert TransferFailed();
        emit Swept(token, amount);
    }

    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        if (agent == address(0) || block.timestamp > agentExpiry || sig.length != 65) return 0xffffffff;
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return 0xffffffff;
        return ecrecover(hash, v, r, s) == agent ? MAGIC : bytes4(0xffffffff);
    }
}
