// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {OpinionAdapter} from "../src/adapters/OpinionAdapter.sol";
import {PredictAdapter} from "../src/adapters/PredictAdapter.sol";
import {ProbableAdapter} from "../src/adapters/ProbableAdapter.sol";

/// @title RegisterMarkets
/// @notice Sets initial dummy quotes on the deployed adapters for the 19 wired markets.
///         Run with: forge script script/RegisterMarkets.s.sol --rpc-url <rpc> --broadcast
contract RegisterMarkets is Script {
    // 50 cents, 18 decimals
    uint256 constant YES_PRICE = 0.50e18;
    uint256 constant NO_PRICE = 0.50e18;
    // 1000 USDT, 6 decimals
    uint256 constant LIQUIDITY = 1_000e6;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        address opinionAddr = vm.envAddress("OPINION_ADAPTER");
        address predictAddr = vm.envAddress("PREDICT_ADAPTER");
        address probableAddr = vm.envAddress("PROBABLE_ADAPTER");

        OpinionAdapter opinion = OpinionAdapter(opinionAddr);
        PredictAdapter predict = PredictAdapter(predictAddr);
        ProbableAdapter probable = ProbableAdapter(probableAddr);

        bytes32[] memory marketIds = _marketIds();

        console2.log("Registering", marketIds.length, "markets on each adapter");

        vm.startBroadcast(deployerKey);

        for (uint256 i = 0; i < marketIds.length; i++) {
            bytes32 mid = marketIds[i];

            opinion.setQuote(mid, YES_PRICE, NO_PRICE, LIQUIDITY, LIQUIDITY);
            predict.setQuote(mid, YES_PRICE, NO_PRICE, LIQUIDITY, LIQUIDITY);
            probable.setQuote(mid, YES_PRICE, NO_PRICE, LIQUIDITY, LIQUIDITY);

            console2.log("  market", i, vm.toString(mid));
        }

        vm.stopBroadcast();

        console2.log("--- RegisterMarkets Complete ---");
    }

    /// @dev The 19 market IDs shared across PREDICT_MARKET_MAP / PROBABLE_MARKET_MAP.
    function _marketIds() internal pure returns (bytes32[] memory ids) {
        ids = new bytes32[](19);
        ids[0]  = 0x590277c03fd7c7d744927dd5840ec4a4b5bee930094162438bc5f0b065ca5666;
        ids[1]  = 0xf794086099d2b08a5e4256ecfa11b6fd01f17481d166a67bd39a9c4f4bff59bd;
        ids[2]  = 0xef2b215ac8fc6849145795f6b2d4245e184ff7a55b33d4ca2abcaaec97219665;
        ids[3]  = 0xb54b413f3dd5663a3b3a061d9f002d3dbcef2661c7af1a357cfcd73197421ca4;
        ids[4]  = 0x0e636d42a71e4c3cef88d3e20793e0218a7c2231d93ac08148c233fc2b51141e;
        ids[5]  = 0x74442da28abc19d80fe12c42dbdabf3fcaa294692a703c83acdada92a6478833;
        ids[6]  = 0xdcbb4eacd50f38836cf12b1d84b2dd073c2f5a4d8e6d25c5fc80f3b039fd7ced;
        ids[7]  = 0x4a3b98c11db8c8f52be4447ca7c78b98869c1fc924630fc6a0eeb97dbad993e4;
        ids[8]  = 0x256b07c63918aad432c0134e98845400de4ad23117f1bda8392584ea37439f0c;
        ids[9]  = 0x5b5dbb60dd1448040502963eb5bdae2701649d5e947a258052e48cdef5278555;
        ids[10] = 0x3f85c23a5fd7d0205e0155cb154557812b258ce483aa4e2192e7fc275dcc5c3a;
        ids[11] = 0x3898d83b75fecfe5230ab23ec2dcbf096e71c1ba53c3d4549b0dd8c32daf1dc2;
        ids[12] = 0x82211932ed56a2861ddfc7ca8f906d0ec1770060d31e58040bb59b68d4434782;
        ids[13] = 0xe8bcf5a69072a4adaaa9efd48bbca74c132e09340bc210b041437f44747d0097;
        ids[14] = 0xbf34c3862cdb30d66705eb2b1a049487fa86edfb7fdd43fc4004222de52ed5cd;
        ids[15] = 0x74d21cb36ab43f9ad58d7c9010eb615c0686d9c1127e277238001fe8ef3f7c2d;
        ids[16] = 0xc8e766d5a6697f512fec427ed2873b8217305c3ae821c5c77b8cc0bd55e70325;
        ids[17] = 0x3f97ca5be423bb79ff57968469899187a9f0cd4cfeab52157213945a4a0714c1;
        ids[18] = 0x281bbd1da37021ca81624ffafa4f40d06300cee748aeabcba2bb36b3ad20017c;
    }
}
