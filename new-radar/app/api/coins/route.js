// Mock Solana coin data
const MOCK_COINS = [
  {
    mint: "EPjFWaLb3hyccqaB3JhrikREsNiYkn6nSG7L5yUdc5gJ",
    symbol: "USDC",
    marketCapUsd: 28000000,
    liquidityUsd: 15000000,
    volumeUsd: 450000,
    qualified: true,
  },
  {
    mint: "Es9zKXVn2FB63qwVV2DHbw3JwYcwtkTg3ynem3YcDBcP",
    symbol: "USDT",
    marketCapUsd: 32000000,
    liquidityUsd: 18000000,
    volumeUsd: 520000,
    qualified: true,
  },
  {
    mint: "8upjSpvds75w2ZCpEMkK89r1H6EwwxtPD7YDU8kqWQj8",
    symbol: "COPE",
    marketCapUsd: 45000,
    liquidityUsd: 12000,
    volumeUsd: 8500,
    qualified: true,
  },
  {
    mint: "PRT8J7TCoYKBr7SRfVviBcEeQoGMnF2XnVPXHXM6jYq",
    symbol: "PRTG",
    marketCapUsd: 75000,
    liquidityUsd: 22000,
    volumeUsd: 15200,
    qualified: true,
  },
  {
    mint: "CvB1b3ZDd8H9rnrndqTrFkFPiBKMkB7ADB8fPUvd7aKJ",
    symbol: "SMOG",
    marketCapUsd: 120000,
    liquidityUsd: 35000,
    volumeUsd: 45000,
    qualified: true,
  },
  {
    mint: "A9mUU4qviSctJVPgeTDZH92c8kxwqKtuzzrWUNNawQe",
    symbol: "BONK",
    marketCapUsd: 250000,
    liquidityUsd: 75000,
    volumeUsd: 125000,
    qualified: true,
  },
];

export async function GET() {
  // Simulate real-time data with small random changes
  const coins = MOCK_COINS.map((coin) => ({
    ...coin,
    marketCapUsd: Math.round(coin.marketCapUsd * (0.95 + Math.random() * 0.1)),
    liquidityUsd: Math.round(coin.liquidityUsd * (0.95 + Math.random() * 0.1)),
    volumeUsd: Math.round(coin.volumeUsd * (0.8 + Math.random() * 0.4)),
  }));

  return Response.json({
    coins,
    timestamp: new Date().toISOString(),
    status: "live",
  });
}
