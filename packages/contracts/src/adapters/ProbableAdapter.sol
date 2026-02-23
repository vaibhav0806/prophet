// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IProtocolAdapter, MarketQuote} from "../interfaces/IProtocolAdapter.sol";
import {IConditionalTokens} from "../interfaces/IConditionalTokens.sol";
import {IProbableRouter, IProbablePool} from "../interfaces/IProbableRouter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/// @title ProbableAdapter
/// @notice Adapter for Probable — an AMM-based zero-fee prediction market on BNB Chain,
/// incubated by PancakeSwap, using UMA Optimistic Oracle for resolution.
///
/// Architecture assumptions (Probable is not yet fully deployed):
/// - Uses Gnosis CTF (Conditional Tokens Framework) for outcome token minting/merging/redemption
/// - Uses CPMM (constant product) AMM pools for YES/NO outcome token trading
/// - Uses USDT as collateral
/// - Uses UMA Optimistic Oracle — resolution is detected via CTF payoutDenominator > 0
///
/// The adapter supports two trading modes:
/// 1. AMM mode: swap via Probable's CPMM pools (when a pool is registered for the market)
/// 2. CTF-direct mode: split/merge via CTF (fallback, same as Opinion/Predict adapters)
///
/// On-chain price discovery: reads AMM pool reserves to compute implied prices.
contract ProbableAdapter is IProtocolAdapter, Ownable2Step, IERC1155Receiver, ERC165 {
    using SafeERC20 for IERC20;

    IERC20 public immutable collateral;
    IConditionalTokens public immutable ctf;
    IProbableRouter public immutable router;

    // Access control: only approved callers (vault) can trade
    mapping(address => bool) public approvedCallers;

    struct MarketConfig {
        bytes32 conditionId;
        uint256 yesPositionId;
        uint256 noPositionId;
        address pool;         // AMM pool address (address(0) if no pool)
        bool registered;
        bool redeemed;
    }

    mapping(bytes32 => MarketConfig) public markets;

    // Adapter-level balance tracking (not per-user)
    mapping(bytes32 => uint256) public yesBalance;
    mapping(bytes32 => uint256) public noBalance;

    // Inventory of unused outcome tokens from splits (opposite side waiting to be used)
    mapping(bytes32 => uint256) public yesInventory;
    mapping(bytes32 => uint256) public noInventory;

    // Slippage tolerance in basis points (default 100 = 1%)
    uint256 public slippageBps = 100;

    // Events
    event CallerAdded(address indexed caller);
    event CallerRemoved(address indexed caller);
    event MarketRegistered(bytes32 indexed marketId, bytes32 conditionId, address pool);
    event PoolUpdated(bytes32 indexed marketId, address pool);
    event OutcomeBought(bytes32 indexed marketId, address indexed buyer, bool buyYes, uint256 amount, uint256 shares);
    event OutcomeSold(bytes32 indexed marketId, address indexed seller, bool sellYes, uint256 amount, uint256 payout);
    event Redeemed(bytes32 indexed marketId, address indexed caller, uint256 payout);
    event SlippageUpdated(uint256 newSlippageBps);

    modifier onlyApproved() {
        require(approvedCallers[msg.sender] || msg.sender == owner(), "not approved");
        _;
    }

    constructor(address _ctf, address _collateral, address _router) Ownable(msg.sender) {
        require(_ctf != address(0), "zero ctf");
        require(_collateral != address(0), "zero collateral");
        require(_router != address(0), "zero router");
        collateral = IERC20(_collateral);
        ctf = IConditionalTokens(_ctf);
        router = IProbableRouter(_router);
    }

    // --- Access control ---

    function addCaller(address caller) external onlyOwner {
        require(caller != address(0), "zero address");
        approvedCallers[caller] = true;
        emit CallerAdded(caller);
    }

    function removeCaller(address caller) external onlyOwner {
        approvedCallers[caller] = false;
        emit CallerRemoved(caller);
    }

    // --- Configuration ---

    function setSlippage(uint256 _slippageBps) external onlyOwner {
        require(_slippageBps <= 1000, "slippage too high"); // max 10%
        slippageBps = _slippageBps;
        emit SlippageUpdated(_slippageBps);
    }

    // --- Market registration ---

    function registerMarket(bytes32 marketId, bytes32 conditionId, address pool) external onlyOwner {
        bytes32 yesCollectionId = ctf.getCollectionId(bytes32(0), conditionId, 1);
        bytes32 noCollectionId = ctf.getCollectionId(bytes32(0), conditionId, 2);
        uint256 yesPositionId = ctf.getPositionId(collateral, yesCollectionId);
        uint256 noPositionId = ctf.getPositionId(collateral, noCollectionId);

        markets[marketId] = MarketConfig({
            conditionId: conditionId,
            yesPositionId: yesPositionId,
            noPositionId: noPositionId,
            pool: pool,
            registered: true,
            redeemed: false
        });

        emit MarketRegistered(marketId, conditionId, pool);
    }

    function setPool(bytes32 marketId, address pool) external onlyOwner {
        require(markets[marketId].registered, "market not registered");
        markets[marketId].pool = pool;
        emit PoolUpdated(marketId, pool);
    }

    // --- Quotes (on-chain from AMM reserves) ---

    function getQuote(bytes32 marketId) external view override returns (MarketQuote memory) {
        MarketConfig storage config = markets[marketId];

        if (config.pool != address(0)) {
            // Read AMM pool reserves and compute implied prices
            IProbablePool pool = IProbablePool(config.pool);
            (uint256 yesRes, uint256 noRes) = pool.getReserves();
            uint256 total = yesRes + noRes;

            // Implied price from CPMM: price_yes = noReserve / (yesReserve + noReserve)
            // (More YES in pool = YES is cheaper; price is the share of the opposite side)
            uint256 yesPrice = total > 0 ? (noRes * 1e18) / total : 0;
            uint256 noPrice = total > 0 ? (yesRes * 1e18) / total : 0;

            return MarketQuote({
                marketId: marketId,
                yesPrice: yesPrice,
                noPrice: noPrice,
                yesLiquidity: yesRes,
                noLiquidity: noRes,
                resolved: isResolved(marketId)
            });
        }

        // No pool — return empty quote
        return MarketQuote({
            marketId: marketId,
            yesPrice: 0,
            noPrice: 0,
            yesLiquidity: 0,
            noLiquidity: 0,
            resolved: isResolved(marketId)
        });
    }

    // --- Trading ---

    function buyOutcome(bytes32 marketId, bool buyYes, uint256 amount) external override onlyApproved returns (uint256 shares) {
        MarketConfig storage config = markets[marketId];
        require(config.registered, "market not registered");
        require(!isResolved(marketId), "market resolved");

        // Pull collateral from caller
        collateral.safeTransferFrom(msg.sender, address(this), amount);

        if (config.pool != address(0)) {
            // AMM mode: split collateral into YES+NO via CTF, then swap unwanted side through pool
            shares = _buyViaAmm(marketId, config, buyYes, amount);
        } else {
            // CTF-direct mode: same as Opinion/Predict adapters
            shares = _buyViaCTF(marketId, config, buyYes, amount);
        }

        // Credit to adapter-level balance
        if (buyYes) {
            yesBalance[marketId] += shares;
        } else {
            noBalance[marketId] += shares;
        }

        emit OutcomeBought(marketId, msg.sender, buyYes, amount, shares);
    }

    function sellOutcome(bytes32 marketId, bool sellYes, uint256 shares) external override onlyApproved returns (uint256 payout) {
        MarketConfig storage config = markets[marketId];
        require(config.registered, "market not registered");
        require(!isResolved(marketId), "market resolved");

        // Debit adapter-level balance
        if (sellYes) {
            require(yesBalance[marketId] >= shares, "insufficient balance");
            yesBalance[marketId] -= shares;
        } else {
            require(noBalance[marketId] >= shares, "insufficient balance");
            noBalance[marketId] -= shares;
        }

        if (config.pool != address(0)) {
            // AMM mode: swap held tokens to opposite side through pool, then merge
            payout = _sellViaAmm(marketId, config, sellYes, shares);
        } else {
            // CTF-direct mode: merge with inventory
            payout = _sellViaCTF(marketId, config, sellYes, shares);
        }

        collateral.safeTransfer(msg.sender, payout);

        emit OutcomeSold(marketId, msg.sender, sellYes, shares, payout);
    }

    function redeem(bytes32 marketId) external override onlyApproved returns (uint256 payout) {
        MarketConfig storage config = markets[marketId];
        require(config.registered, "market not registered");
        require(isResolved(marketId), "not resolved");

        uint256 balBefore = collateral.balanceOf(address(this));

        if (!config.redeemed) {
            config.redeemed = true;

            // Redeem all CTF tokens for this condition
            uint256[] memory indexSets = new uint256[](2);
            indexSets[0] = 1; // YES
            indexSets[1] = 2; // NO
            ctf.redeemPositions(collateral, bytes32(0), config.conditionId, indexSets);

            // Merge any remaining paired inventory to recover collateral
            uint256 mergeable = yesInventory[marketId] < noInventory[marketId]
                ? yesInventory[marketId]
                : noInventory[marketId];
            if (mergeable > 0) {
                uint256[] memory partition = new uint256[](2);
                partition[0] = 1;
                partition[1] = 2;
                ctf.mergePositions(collateral, bytes32(0), config.conditionId, partition, mergeable);
                yesInventory[marketId] -= mergeable;
                noInventory[marketId] -= mergeable;
            }
        }

        uint256 balAfter = collateral.balanceOf(address(this));
        payout = balAfter - balBefore;

        // Send everything to caller (the vault)
        if (payout > 0) {
            collateral.safeTransfer(msg.sender, payout);
        }

        // Reset balances
        yesBalance[marketId] = 0;
        noBalance[marketId] = 0;

        emit Redeemed(marketId, msg.sender, payout);
    }

    function isResolved(bytes32 marketId) public view override returns (bool) {
        MarketConfig storage config = markets[marketId];
        if (!config.registered) return false;
        return ctf.payoutDenominator(config.conditionId) > 0;
    }

    // --- Internal: AMM trading ---

    function _buyViaAmm(bytes32, /* marketId */ MarketConfig storage config, bool buyYes, uint256 amount) internal returns (uint256 shares) {
        // Split collateral into YES+NO
        collateral.forceApprove(address(ctf), amount);
        uint256[] memory partition = new uint256[](2);
        partition[0] = 1;
        partition[1] = 2;
        ctf.splitPosition(collateral, bytes32(0), config.conditionId, partition, amount);

        // We now have `amount` of YES and `amount` of NO tokens.
        // Swap the unwanted side through the AMM pool for more of the wanted side.
        IProbablePool pool = IProbablePool(config.pool);
        address tokenIn;
        if (buyYes) {
            tokenIn = pool.noToken();
        } else {
            tokenIn = pool.yesToken();
        }

        // Approve router to spend the unwanted tokens
        IERC20(tokenIn).forceApprove(address(router), amount);

        uint256 amountOutMin = (amount * (10000 - slippageBps)) / 10000;
        uint256 amountOut = router.swap(
            config.pool,
            tokenIn,
            amount,
            amountOutMin,
            address(this),
            block.timestamp
        );

        // Total shares = original amount (kept side) + amountOut (swapped)
        shares = amount + amountOut;
    }

    function _sellViaAmm(bytes32 marketId, MarketConfig storage config, bool sellYes, uint256 shares) internal returns (uint256 payout) {
        // We want to sell `shares` of one side. Split into two halves:
        // half goes through AMM swap to get the opposite side, then merge both into collateral.
        uint256 half = shares / 2;
        uint256 remainder = shares - half;

        IProbablePool pool = IProbablePool(config.pool);
        address tokenIn;
        if (sellYes) {
            tokenIn = pool.yesToken();
        } else {
            tokenIn = pool.noToken();
        }

        // Approve router to spend half of held tokens for swapping
        IERC20(tokenIn).forceApprove(address(router), half);

        uint256 amountOutMin = (half * (10000 - slippageBps)) / 10000;
        uint256 amountOut = router.swap(
            config.pool,
            tokenIn,
            half,
            amountOutMin,
            address(this),
            block.timestamp
        );

        // Merge min(remainder, amountOut) pairs into collateral
        uint256 mergeable = remainder < amountOut ? remainder : amountOut;

        uint256[] memory partition = new uint256[](2);
        partition[0] = 1;
        partition[1] = 2;
        ctf.mergePositions(collateral, bytes32(0), config.conditionId, partition, mergeable);

        payout = mergeable;

        // Store leftover tokens as inventory
        if (remainder > amountOut) {
            if (sellYes) {
                yesInventory[marketId] += remainder - amountOut;
            } else {
                noInventory[marketId] += remainder - amountOut;
            }
        } else if (amountOut > remainder) {
            if (sellYes) {
                noInventory[marketId] += amountOut - remainder;
            } else {
                yesInventory[marketId] += amountOut - remainder;
            }
        }
    }

    // --- Internal: CTF-direct trading (fallback, no AMM pool) ---

    function _buyViaCTF(bytes32 marketId, MarketConfig storage config, bool buyYes, uint256 amount) internal returns (uint256 shares) {
        // Check if we have inventory of the requested side
        if (buyYes && yesInventory[marketId] >= amount) {
            yesInventory[marketId] -= amount;
            shares = amount;
        } else if (!buyYes && noInventory[marketId] >= amount) {
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
    }

    function _sellViaCTF(bytes32 marketId, MarketConfig storage config, bool sellYes, uint256 shares) internal returns (uint256 payout) {
        // Require sufficient opposite inventory to merge
        uint256 oppositeAvailable = sellYes ? noInventory[marketId] : yesInventory[marketId];
        require(oppositeAvailable >= shares, "insufficient inventory to merge");

        // Merge YES+NO back into collateral
        uint256[] memory partition = new uint256[](2);
        partition[0] = 1;
        partition[1] = 2;
        ctf.mergePositions(collateral, bytes32(0), config.conditionId, partition, shares);

        if (sellYes) {
            noInventory[marketId] -= shares;
        } else {
            yesInventory[marketId] -= shares;
        }

        payout = shares;
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
