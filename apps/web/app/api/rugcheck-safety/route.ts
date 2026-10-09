import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// RugCheck API integration for safety scoring
async function checkTokenSafety(mint: string): Promise<any> {
  try {
    // Free RugCheck endpoint - no auth required
    const response = await fetch(
      `https://api.rugcheck.xyz/v1/tokens/${mint}/report`,
      {
        method: "GET",
        headers: { "Accept": "application/json" }
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    return {
      mint,
      riskScore: data.risks?.length || 0,
      risks: data.risks?.map((r: any) => r.name) || [],
      hasAuthority: data.authorities?.some((a: any) => a.isActive),
      lpLocked: data.lp?.isLocked || false,
      lpPercentage: data.lp?.percentage || 0,
      verdict: data.risks?.length === 0 ? "✅ SAFE" :
               data.risks?.length <= 2 ? "⚠️ MINOR RISKS" :
               "🔴 HIGH RISK",
      lastChecked: new Date().toISOString()
    };
  } catch (err) {
    console.error("RugCheck fetch error:", err);
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mint = searchParams.get("mint");

  if (!mint) {
    return NextResponse.json({
      error: "mint parameter required"
    }, { status: 400 });
  }

  const safety = await checkTokenSafety(mint);

  if (!safety) {
    return NextResponse.json({
      mint,
      error: "Unable to fetch safety data",
      timestamp: new Date().toISOString()
    }, { status: 200 });
  }

  return NextResponse.json(safety, {
    headers: { "Cache-Control": "max-age=3600" }
  });
}
