import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CHAINS = {
  solana: "solana",
  ethereum: "ethereum", 
  base: "base",
  arbitrum: "arbitrum",
  optimism: "optimism",
  polygon: "polygon",
};

async function fetchDexScreenerTrending(chainId: string) {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${chainId}`,
      { next: { revalidate: 0 } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data || [];
  } catch (e) {
    return [];
  }
}

function calculateScore(pair: any, chain: string): number {
  let score = 0;
  
  const mcap = pair.marketCap || 0;
  const liq = pair.liquidity?.usd || 0;
  const vol24h = pair.volume?.h24 || 0;
  const vol1h = pair.volume?.h1 || 0;
  const priceChange1h = pair.priceChange?.h1 || 0;

  // MCAP (0-20)
  if (mcap > 1000 && mcap < 50000) score += 20;
  else if (mcap > 50000 && mcap < 100000) score += 15;
  else if (mcap >= 100000 && mcap < 500000) score += 10;

  // VOLUME (0-25)
  if (vol1h > 5000) score += 25;
  else if (vol1h > 2000) score += 20;
  else if (vol1h > 1000) score += 15;
  else if (vol1h > 500) score += 10;
  else if (vol24h > 10000) score += 15;
  else if (vol24h > 5000) score += 10;
  else if (vol24h > 1000) score += 5;

  // LIQUIDITY (0-20)
  const liqRatio = mcap > 0 ? liq / mcap : 0;
  if (liqRatio > 0.20) score += 20;
  else if (liqRatio > 0.15) score += 18;
  else if (liqRatio > 0.10) score += 15;
  else if (liqRatio > 0.05) score += 10;
  else if (liqRatio > 0.02) score += 5;

  // PRICE ACTION (0-20)
  if (priceChange1h > 100) score += 20;
  else if (priceChange1h > 50) score += 18;
  else if (priceChange1h > 20) score += 15;
  else if (priceChange1h > 10) score += 10;
  else if (priceChange1h > 5) score += 8;
  else if (priceChange1h > 0) score += 4;

  // CHAIN BONUS
  if (chain === "solana") score += 5;

  return Math.min(score, 100);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const selectedChain = searchParams.get("chain");

    const chainsToScan = selectedChain && CHAINS[selectedChain as keyof typeof CHAINS]
      ? { [selectedChain]: CHAINS[selectedChain as keyof typeof CHAINS] }
      : CHAINS;

    const allCoins: any[] = [];

    const chainResults = await Promise.all(
      Object.entries(chainsToScan).map(async ([chainKey, chainId]) => {
        const pairs = await fetchDexScreenerTrending(chainId);
        const scored = pairs
          .map((pair: any) => ({
            ...pair,
            cateChain: chainKey,
            cateScore: calculateScore(pair, chainKey),
          }))
          .filter((p: any) => p.cateScore >= 30)
          .sort((a: any, b: any) => b.cateScore - a.cateScore);

        return scored;
      })
    );

    chainResults.forEach((coins) => {
      allCoins.push(...coins);
    });

    const sorted = allCoins.sort((a, b) => b.cateScore - a.cateScore);

    const summary = {
      elite: sorted.filter((c: any) => c.cateScore >= 80).length,
      hot: sorted.filter((c: any) => c.cateScore >= 60 && c.cateScore < 80).length,
      rising: sorted.filter((c: any) => c.cateScore >= 45 && c.cateScore < 60).length,
      watch: sorted.filter((c: any) => c.cateScore >= 30 && c.cateScore < 45).length,
      total: sorted.length,
    };

    return NextResponse.json({
      coins: sorted.slice(0, 100),
      summary,
    });
  } catch (err) {
    return NextResponse.json({ coins: [], summary: {} });
  }
}
