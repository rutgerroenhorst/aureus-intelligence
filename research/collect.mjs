/**
 * Collect a broad sample of live Solana pairs from Dexscreener for outcome study.
 * Read-only public API. Saves raw snapshots to research/sample.json.
 */
const OUT = "research/sample.json";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seen = new Map();

async function j(url) {
  try {
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function add(p) {
  if (!p || p.chainId !== "solana" || !p.pairAddress) return;
  if (seen.has(p.pairAddress)) return;
  seen.set(p.pairAddress, {
    pair: p.pairAddress, mint: p.baseToken?.address, symbol: p.baseToken?.symbol,
    dex: p.dexId, pairCreatedAt: p.pairCreatedAt ?? null,
    priceUsd: p.priceUsd ? Number(p.priceUsd) : null,
    liquidityUsd: p.liquidity?.usd ?? null,
    fdv: p.fdv ?? null, marketCap: p.marketCap ?? null,
    ch: { m5: p.priceChange?.m5 ?? null, h1: p.priceChange?.h1 ?? null, h6: p.priceChange?.h6 ?? null, h24: p.priceChange?.h24 ?? null },
    vol: { m5: p.volume?.m5 ?? null, h1: p.volume?.h1 ?? null, h6: p.volume?.h6 ?? null, h24: p.volume?.h24 ?? null },
    tx: {
      m5: p.txns?.m5 ?? null, h1: p.txns?.h1 ?? null, h6: p.txns?.h6 ?? null, h24: p.txns?.h24 ?? null,
    },
    collectedAt: Date.now(),
  });
}

// 1) diverse search terms — broadens beyond promoted tokens
const TERMS = ["SOL","pump","cat","dog","AI","moon","elon","trump","pepe","wif","bonk","inu",
  "baby","gold","meme","coin","fun","king","rich","chad","wojak","frog","bull","bear","sun",
  "star","fire","rocket","god","cash","x","meta","zero","one","alpha","omega","neko","shiba"];
for (const t of TERMS) {
  const d = await j(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(t)}`);
  (d?.pairs ?? []).forEach(add);
  await sleep(220);
  if (seen.size >= 400) break;
}
console.error(`after search: ${seen.size}`);

// 2) recent token profiles + boosts → freshly launched pairs (the ones that matter most)
for (const url of [
  "https://api.dexscreener.com/token-profiles/latest/v1",
  "https://api.dexscreener.com/token-boosts/latest/v1",
  "https://api.dexscreener.com/token-boosts/top/v1",
]) {
  const list = await j(url);
  const sol = (Array.isArray(list) ? list : []).filter((x) => x.chainId === "solana").map((x) => x.tokenAddress).filter(Boolean);
  for (let i = 0; i < sol.length; i += 30) {
    const batch = sol.slice(i, i + 30).join(",");
    const d = await j(`https://api.dexscreener.com/latest/dex/tokens/${batch}`);
    (d?.pairs ?? []).forEach(add);
    await sleep(250);
  }
  console.error(`after ${url.split("/").slice(-2)[0]}: ${seen.size}`);
}

const rows = [...seen.values()];
await (await import("node:fs/promises")).writeFile(OUT, JSON.stringify(rows, null, 0));
console.error(`SAVED ${rows.length} pairs -> ${OUT}`);
