import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface DumpIndicator {
  timeframe: string;
  sells: number;
  buys: number;
  ratio: number;
  priceChange: number;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE";
}

interface PreFilterResult {
  mint: string;
  symbol: string;
  decision: "ACCEPT" | "REJECT";
  reasons: string[];
  dumpIndicators: DumpIndicator[];
  concentration?: { top1: number; top5: number };
  riskScore: number;
}

export async function POST(request: Request) {
  try {
    const { mint, symbol } = await request.json();

    if (!mint) {
      return NextResponse.json({ error: "Missing mint" }, { status: 400 });
    }

    const result: PreFilterResult = {
      mint,
      symbol: symbol || "?",
      decision: "ACCEPT",
      reasons: [],
      dumpIndicators: [],
      riskScore: 0,
    };

    // STEP 1: Fetch from DexScreener
    const dexRes = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${mint}`
    );
    const dexData = await dexRes.json();

    if (!dexData.pairs || dexData.pairs.length === 0) {
      result.decision = "REJECT";
      result.reasons.push("NOT_FOUND_ON_DEXSCREENER");
      result.riskScore = 100;
      return NextResponse.json(result);
    }

    const pair = dexData.pairs[0];
    result.symbol = pair.baseToken?.symbol || symbol || "?";

    // STEP 2: CHECK DUMP PATTERNS
    const timeframes = ["m5", "h1", "h6", "h24"] as const;
    let hasActiveDump = false;
    let hasRug = false;

    for (const tf of timeframes) {
      const txns = pair.txns?.[tf];
      const price = pair.priceChange?.[tf];

      if (!txns) continue;

      const ratio = txns.sells / Math.max(txns.buys, 1);
      let severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE" = "NONE";

      if (ratio > 3 && price && price < -40) severity = "CRITICAL";
      else if (ratio > 2.5 && price && price < -30) severity = "CRITICAL";
      else if (ratio > 2 && price && price < -20) severity = "HIGH";
      else if (ratio > 1.8) severity = "HIGH";
      else if (ratio > 1.5) severity = "MEDIUM";
      else if (ratio > 1.3) severity = "LOW";

      result.dumpIndicators.push({
        timeframe: tf,
        sells: txns.sells,
        buys: txns.buys,
        ratio: parseFloat(ratio.toFixed(2)),
        priceChange: price || 0,
        severity,
      });

      if (severity === "CRITICAL") {
        hasRug = true;
        result.riskScore += 50;
      } else if (severity === "HIGH") {
        hasActiveDump = true;
        result.riskScore += 30;
      } else if (severity === "MEDIUM") {
        result.riskScore += 15;
      }
    }

    // STEP 3: HARD REJECTS
    if (hasRug) {
      result.decision = "REJECT";
      result.reasons.push("RUG_PULL_PATTERN_DETECTED");
    }

    // STEP 4: CHECK LIQUIDITY TRAP
    const liquidity = pair.liquidity?.usd || 0;
    const fdv = pair.fdv || 0;
    if (fdv > 0 && liquidity < fdv * 0.01) {
      result.decision = "REJECT";
      result.reasons.push("EXTREME_LIQUIDITY_TRAP (<1% ratio)");
      result.riskScore += 40;
    } else if (fdv > 0 && liquidity < fdv * 0.05) {
      result.reasons.push("SEVERE_LIQUIDITY_TRAP (<5% ratio)");
      result.riskScore += 25;
    }

    // STEP 5: CHECK PAIR AGE + ACTIVITY COMBO
    const pairAge = Date.now() - (pair.pairCreatedAt || 0);
    const pairAgeMinutes = pairAge / (1000 * 60);

    if (pairAgeMinutes < 5 && hasActiveDump) {
      result.decision = "REJECT";
      result.reasons.push("FLASH_RUG_PATTERN (<5 min old + active dump)");
      result.riskScore = 95;
    }

    if (pairAgeMinutes < 60 && hasActiveDump && pair.volume?.h1 > 100000) {
      result.decision = "REJECT";
      result.reasons.push("PUMP_DUMP_PATTERN (<1h old + dump + high volume)");
      result.riskScore = 90;
    }

    // STEP 6: TRY HELIUS FOR HOLDER DATA
    const heliusKey = process.env.HELIUS_API_KEY;
    if (heliusKey) {
      try {
        const holderRes = await fetch(
          `https://api.helius.xyz/v0/token/${mint}/holders?api-key=${heliusKey}&limit=100`
        );
        const holderData = await holderRes.json();

        if (holderData.result && holderData.result.length > 0) {
          const totalSupply = holderData.result.reduce(
            (sum: number, h: any) => sum + (h.amount || 0),
            0
          );

          if (totalSupply > 0) {
            const top1 = (holderData.result[0]?.amount || 0) / totalSupply;
            const top5 = holderData.result
              .slice(0, 5)
              .reduce((sum: number, h: any) => sum + (h.amount || 0), 0) / totalSupply;

            result.concentration = {
              top1: parseFloat((top1 * 100).toFixed(2)),
              top5: parseFloat((top5 * 100).toFixed(2)),
            };

            // Hard fail: extreme concentration
            if (top1 > 0.7 || top5 > 0.85) {
              result.decision = "REJECT";
              result.reasons.push(
                `EXTREME_CONCENTRATION (top1=${(top1 * 100).toFixed(0)}%, top5=${(top5 * 100).toFixed(0)}%)`
              );
              result.riskScore = 99;
            } else if (top1 > 0.5 || top5 > 0.75) {
              result.reasons.push(
                `HIGH_CONCENTRATION (top1=${(top1 * 100).toFixed(0)}%, top5=${(top5 * 100).toFixed(0)}%)`
              );
              result.riskScore += 25;
            }
          }
        }
      } catch (err) {
        // Helius optional - if it fails, continue with other checks
      }
    }

    // STEP 7: VOLUME SPIKE DETECTION
    const m5Vol = pair.volume?.m5 || 0;
    const h1Vol = pair.volume?.h1 || 0;
    if (h1Vol > 0) {
      const spike = m5Vol / (h1Vol / 12); // Last 5 min vs average
      if (spike > 10) {
        result.reasons.push(`FLASH_VOLUME_SPIKE (${spike.toFixed(1)}x)`);
        result.riskScore += 20;
      }
    }

    // STEP 8: FINAL DECISION
    if (result.riskScore > 70) {
      if (result.decision !== "REJECT") {
        result.decision = "REJECT";
        result.reasons.push(`HIGH_RISK_SCORE (${result.riskScore})`);
      }
    } else if (result.riskScore > 40) {
      result.reasons.push(`⚠️ CAUTION: Risk score ${result.riskScore}`);
    }

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Pre-filter error:", err);
    return NextResponse.json({
      error: String(err),
      decision: "REJECT",
      reasons: ["FILTER_ERROR"],
    });
  }
}
