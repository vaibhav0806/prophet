// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

struct MarketQuote {
    bytes32 marketId;
    uint256 yesPrice;   // 18 decimals, e.g. 0.55e18 = $0.55
    uint256 noPrice;    // 18 decimals
    uint256 yesLiquidity;
    uint256 noLiquidity;
    bool resolved;
}

interface IProtocolAdapter {
    function getQuote(bytes32 marketId) external view returns (MarketQuote memory);
    function buyOutcome(bytes32 marketId, bool buyYes, uint256 amount) external returns (uint256 shares);
    function sellOutcome(bytes32 marketId, bool sellYes, uint256 shares) external returns (uint256 payout);
    function redeem(bytes32 marketId) external returns (uint256 payout);
    function isResolved(bytes32 marketId) external view returns (bool);
}
