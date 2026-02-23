// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IProtocolAdapter, MarketQuote} from "../interfaces/IProtocolAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockAdapter is IProtocolAdapter {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdt;
    address public owner;

    struct Market {
        uint256 yesPrice;
        uint256 noPrice;
        uint256 yesLiquidity;
        uint256 noLiquidity;
        bool resolved;
        bool yesWins;
    }

    // marketId => Market
    mapping(bytes32 => Market) public markets;
    // marketId => user => yes shares
    mapping(bytes32 => mapping(address => uint256)) public yesShares;
    // marketId => user => no shares
    mapping(bytes32 => mapping(address => uint256)) public noShares;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address _usdt) {
        usdt = IERC20(_usdt);
        owner = msg.sender;
    }

    function setQuote(
        bytes32 marketId,
        uint256 yesPrice,
        uint256 noPrice,
        uint256 yesLiq,
        uint256 noLiq
    ) external onlyOwner {
        markets[marketId] = Market({
            yesPrice: yesPrice,
            noPrice: noPrice,
            yesLiquidity: yesLiq,
            noLiquidity: noLiq,
            resolved: false,
            yesWins: false
        });
    }

    function getQuote(bytes32 marketId) external view override returns (MarketQuote memory) {
        Market storage m = markets[marketId];
        return MarketQuote({
            marketId: marketId,
            yesPrice: m.yesPrice,
            noPrice: m.noPrice,
            yesLiquidity: m.yesLiquidity,
            noLiquidity: m.noLiquidity,
            resolved: m.resolved
        });
    }

    function buyOutcome(bytes32 marketId, bool buyYes, uint256 amount) external override returns (uint256 shares) {
        Market storage m = markets[marketId];
        require(!m.resolved, "market resolved");
        uint256 price = buyYes ? m.yesPrice : m.noPrice;
        require(price > 0, "market not set");

        // Transfer USDT from caller
        usdt.safeTransferFrom(msg.sender, address(this), amount);

        // shares = amount / price (both 18 decimals, so shares in 18 decimals)
        shares = (amount * 1e18) / price;

        if (buyYes) {
            yesShares[marketId][msg.sender] += shares;
        } else {
            noShares[marketId][msg.sender] += shares;
        }
    }

    function sellOutcome(bytes32 marketId, bool sellYes, uint256 shares) external override returns (uint256 payout) {
        Market storage m = markets[marketId];
        require(!m.resolved, "market resolved");

        if (sellYes) {
            require(yesShares[marketId][msg.sender] >= shares, "insufficient shares");
            yesShares[marketId][msg.sender] -= shares;
            payout = (shares * m.yesPrice) / 1e18;
        } else {
            require(noShares[marketId][msg.sender] >= shares, "insufficient shares");
            noShares[marketId][msg.sender] -= shares;
            payout = (shares * m.noPrice) / 1e18;
        }

        usdt.safeTransfer(msg.sender, payout);
    }

    function resolve(bytes32 marketId, bool _yesWins) external onlyOwner {
        Market storage m = markets[marketId];
        require(!m.resolved, "already resolved");
        m.resolved = true;
        m.yesWins = _yesWins;
    }

    function redeem(bytes32 marketId) external override returns (uint256 payout) {
        Market storage m = markets[marketId];
        require(m.resolved, "not resolved");

        uint256 winningShares;
        if (m.yesWins) {
            winningShares = yesShares[marketId][msg.sender];
            yesShares[marketId][msg.sender] = 0;
        } else {
            winningShares = noShares[marketId][msg.sender];
            noShares[marketId][msg.sender] = 0;
        }

        // Each winning share redeems at $1.00 (1e18)
        payout = winningShares;
        if (payout > 0) {
            usdt.safeTransfer(msg.sender, payout);
        }
    }

    function isResolved(bytes32 marketId) external view override returns (bool) {
        return markets[marketId].resolved;
    }
}
