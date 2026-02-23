import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runDiscovery } from "../discovery/pipeline.js";
import type { DiscoveryResult, MarketMatch } from "../discovery/pipeline.js";

// ---------------------------------------------------------------------------
// Config & CLI flags
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../data");
const OUT_PATH = join(DATA_DIR, "discovery-results.json");

const hasFlag = (name: string) => process.argv.includes(name);
const DRY_RUN = hasFlag("--dry-run");
const SAVE = hasFlag("--save");

const PROBABLE_EVENTS_API_BASE =
  process.env.PROBABLE_EVENTS_API_BASE || "https://market-api.probable.markets";
const PREDICT_API_BASE =
  process.env.PREDICT_API_BASE || "https://api.predict.fun";
const PREDICT_API_KEY = process.env.PREDICT_API_KEY || "";

// ---------------------------------------------------------------------------
// Print helpers
// ---------------------------------------------------------------------------

function printMatch(match: MarketMatch, index: number): void {
  const sim = Math.round(match.similarity * 100);
  console.log(`  ${index + 1}. [${match.matchType}] similarity=${sim}%`);
  console.log(`     Probable: "${match.probable.title}" (id=${match.probable.id})`);
  console.log(`     Predict:  "${match.predict.title}" (id=${match.predict.id})`);
  console.log(`     conditionId: ${match.probable.conditionId}`);
  console.log("");
}

function printResults(result: DiscoveryResult): void {
  console.log("\n========================================");
  console.log(" Auto-Discovery Results");
  console.log("========================================\n");
  console.log(`Discovered at:     ${result.discoveredAt}`);
  console.log(`Probable markets:  ${result.probableMarkets}`);
  console.log(`Predict markets:   ${result.predictMarkets}`);
  console.log(`Matches found:     ${result.matches.length}`);

  if (result.matches.length > 0) {
    const byCondition = result.matches.filter((m) => m.matchType === "conditionId").length;
    const byTitle = result.matches.filter((m) => m.matchType === "titleSimilarity").length;
    console.log(`  by conditionId:    ${byCondition}`);
    console.log(`  by title match:    ${byTitle}`);

    console.log("\n--- Match Details ---\n");
    for (let i = 0; i < result.matches.length; i++) {
      printMatch(result.matches[i], i);
    }
  } else {
    console.log("\n  (no matches found)\n");
  }

  // Always print the market map JSON values
  console.log("========================================");
  console.log(" PROBABLE_MARKET_MAP");
  console.log("========================================\n");
  console.log(JSON.stringify(result.probableMarketMap, null, 2));

  console.log("\n========================================");
  console.log(" PREDICT_MARKET_MAP");
  console.log("========================================\n");
  console.log(JSON.stringify(result.predictMarketMap, null, 2));

  if (DRY_RUN) {
    console.log("\n========================================");
    console.log(" Env Var Values (--dry-run)");
    console.log("========================================\n");
    console.log(`PROBABLE_MARKET_MAP='${JSON.stringify(result.probableMarketMap)}'`);
    console.log("");
    console.log(`PREDICT_MARKET_MAP='${JSON.stringify(result.predictMarketMap)}'`);
  }

  console.log("\n========================================\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!PREDICT_API_KEY) {
    console.error(
      "PREDICT_API_KEY env var required.\n" +
        "Usage: npx tsx src/scripts/auto-discover.ts [--dry-run] [--save]",
    );
    process.exit(1);
  }

  console.log("Running auto-discovery pipeline...");
  console.log(`  Probable API: ${PROBABLE_EVENTS_API_BASE}`);
  console.log(`  Predict API:  ${PREDICT_API_BASE}`);
  if (DRY_RUN) console.log("  Mode: --dry-run");
  if (SAVE) console.log("  Mode: --save");
  console.log("");

  const result = await runDiscovery({
    probableEventsApiBase: PROBABLE_EVENTS_API_BASE,
    predictApiBase: PREDICT_API_BASE,
    predictApiKey: PREDICT_API_KEY,
  });

  printResults(result);

  if (SAVE) {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(OUT_PATH, JSON.stringify(result, null, 2));
    console.log(`Results saved to ${OUT_PATH}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
