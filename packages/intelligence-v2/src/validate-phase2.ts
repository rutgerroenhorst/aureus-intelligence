#!/usr/bin/env node

/**
 * PHASE 2 VALIDATION
 *
 * Tests community sentiment integration:
 * - Discord engagement detection
 * - Twitter bot score detection
 * - Sentiment aggregation
 */

import { getCommunitySentiment } from "./discord-integration.js";

async function validatePhase2() {
  console.log("\n🧪 PHASE 2 VALIDATION — Community Sentiment\n");
  console.log("━".repeat(60));

  try {
    // Test 1: Tilcayo-like community (real engagement)
    console.log("\n📊 Test 1: Authentic Community (Tilcayo pattern)");
    const tilcayoSentiment = await getCommunitySentiment(undefined, "Tilcayo");
    console.log(`  Overall Score: ${tilcayoSentiment.score.toFixed(0)}/100`);
    console.log(`  Confidence: ${tilcayoSentiment.confidence.toFixed(0)}%`);
    console.log(`  Breakdown:`, tilcayoSentiment.breakdown);

    const tilcayoPass = tilcayoSentiment.score >= 70;
    console.log(`  Result: ${tilcayoPass ? "✅ PASS" : "❌ FAIL"}`);

    // Test 2: Kevin-like community (bot farm)
    console.log("\n📊 Test 2: Bot Farm Community (Kevin pattern)");
    const kevinSentiment = await getCommunitySentiment(undefined, "KEVIN");
    console.log(`  Overall Score: ${kevinSentiment.score.toFixed(0)}/100`);
    console.log(`  Confidence: ${kevinSentiment.confidence.toFixed(0)}%`);
    console.log(`  Breakdown:`, kevinSentiment.breakdown);

    const kevinPass = kevinSentiment.score < 70;  // should be low
    console.log(`  Result: ${kevinPass ? "✅ PASS" : "❌ FAIL"}`);

    console.log("\n" + "━".repeat(60));
    const allPass = tilcayoPass && kevinPass;
    console.log(`\nPHASE 2 STATUS: ${allPass ? "✅ READY" : "⚠️ NEEDS WORK"}`);

    if (allPass) {
      console.log("\nNext steps:");
      console.log("1. ✅ Mock sentiment detection working");
      console.log("2. 🔜 Wire Discord API authentication");
      console.log("3. 🔜 Wire Twitter API v2 authentication");
      console.log("4. 🔜 Integrate into real GATE-09 evaluation");
      console.log("5. 🔜 Test against 20+ historical tokens");
    }

    process.exit(allPass ? 0 : 1);
  } catch (error) {
    console.error("❌ PHASE 2 VALIDATION FAILED:", error);
    process.exit(1);
  }
}

validatePhase2();
