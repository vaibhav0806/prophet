// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IProbableRouter — Probable AMM Router interface
/// @notice Assumed interface for Probable's CPMM router on BNB Chain.
/// Probable is not yet deployed; this is based on their stated architecture
/// (CPMM pools for YES/NO outcome tokens, USDT collateral, zero fees).
/// The interface follows standard Uniswap-V2-style pool patterns adapted
/// for binary-outcome prediction markets.
interface IProbableRouter {
    /// @notice Swap exact input amount of one outcome token for the other
    /// @param pool Address of the YES/NO AMM pool
    /// @param tokenIn Address of the input token (YES or NO ERC-20 wrapper)
    /// @param amountIn Amount of input token to swap
    /// @param amountOutMin Minimum output to receive (slippage protection)
    /// @param to Recipient of output tokens
    /// @param deadline Timestamp after which the swap reverts
    /// @return amountOut Amount of output token received
    function swap(
        address pool,
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountOut);

    /// @notice Get a quote for swapping exact input amount
    /// @param pool Address of the YES/NO AMM pool
    /// @param tokenIn Address of the input token
    /// @param amountIn Amount of input token
    /// @return amountOut Expected output amount
    function getAmountOut(
        address pool,
        address tokenIn,
        uint256 amountIn
    ) external view returns (uint256 amountOut);
}

/// @title IProbablePool — Probable AMM Pool interface
/// @notice A CPMM pool holding YES and NO outcome tokens with x*y=k invariant.
interface IProbablePool {
    /// @notice Reserve of YES outcome tokens in the pool
    function yesReserve() external view returns (uint256);

    /// @notice Reserve of NO outcome tokens in the pool
    function noReserve() external view returns (uint256);

    /// @notice Address of the YES outcome token (ERC-20 wrapper around CTF position)
    function yesToken() external view returns (address);

    /// @notice Address of the NO outcome token (ERC-20 wrapper around CTF position)
    function noToken() external view returns (address);

    /// @notice Get both reserves in a single call
    function getReserves() external view returns (uint256 yesRes, uint256 noRes);
}
