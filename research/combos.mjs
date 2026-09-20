import { readFile } from "node:fs/promises";
const rows = JSON.parse(await readFile("research/sample.json", "utf8"));
const now = Date.now();
const txSum = (t) => (t ? (t.buys ?? 0) + (t.sells ?? 0) : 0);
const buyShare = (t) => { const s = txSum(t); return s > 0 ? (t.buys ?? 0) / s : null; };
for (const r of rows) {
  r.ageH = r.pairCreatedAt ? (now - r.pairCreatedAt) / 3600_000 : null;
  const liq = r.liquidityUsd ?? 0, h24 = r.ch.h24, v24 = r.vol.h24 ?? 0;
  r.outcome = (liq < 1000 || (v24 < 100 && txSum(r.tx.h24) < 10)) ? "DEAD"
    : h24 == null ? "UNKNOWN" : h24 <= -70 ? "COLLAPSED" : h24 <= -25 ? "DUMPED"
    : h24 >= 100 ? "RAN_HARD" : h24 >= 25 ? "RAN" : "FLAT";
}
const usable = rows.filter((r) => r.outcome !== "UNKNOWN");
const good = usable.filter((r) => r.outcome === "RAN" || r.outcome === "RAN_HARD");
const bad = usable.filter((r) => ["DEAD","COLLAPSED","DUMPED"].includes(r.outcome));
const f = (v, d = 0) => (v == null ? "—" : Number(v).toFixed(d));

function ev(label, pred) {
  const kept = usable.filter(pred);
  const kg = kept.filter((r) => good.includes(r)).length;
  const kb = kept.filter((r) => bad.includes(r)).length;
  const prec = kept.length ? (kg / kept.length) * 100 : 0;
  const recall = good.length ? (kg / good.length) * 100 : 0;
  const badKept = bad.length ? (kb / bad.length) * 100 : 0;
  console.log(label.padEnd(52), `kept ${String(kept.length).padStart(3)}`,
    `prec ${f(prec,0).padStart(3)}%`, `recall ${f(recall,0).padStart(3)}%`,
    `bad-let-through ${f(badKept,0).padStart(2)}%`);
}
console.log(`usable ${usable.length} | good ${good.length} | bad ${bad.length} | base rate ${f(good.length/usable.length*100,1)}%\n`);
console.log("GATE                                                 kept  precision  recall  bad leak");
console.log("─".repeat(96));
ev("(baseline: accept everything)", () => true);
const liveVol = (r) => (r.vol.h24 ?? 0) >= 250000;
const liq30 = (r) => (r.liquidityUsd ?? 0) >= 30000;
const turnover = (r) => (r.liquidityUsd ?? 0) > 0 && (r.vol.h24 ?? 0) >= 2 * r.liquidityUsd;
const trend = (r) => (r.ch.h6 ?? -1) > 0;
const fdvOk = (r) => (r.liquidityUsd ?? 0) > 0 && (r.fdv ?? 0) / r.liquidityUsd <= 20;
const buys = (r) => (buyShare(r.tx.h24) ?? 0) >= 0.5;
const young = (r) => (r.ageH ?? 1e9) <= 72;

ev("vol24 >= $250k", liveVol);
ev("vol24>=250k + liq>=30k", (r) => liveVol(r) && liq30(r));
ev("vol24>=250k + liq>=30k + h6>0", (r) => liveVol(r) && liq30(r) && trend(r));
ev("vol24>=250k + liq>=30k + h6>0 + fdv/liq<=20", (r) => liveVol(r) && liq30(r) && trend(r) && fdvOk(r));
ev("+ buyShare>=0.5", (r) => liveVol(r) && liq30(r) && trend(r) && fdvOk(r) && buys(r));
ev("+ age<=72h", (r) => liveVol(r) && liq30(r) && trend(r) && fdvOk(r) && buys(r) && young(r));
ev("turnover>=2x + liq>=30k + h6>0 + fdv ok", (r) => turnover(r) && liq30(r) && trend(r) && fdvOk(r));

console.log("\n── EXCLUSION view: what does rejecting the obvious junk cost? ──");
ev("EXCLUDE dead-ish (vol24<$1k or liq<$5k)", (r) => !((r.vol.h24 ?? 0) < 1000 || (r.liquidityUsd ?? 0) < 5000));
ev("EXCLUDE fdv/liq > 50 (paper valuation)", (r) => !((r.liquidityUsd ?? 0) > 0 && (r.fdv ?? 0) / r.liquidityUsd > 50));
ev("EXCLUDE both of the above", (r) => !((r.vol.h24 ?? 0) < 1000 || (r.liquidityUsd ?? 0) < 5000)
  && !((r.liquidityUsd ?? 0) > 0 && (r.fdv ?? 0) / r.liquidityUsd > 50));

console.log("\n── are 'winners' just momentum already spent? (h6 vs h24 shape) ──");
for (const k of ["RAN_HARD","RAN","DUMPED","COLLAPSED"]) {
  const g = usable.filter((r) => r.outcome === k);
  const stillUp = g.filter((r) => (r.ch.h6 ?? 0) > 0).length;
  const m5up = g.filter((r) => (r.ch.m5 ?? 0) > 0).length;
  console.log(`${k.padEnd(11)} n=${String(g.length).padStart(3)}  h6 still up: ${f(stillUp/g.length*100,0)}%   m5 up: ${f(m5up/g.length*100,0)}%`);
}
