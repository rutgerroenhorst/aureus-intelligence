import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function fetchDexScreenerChain(chainId: string, limit: number = 50) {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=chain:${chainId}&order=createdAt&orderDir=desc&limit=${limit}`,
      { next: { revalidate: 0 } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.pairs || [];
  } catch (e) {
    return [];
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const chainId = searchParams.get("chain") || "solana";

    const pairs = await fetchDexScreenerChain(chainId, 50);

    const diagnostic = pairs.map((pair: any) => {
      const mcap = pair.marketCap || 0;
      const liq = pair.liquidity?.usd || 0;
      const vol24h = pair.volume?.h24 || 0;
      const vol1h = pair.volume?.h1 || 0;
      const age = pair.createdAt 
        ? Math.round((Date.now() - new Date(pair.createdAt).getTime()) / 60000)
        : -1;

      const checks = {
        has_mcap: mcap > 0,
        mcap_in_range: mcap > 500 && mcap < 100000,
        has_liquidity: liq > 0,
        has_volume: vol24h > 0 || vol1h > 0,
        age_valid: age >= 0 && age < 60,
        price_data: pair.priceChange?.h1 !== undefined,
      };

      const passes = Object.values(checks).filter(Boolean).length;

      return {
        symbol: pair.baseToken?.symbol || "?",
        mcap: Math.round(mcap),
        liquidity: Math.round(liq),
        vol24h: Math.round(vol24h),
        age_minutes: age,
        checks,
        passes: passes,
      };
    });

    const stats = {
      total_scanned: pairs.length,
      with_data: diagnostic.filter(d => d.checks.has_mcap).length,
      in_range_100k: diagnostic.filter(d => d.checks.mcap_in_range).length,
      with_volume: diagnostic.filter(d => d.checks.has_volume).length,
      under_60min: diagnostic.filter(d => d.checks.age_valid).length,
    };

    return NextResponse.json({
      chain: chainId,
      stats,
      top_coins: diagnostic.slice(0, 30),
    });
  } catch (err) {
    return NextResponse.json({ error: "Failed" });
  }
}
