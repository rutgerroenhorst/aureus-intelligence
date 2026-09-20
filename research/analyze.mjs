import { readFile } from "node:fs/promises";
const rows = JSON.parse(await readFile("research/sample.json", "utf8"));
const now = Date.now();

const ageH = (r) => (r.pairCreatedAt ? (now - r.pairCreatedAt) / 3600_000 : null);
const txSum = (t) => (t ? (t.buys ?? 0) + (t.sells ?? 0) : 0);
const buyShare = (t) => { const s = txSum(t); return s > 0 ? (t.buys ?? 0) / s : null; };

// ── outcome classification (what actually happened) ──
function classify(r) {
  const liq = r.liquidityUsd ?? 0;
  const h24 = r.ch.h24, h6 = r.ch.h6;
  const v24 = r.vol.h24 ?? 0;
  // DEAD: pool effectively gone, or no trading at all in 24h
  if (liq < 1000 || (v24 < 100 && txSum(r.tx.h24) < 10)) return "DEAD";
  if (h24 == null) return "UNKNOWN";
  if (h24 <= -70) return "COLLAPSED";
  if (h24 <= -25) return "DUMPED";
  if (h24 >= 100) return "RAN_HARD";
  if (h24 >= 25) return "RAN";
  return "FLAT";
}
for (const r of rows) { r.outcome = classify(r); r.ageH = ageH(r); }

const groups = {};
for (const r of rows) (groups[r.outcome] ??= []).push(r);
const order = ["RAN_HARD","RAN","FLAT","DUMPED","COLLAPSED","DEAD","UNKNOWN"];
const med = (a) => { const x = a.filter((v) => v != null && Number.isFinite(v)).sort((p, q) => p - q); return x.length ? x[Math.floor(x.length / 2)] : null; };
const f = (v, d = 0) => (v == null ? "—" : Number(v).toFixed(d));

console.log(`SAMPLE: ${rows.length} live Solana pairs\n`);
console.log("outcome      n    medLiq$   medVol24$  medTx24  medBuySh  medAgeH  medFDV$");
console.log("─".repeat(78));
for (const k of order) {
  const g = groups[k] ?? []; if (!g.length) continue;
  console.log(
    k.padEnd(11),
    String(g.length).padStart(4),
    f(med(g.map((r) => r.liquidityUsd))).padStart(9),
    f(med(g.map((r) => r.vol.h24))).padStart(11),
    f(med(g.map((r) => txSum(r.tx.h24)))).padStart(8),
    f(med(g.map((r) => buyShare(r.tx.h24))), 3).padStart(9),
    f(med(g.map((r) => r.ageH)), 1).padStart(8),
    f(med(g.map((r) => r.fdv))).padStart(10),
  );
}

// ── the operative question: does a feature SEPARATE good from bad? ──
const good = [...(groups.RAN_HARD ?? []), ...(groups.RAN ?? [])];
const bad = [...(groups.DEAD ?? []), ...(groups.COLLAPSED ?? []), ...(groups.DUMPED ?? [])];
console.log(`\nGOOD (ran/ran hard) = ${good.length}   BAD (dumped/collapsed/dead) = ${bad.length}`);

function rate(label, pred) {
  const gp = good.filter(pred).length, bp = bad.filter(pred).length;
  const gAll = good.length, bAll = bad.length;
  const gPct = gAll ? (gp / gAll) * 100 : 0, bPct = bAll ? (bp / bAll) * 100 : 0;
  // precision if we USED this as a filter
  const kept = gp + bp;
  const prec = kept ? (gp / kept) * 100 : 0;
  console.log(
    label.padEnd(40),
    `good ${f(gPct,0)}%`.padStart(10),
    `bad ${f(bPct,0)}%`.padStart(9),
    `lift ${f(gPct - bPct, 0)}pp`.padStart(11),
    `precision ${f(prec,0)}%`.padStart(15),
  );
}
console.log("\nfilter                                     hit-rate in each group           if used as a gate");
console.log("─".repeat(96));
rate("liquidity >= $30k", (r) => (r.liquidityUsd ?? 0) >= 30000);
rate("liquidity >= $100k", (r) => (r.liquidityUsd ?? 0) >= 100000);
rate("liquidity >= $250k", (r) => (r.liquidityUsd ?? 0) >= 250000);
rate("vol24 >= 2x liquidity (real turnover)", (r) => (r.liquidityUsd ?? 0) > 0 && (r.vol.h24 ?? 0) >= 2 * r.liquidityUsd);
rate("vol24 >= $250k", (r) => (r.vol.h24 ?? 0) >= 250000);
rate("tx24 >= 1000", (r) => txSum(r.tx.h24) >= 1000);
rate("buy share h24 >= 0.50", (r) => (buyShare(r.tx.h24) ?? 0) >= 0.5);
rate("buy share h1 >= 0.55", (r) => (buyShare(r.tx.h1) ?? 0) >= 0.55);
rate("h6 change > 0 (trend intact)", (r) => (r.ch.h6 ?? -1) > 0);
rate("age >= 24h (survived a day)", (r) => (r.ageH ?? 0) >= 24);
rate("age >= 168h (survived a week)", (r) => (r.ageH ?? 0) >= 168);
rate("fdv/liq <= 20 (not over-valued vs pool)", (r) => (r.liquidityUsd ?? 0) > 0 && (r.fdv ?? 0) / r.liquidityUsd <= 20);
