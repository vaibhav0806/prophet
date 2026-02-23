// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {ProphitVault} from "../src/ProphitVault.sol";
import {MockUSDT} from "../src/mocks/MockUSDT.sol";
import {MockAdapter} from "../src/mocks/MockAdapter.sol";

contract ProphitVaultTest is Test {
    ProphitVault vault;
    MockUSDT usdt;
    MockAdapter adapterA;
    MockAdapter adapterB;

    address owner = address(this);
    address agent = address(0xA1);
    bytes32 marketId = keccak256("BTC-100K-2025");

    function setUp() public {
        vm.warp(1000); // move past default cooldown
        usdt = new MockUSDT();
        vault = new ProphitVault(address(usdt), agent);

        adapterA = new MockAdapter(address(usdt));
        adapterB = new MockAdapter(address(usdt));

        // Adapter A: YES at $0.55, NO at $0.50
        adapterA.setQuote(marketId, 0.55e18, 0.50e18, 10_000e18, 10_000e18);
        // Adapter B: YES at $0.60, NO at $0.45
        adapterB.setQuote(marketId, 0.60e18, 0.45e18, 10_000e18, 10_000e18);

        // Fund adapters with USDT so they can pay out
        usdt.mint(address(adapterA), 100_000e18);
        usdt.mint(address(adapterB), 100_000e18);

        // Fund owner and deposit to vault
        usdt.mint(owner, 10_000e18);
        usdt.approve(address(vault), 10_000e18);
        vault.deposit(5_000e18);
    }

    function test_deposit() public {
        assertEq(vault.vaultBalance(), 5_000e18);
    }

    function test_withdraw() public {
        vault.withdraw(1_000e18);
        assertEq(vault.vaultBalance(), 4_000e18);
        assertEq(usdt.balanceOf(owner), 6_000e18);
    }

    function test_withdraw_notOwner() public {
        vm.prank(agent);
        vm.expectRevert("not owner");
        vault.withdraw(1_000e18);
    }

    function test_openPosition() public {
        // Buy YES on A ($0.55), NO on B ($0.45) → total cost $1.00 for 1 YES + 1 NO
        // Guaranteed $1.00 payout regardless of outcome → breakeven at $1.00 cost
        // But here YES@0.55 + NO@0.45 = $1.00, so we need a spread to profit
        // Let's use: buy YES on A @0.55, buy NO on B @0.45 = $1.00 total for ~$1.00 payout

        // Better arb: buy YES on A @0.55 ($100), buy NO on B @0.45 ($100)
        // Shares: 100/0.55 = ~181.8 YES shares, 100/0.45 = ~222.2 NO shares
        // If YES wins: redeem 181.8 shares @ $1 = $181.8 profit on $200 cost
        // If NO wins: redeem 222.2 shares @ $1 = $222.2 profit on $200 cost
        // Guaranteed profit!

        vm.prank(agent);
        uint256 posId = vault.openPosition(
            address(adapterA),
            address(adapterB),
            marketId,
            marketId,
            true,   // buy YES on A
            100e18,  // $100 on A
            100e18,  // $100 on B
            0,       // no min shares
            0        // no min shares
        );

        assertEq(posId, 0);
        assertEq(vault.positionCount(), 1);

        ProphitVault.Position memory pos = vault.getPosition(0);
        assertEq(pos.costA, 100e18);
        assertEq(pos.costB, 100e18);
        assertFalse(pos.closed);
    }

    function test_openPosition_notAgent() public {
        vm.expectRevert("not agent");
        vault.openPosition(
            address(adapterA), address(adapterB),
            marketId, marketId, true,
            100e18, 100e18, 0, 0
        );
    }

    function test_openPosition_exceedsCap() public {
        vault.setCircuitBreakers(50, 1000e18, 50e18, 0); // cap at $50

        vm.prank(agent);
        vm.expectRevert("amount A exceeds cap");
        vault.openPosition(
            address(adapterA), address(adapterB),
            marketId, marketId, true,
            100e18, 100e18, 0, 0
        );
    }

    function test_cooldown() public {
        vault.setCircuitBreakers(50, 1000e18, 500e18, 60); // 60s cooldown

        vm.prank(agent);
        vault.openPosition(
            address(adapterA), address(adapterB),
            marketId, marketId, true,
            10e18, 10e18, 0, 0
        );

        vm.prank(agent);
        vm.expectRevert("cooldown active");
        vault.openPosition(
            address(adapterA), address(adapterB),
            marketId, marketId, true,
            10e18, 10e18, 0, 0
        );

        // Advance time past cooldown
        vm.warp(block.timestamp + 61);

        vm.prank(agent);
        vault.openPosition(
            address(adapterA), address(adapterB),
            marketId, marketId, true,
            10e18, 10e18, 0, 0
        );
    }

    function test_dailyTradeLimit() public {
        vault.setCircuitBreakers(2, 1000e18, 500e18, 0); // 2 trades/day

        vm.startPrank(agent);
        vault.openPosition(
            address(adapterA), address(adapterB),
            marketId, marketId, true, 10e18, 10e18, 0, 0
        );
        vault.openPosition(
            address(adapterA), address(adapterB),
            marketId, marketId, true, 10e18, 10e18, 0, 0
        );
        vm.expectRevert("daily trade limit");
        vault.openPosition(
            address(adapterA), address(adapterB),
            marketId, marketId, true, 10e18, 10e18, 0, 0
        );
        vm.stopPrank();
    }

    function test_closePosition_afterResolution() public {
        // Open position
        vm.prank(agent);
        vault.openPosition(
            address(adapterA), address(adapterB),
            marketId, marketId, true,
            100e18, 100e18, 0, 0
        );

        // Resolve market: YES wins
        adapterA.resolve(marketId, true);
        adapterB.resolve(marketId, true);

        // Close position
        vm.prank(agent);
        uint256 payout = vault.closePosition(0);

        // YES shares on A were bought at $0.55, so 100/0.55 * 1e18 = ~181.8e18 shares
        // YES wins, so adapter A redeems ~181.8e18
        // NO shares on B don't win, so adapter B redeems 0
        assertTrue(payout > 0);

        ProphitVault.Position memory pos = vault.getPosition(0);
        assertTrue(pos.closed);
    }

    function test_pause() public {
        vault.pause();

        vm.prank(agent);
        vm.expectRevert();
        vault.openPosition(
            address(adapterA), address(adapterB),
            marketId, marketId, true,
            100e18, 100e18, 0, 0
        );

        vault.unpause();

        vm.prank(agent);
        vault.openPosition(
            address(adapterA), address(adapterB),
            marketId, marketId, true,
            100e18, 100e18, 0, 0
        );
    }
}
