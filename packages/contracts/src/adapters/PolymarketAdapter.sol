// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IProtocolAdapter, MarketQuote} from "../interfaces/IProtocolAdapter.sol";
import {IConditionalTokens} from "../interfaces/IConditionalTokens.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

contract PolymarketAdapter is IProtocolAdapter, IERC1155Receiver, ERC165 {
    using SafeERC20 for IERC20;

    IERC20 public immutable collateral; // USDC
    IConditionalTokens public immutable ctf;
    address public owner;

    struct MarketConfig {
        bytes32 conditionId;
        uint256 yesPositionId; // ERC1155 token ID for YES
        uint256 noPositionId;  // ERC1155 token ID for NO
        bool registered;
    }

    // marketId => config
    mapping(bytes32 => MarketConfig) public markets;

    // Stored quotes (set by agent off-chain via owner)
    mapping(bytes32 => MarketQuote) internal quotes;

    // marketId => user => yes shares
    mapping(bytes32 => mapping(address => uint256)) public yesShares;
    // marketId => user => no shares
    mapping(bytes32 => mapping(address => uint256)) public noShares;

    // Adapter's own inventory of unused outcome tokens from splits
    mapping(bytes32 => uint256) public yesInventory;
    mapping(bytes32 => uint256) public noInventory;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address _collateral, address _ctf) {
        collateral = IERC20(_collateral);
        ctf = IConditionalTokens(_ctf);
        owner = msg.sender;
    }

    /// @notice Register a Polymarket market
    function registerMarket(
        bytes32 marketId,
        bytes32 conditionId
    ) external onlyOwner {
        // Compute position IDs for YES (indexSet=1) and NO (indexSet=2)
        bytes32 yesCollectionId = ctf.getCollectionId(bytes32(0), conditionId, 1);
        bytes32 noCollectionId = ctf.getCollectionId(bytes32(0), conditionId, 2);
        uint256 yesPositionId = ctf.getPositionId(collateral, yesCollectionId);
        uint256 noPositionId = ctf.getPositionId(collateral, noCollectionId);

        markets[marketId] = MarketConfig({
            conditionId: conditionId,
            yesPositionId: yesPositionId,
            noPositionId: noPositionId,
            registered: true
        });
    }

    /// @notice Set quote data (called by agent/owner off-chain)
    function setQuote(
        bytes32 marketId,
        uint256 yesPrice,
        uint256 noPrice,
        uint256 yesLiq,
        uint256 noLiq
    ) external onlyOwner {
        quotes[marketId] = MarketQuote({
            marketId: marketId,
            yesPrice: yesPrice,
            noPrice: noPrice,
            yesLiquidity: yesLiq,
            noLiquidity: noLiq,
            resolved: isResolved(marketId)
        });
    }

    function getQuote(bytes32 marketId) external view override returns (MarketQuote memory) {
        MarketQuote memory q = quotes[marketId];
        q.resolved = isResolved(marketId);
        return q;
    }

    function buyOutcome(bytes32 marketId, bool buyYes, uint256 amount) external override returns (uint256 shares) {
        MarketConfig storage config = markets[marketId];
        require(config.registered, "market not registered");
        require(!isResolved(marketId), "market resolved");

        // Pull collateral from caller
        collateral.safeTransferFrom(msg.sender, address(this), amount);

        // Check if we have inventory of the requested side
        if (buyYes && yesInventory[marketId] >= amount) {
            // Use existing YES inventory
            yesInventory[marketId] -= amount;
            shares = amount;
        } else if (!buyYes && noInventory[marketId] >= amount) {
            // Use existing NO inventory
            noInventory[marketId] -= amount;
            shares = amount;
        } else {
            // Split collateral into both YES and NO via CTF
            collateral.forceApprove(address(ctf), amount);
            uint256[] memory partition = new uint256[](2);
            partition[0] = 1; // YES
            partition[1] = 2; // NO

            ctf.splitPosition(collateral, bytes32(0), config.conditionId, partition, amount);

            shares = amount; // 1:1 split

            // Store the unwanted side as inventory
            if (buyYes) {
                noInventory[marketId] += amount;
            } else {
                yesInventory[marketId] += amount;
            }
        }

        // Credit shares to caller
        if (buyYes) {
            yesShares[marketId][msg.sender] += shares;
        } else {
            noShares[marketId][msg.sender] += shares;
        }
    }

    function sellOutcome(bytes32 marketId, bool sellYes, uint256 shares) external override returns (uint256 payout) {
        MarketConfig storage config = markets[marketId];
        require(config.registered, "market not registered");
        require(!isResolved(marketId), "market resolved");

        // Deduct shares from caller
        if (sellYes) {
            require(yesShares[marketId][msg.sender] >= shares, "insufficient shares");
            yesShares[marketId][msg.sender] -= shares;
        } else {
            require(noShares[marketId][msg.sender] >= shares, "insufficient shares");
            noShares[marketId][msg.sender] -= shares;
        }

        // Try to merge with opposite inventory
        uint256 oppositeAvailable = sellYes ? noInventory[marketId] : yesInventory[marketId];
        uint256 mergeAmount = shares < oppositeAvailable ? shares : oppositeAvailable;

        if (mergeAmount > 0) {
            // Merge YES+NO back into collateral
            uint256[] memory partition = new uint256[](2);
            partition[0] = 1;
            partition[1] = 2;
            ctf.mergePositions(collateral, bytes32(0), config.conditionId, partition, mergeAmount);

            if (sellYes) {
                noInventory[marketId] -= mergeAmount;
            } else {
                yesInventory[marketId] -= mergeAmount;
            }

            payout = mergeAmount;
            collateral.safeTransfer(msg.sender, payout);
        }

        // Any remaining shares that couldn't be merged go back to inventory
        uint256 remaining = shares - mergeAmount;
        if (remaining > 0) {
            if (sellYes) {
                yesInventory[marketId] += remaining;
            } else {
                noInventory[marketId] += remaining;
            }
            // No payout for unmerged shares -- they stay as inventory
        }
    }

    function redeem(bytes32 marketId) external override returns (uint256 payout) {
        MarketConfig storage config = markets[marketId];
        require(config.registered, "market not registered");
        require(isResolved(marketId), "not resolved");

        uint256 callerYes = yesShares[marketId][msg.sender];
        uint256 callerNo = noShares[marketId][msg.sender];
        yesShares[marketId][msg.sender] = 0;
        noShares[marketId][msg.sender] = 0;

        // Determine payout ratio from CTF
        uint256 payoutNum0 = ctf.payoutNumerators(config.conditionId, 0); // YES payout
        uint256 payoutNum1 = ctf.payoutNumerators(config.conditionId, 1); // NO payout
        uint256 payoutDenom = ctf.payoutDenominator(config.conditionId);

        // Calculate USDC payout for each side
        uint256 yesPayout = payoutDenom > 0 ? (callerYes * payoutNum0) / payoutDenom : 0;
        uint256 noPayout = payoutDenom > 0 ? (callerNo * payoutNum1) / payoutDenom : 0;
        payout = yesPayout + noPayout;

        if (payout > 0) {
            // Redeem the CTF tokens to get USDC
            uint256[] memory indexSets = new uint256[](2);
            indexSets[0] = 1; // YES
            indexSets[1] = 2; // NO
            ctf.redeemPositions(collateral, bytes32(0), config.conditionId, indexSets);

            // Transfer payout to caller
            collateral.safeTransfer(msg.sender, payout);
        }
    }

    function isResolved(bytes32 marketId) public view override returns (bool) {
        MarketConfig storage config = markets[marketId];
        if (!config.registered) return false;
        return ctf.payoutDenominator(config.conditionId) > 0;
    }

    // --- ERC1155 Receiver (required for CTF token transfers) ---

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure override returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure override returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC165, IERC165) returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId || super.supportsInterface(interfaceId);
    }
}
