import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface HoneypotCheckResult {
  mint: string;
  symbol: string;
  isHoneypot: boolean;
  confidence: number;
  reasons: string[];
  warnings: string[];
  safe: boolean;
}

export async function POST(request: Request) {
  try {
    const { mint, symbol } = await request.json();
    
    if (!mint) {
      return NextResponse.json({ error: "Missing mint" }, { status: 400 });
    }

    const result: HoneypotCheckResult = {
      mint,
      symbol: symbol || "?",
      isHoneypot: false,
      confidence: 0,
      reasons: [],
      warnings: [],
      safe: true,
    };

    // GoPlus honeypot detection
    try {
      const gp = await fetch(`https://api.gopluslabs.io/api/v1/token_security?chain_id=101&contract_addresses=${mint}`)
        .then(r => r.json())
        .catch(() => null);

      if (gp?.result?.[mint]) {
        const t = gp.result[mint];
        if (t.is_honeypot === "1") {
          result.isHoneypot = true;
          result.confidence = 95;
          result.reasons.push("Honeypot");
          result.safe = false;
        }
        if ((parseInt(t.transfer_tax || "0") || 0) > 500) {
          result.warnings.push(`Transfer tax: ${parseInt(t.transfer_tax || "0")/100}%`);
          result.confidence = Math.max(result.confidence, 40);
        }
        if (t.cannot_buy === "1" || t.cannot_sell === "1") {
          result.isHoneypot = true;
          result.confidence = 100;
          result.safe = false;
          result.reasons.push("Cannot trade");
        }
      }
    } catch (e) {}

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
