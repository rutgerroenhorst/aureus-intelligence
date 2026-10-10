/**
 * Read-only look at what a wallet bought and sold, from its public address only.
 *
 *   WALLET=<address> [DAYS=45] corepack pnpm exec tsx scripts/wallet-scan.ts
 *
 * Prints one line per coin: when it was first bought, dollars in and out, the average price paid, what is still held and where the price
 * stands now. The address is read from the environment and never stored by this script.
 */
import { aggregatePositions, decodeFills, fetchHoldings, fetchSignatures, fetchTransaction, solUsdLookup, WSOL, type Fill } from "../apps/web/lib/wallet";

const wallet = process.env.WALLET;
if (!wallet) {
  console.error("Set WALLET to the public address.");
  process.exit(1);
}
const days = Number(process.env.DAYS ?? 45);
const sinceT = Math.floor(Date.now() / 1000) - days * 86400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmt = (n: number | null | undefined, d = 2) => (n == null || !Number.isFinite(n) ? "-" : n.toFixed(d));
const iso = (t: number | null) => (t ? new Date(t * 1000).toISOString().slice(5, 16).replace("T", " ") : "-");

async function main() {
  const t0 = Date.now();
  const sigs = (await fetchSignatures(wallet!, { sinceT, max: 4000 })).filter((s) => s.err == null);
  console.log(`${sigs.length} successful transactions in the last ${days} days (${iso(sigs.at(-1)?.blockTime ?? null)} .. ${iso(sigs[0]?.blockTime ?? null)})`);
  const solUsd = await solUsdLookup(sinceT);
  const fills: Fill[] = [];
  let swaps = 0;
  let transfers = 0;
  let failed = 0;
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= sigs.length) return;
      const tx = await fetchTransaction(sigs[i]!.signature);
      if (!tx) {
        failed++;
      } else {
        const d = decodeFills(tx, wallet!);
        fills.push(...d.fills);
        swaps += d.swaps.length;
        transfers += d.transfers.length;
      }
      await sleep(120);
      if (i % 50 === 0 && i) console.log(`  ${i}/${sigs.length} read, ${fills.length} fills so far`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  console.log(`read in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${fills.length} buys/sells, ${swaps} coin-for-coin swaps, ${transfers} plain transfers, ${failed} transactions could not be read`);

  const positions = aggregatePositions(fills, solUsd);
  const mints = positions.map((p) => p.mint);
  const meta = new Map<string, { symbol: string; price: number | null; mcap: number | null }>();
  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30);
    try {
      const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${batch.join(",")}`);
      const j: any[] = r.ok ? await r.json() : [];
      for (const p of j) {
        const m = p.baseToken?.address;
        if (m && !meta.has(m)) meta.set(m, { symbol: p.baseToken.symbol, price: Number(p.priceUsd) || null, mcap: Number(p.marketCap ?? p.fdv) || null });
      }
    } catch { /* symbols stay unknown */ }
    await sleep(300);
  }
  const held = await fetchHoldings(wallet!);
  console.log(`\nholdings now (Jupiter): ${held ? [...held.entries()].map(([m, a]) => `${m === WSOL ? "SOL" : (meta.get(m)?.symbol ?? m.slice(0, 5))} ${fmt(a, 4)}`).join(", ") : "unknown"}\n`);
  console.log("coin        first buy    buys sells   $in     $out    avg entry $     now $      held(chain)  now/entry  realized$");
  for (const p of positions) {
    const m = meta.get(p.mint);
    const chain = held?.get(p.mint) ?? 0;
    const mult = m?.price && p.avgEntryUsd ? m.price / p.avgEntryUsd : null;
    console.log(
      `${(m?.symbol ?? p.mint.slice(0, 6)).slice(0, 10).padEnd(11)} ${iso(p.firstBuyAt).padEnd(12)} ${String(p.buys).padStart(3)} ${String(p.sells).padStart(4)} ${fmt(p.usdIn).padStart(7)} ${fmt(p.usdOut).padStart(8)} ${fmt(p.avgEntryUsd, 8).padStart(14)} ${fmt(m?.price ?? null, 8).padStart(12)} ${fmt(chain, 2).padStart(12)} ${fmt(mult, 2).padStart(9)}  ${fmt(p.realizedUsd).padStart(8)}`,
    );
  }
  const tin = positions.reduce((a, p) => a + p.usdIn, 0);
  const tout = positions.reduce((a, p) => a + p.usdOut, 0);
  // what is still held, at today's price (a coin without a price counts as worth nothing)
  let now = 0;
  let priced = 0;
  const open: Array<{ sym: string; value: number; cost: number; mult: number | null }> = [];
  for (const p of positions) {
    const m = meta.get(p.mint);
    const chain = held?.get(p.mint) ?? 0;
    const value = m?.price ? chain * m.price : 0;
    if (chain > 0) {
      now += value;
      if (m?.price) priced++;
      const costShare = p.tokensBought > 0 ? p.usdIn * Math.min(1, chain / p.tokensBought) : 0;
      open.push({ sym: m?.symbol ?? p.mint.slice(0, 6), value, cost: costShare, mult: m?.price && p.avgEntryUsd ? m.price / p.avgEntryUsd : null });
    }
  }
  console.log(`\ntotal in $${fmt(tin)}  out (sells) $${fmt(tout)}  value of what is still held $${fmt(now)} (${priced} of ${open.length} held coins have a price)  => net $${fmt(tout + now - tin)}`);
  const ms = positions.map((p) => (meta.get(p.mint)?.price && p.avgEntryUsd ? meta.get(p.mint)!.price! / p.avgEntryUsd : null)).filter((x): x is number => x != null);
  console.log(`of ${ms.length} priced coins: ${ms.filter((x) => x >= 1).length} above entry, ${ms.filter((x) => x >= 2).length} at 2x or more, ${ms.filter((x) => x < 0.5).length} below half, ${ms.filter((x) => x < 0.1).length} below a tenth`);
  console.log("biggest values now:", open.sort((a, b) => b.value - a.value).slice(0, 8).map((o) => `${o.sym} $${fmt(o.value)} (cost ~$${fmt(o.cost)}, ${fmt(o.mult)}x)`).join("; "));
}
main().catch((e) => { console.error(e); process.exit(1); });
