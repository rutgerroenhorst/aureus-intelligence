/**
 * Is the best way out different for different kinds of coins (narrative, how it was found, how old its pool was), or is one simple rule as good everywhere?
 * And what does a second level at 5x add to "half out at 2x"?
 *
 *   corepack pnpm exec tsx scripts/lab-exit-segments.ts
 *
 * Written down BEFORE looking, like the rest of the lab:
 *  - the coins are the lab's coins whose whole 72 hours were seen, each entered at the first look (what the Radar offers), exactly as scripts/lab-exit-rules.ts;
 *  - the rules are the fixed list below (stops and trails fill at the price read, resting sells at their level, 5% cost on what is sold: every number is a ceiling,
 *    the comparison between rules is the point);
 *  - the segments are the narrative tag of the coin's name (lib/lab/narrative.ts: ai_agent, tool, animal, person, other), how the lab found the coin (the
 *    "via:" tag), the lab's lane, the age of the pool at the first look and the size of the pool and of the market cap at the first look (thirds of the coins);
 *    a segment needs 30 coins. (candidates.discovered_at is the pool's creation time, not the first look: the first look is lab_coins.first_seen_at.)
 *  - the test of "is the best rule different here": the rule that is best in a segment on the EARLIER 60% of the coins (by first-seen time) is applied to the
 *    LATER 40% of that segment and compared, coin by coin, with the one rule that was best overall on the earlier 60%. A segment-specific choice that does not beat
 *    the global one on later coins is not evidence of a difference (the lab's bar: 30 per group and the same direction on later coins).
 * Prints counts, means and 90% bootstrap intervals (resampling coins). Never prints an address.
 */
import pg from "pg";
import { loadObs, selectCandidates, selectWatch } from "../apps/web/lib/lab/builder";
import { cleanObs, ladderNet, type LadderOpts } from "../apps/web/lib/lab/paths";
import { forwardLabels } from "../apps/web/lib/lab/outcomes";
import { primaryTag, tagsFor } from "../apps/web/lib/lab/narrative";
import { rng } from "../apps/web/lib/lab/stats";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://aureus:aureus@localhost:5432/aureus", max: 2, statement_timeout: 300_000 });

const RULES: Array<[string, Partial<LadderOpts>]> = [
  ["hold 72 h", { ladder: [], stop: 0 }],
  ["stop -50%", { ladder: [], stop: 0.5 }],
  ["all out at 1.5x", { ladder: [[1.5, 1]] }],
  ["all out at 2x", { ladder: [[2, 1]] }],
  ["all out at 3x", { ladder: [[3, 1]] }],
  ["all out at 5x", { ladder: [[5, 1]] }],
  ["half at 2x, trail 40%", { ladder: [[2, 0.5]] }],
  ["half at 2x, no trail", { ladder: [[2, 0.5]], trail: 1 }],
  ["half at 2x, rest at 5x", { ladder: [[2, 0.5], [5, 0.5]] }],
  ["third at 2x, third at 5x, trail 40%", { ladder: [[2, 1 / 3], [5, 1 / 3]] }],
  ["quarters at 2x/5x/10x, trail 40% (example plan)", {}],
  ["half at 3x, trail 40%", { ladder: [[3, 0.5]] }],
  ["half at 2x, trail 25%", { ladder: [[2, 0.5]], trail: 0.25 }],
  ["half at 2x, trail 55%", { ladder: [[2, 0.5]], trail: 0.55 }],
  ["tight: stop -30%, half at 2x, trail 30%", { stop: 0.7, ladder: [[2, 0.5]], trail: 0.3 }],
];

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const pct = (m: number) => `${((m - 1) * 100).toFixed(0)}%`.padStart(5);

/** Mean of paired differences with a 90% bootstrap interval (resampling coins). */
function pairedBoot(diffs: number[], B = 1000, seed = 7): { mean: number; lo: number; hi: number } {
  const n = diffs.length;
  if (!n) return { mean: NaN, lo: NaN, hi: NaN };
  const rand = rng(seed);
  const ms: number[] = [];
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += diffs[Math.floor(rand() * n)]!;
    ms.push(s / n);
  }
  ms.sort((x, y) => x - y);
  return { mean: mean(diffs), lo: ms[Math.floor(0.05 * B)]!, hi: ms[Math.min(B - 1, Math.floor(0.95 * B))]! };
}
const ci = (d: { mean: number; lo: number; hi: number }) => `${(d.mean * 100).toFixed(0).padStart(4)} pts [${(d.lo * 100).toFixed(0)}, ${(d.hi * 100).toFixed(0)}]`;

function spearman(a: number[], b: number[]): number {
  const rank = (v: number[]) => {
    const o = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(v.length);
    o.forEach(([, i], k) => (r[i] = k));
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const d2 = ra.reduce((s, x, i) => s + (x - rb[i]!) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

interface Row {
  t: number;
  narrative: string;
  lane: string;
  found: string;
  age: string;
  liq: number | null;
  mcap: number | null;
  peak: number;
  net: number[];
}

const ageBucket = (h: number | null) => (h == null ? "unknown" : h < 1 ? "pool < 1 h" : h < 6 ? "pool 1-6 h" : h < 24 ? "pool 6-24 h" : "pool >= 24 h");
/** Which third of the coins a value is in (by the thresholds of all coins that have one). */
function thirds(values: Array<number | null>): (v: number | null) => string {
  const s = values.filter((x): x is number => x != null && x > 0).sort((a, b) => a - b);
  const lo = s[Math.floor(s.length / 3)]!;
  const hi = s[Math.floor((2 * s.length) / 3)]!;
  return (v) => (v == null || !(v > 0) ? "unknown" : v < lo ? "small" : v < hi ? "middle" : "large");
}

async function main() {
  const cands = [...(await selectCandidates(pool, { limit: 1_000_000, all: true })), ...(await selectWatch(pool, { limit: 1_000_000, all: true }))];
  // what the lab knew at the first look
  const first = new Map<string, { lane: string | null; seen: number | null; created: number | null; liq: number | null; mcap: number | null; tags: string[] }>();
  for (const r of (await pool.query(`SELECT mint, lane, EXTRACT(EPOCH FROM first_seen_at)::float8 AS seen, EXTRACT(EPOCH FROM pair_created_at)::float8 AS created, first_liq::float8 AS liq, first_mcap::float8 AS mcap, tags FROM lab_coins`)).rows) {
    first.set(r.mint, { lane: r.lane, seen: r.seen, created: r.created, liq: r.liq, mcap: r.mcap, tags: Array.isArray(r.tags) ? r.tags : [] });
  }
  const rows: Row[] = [];
  for (let b = 0; b < cands.length; b += 40) {
    const batch = cands.slice(b, b + 40);
    const obs = await loadObs(pool, batch);
    for (const c of batch) {
      const { clean } = cleanObs(obs.get(c.pool_id) ?? []);
      if (clean.length < 3) continue;
      const y = forwardLabels(clean, 0, { rule: "auto" });
      if (!y || y.go2 == null || y.ev == null) continue; // the whole window must have been seen
      const f = first.get(c.mint);
      const seen = f?.seen ?? c.discovered_at;
      const created = f?.created ?? c.pool_created;
      rows.push({
        t: seen,
        narrative: primaryTag(tagsFor(c.name, c.symbol)),
        lane: f?.lane ?? c.lane ?? "fresh",
        found: f?.tags.find((x) => x.startsWith("via:"))?.slice(4) ?? "radar",
        age: ageBucket(created != null ? (seen - created) / 3600 : null),
        liq: f?.liq ?? null,
        mcap: f?.mcap ?? null,
        peak: y.peak72,
        net: RULES.map(([, o]) => ladderNet(clean, 0, o) ?? 0),
      });
    }
  }
  rows.sort((a, b) => a.t - b.t);
  const n = rows.length;
  console.log(`${n} coins entered at the first look, whole 72 hours seen (of ${cands.length} with a path), first look ${new Date(rows[0]!.t * 1000).toISOString().slice(0, 10)} to ${new Date(rows[n - 1]!.t * 1000).toISOString().slice(0, 10)}\n`);

  // ---- 1. how far do coins run: the ladder of levels
  const reached = (m: number) => rows.filter((r) => r.peak >= m).length;
  console.log("== How far the coins ran (highest level held for about half an hour within 72 h)");
  for (const m of [1.5, 2, 3, 5, 10, 20]) console.log(`  reached ${String(m).padStart(4)}x: ${String(reached(m)).padStart(4)} of ${n} (${((100 * reached(m)) / n).toFixed(1)}%)`);
  const r2 = reached(2);
  console.log(`  of the coins that reached 2x: ${((100 * reached(3)) / r2).toFixed(0)}% reached 3x, ${((100 * reached(5)) / r2).toFixed(0)}% reached 5x, ${((100 * reached(10)) / r2).toFixed(0)}% reached 10x`);
  const gains = rows.map((r) => r.net[0]! - 1).sort((a, b) => b - a); // hold 72 h
  const pos = gains.filter((g) => g > 0).reduce((s, g) => s + g, 0);
  const top = gains.slice(0, Math.max(1, Math.round(n * 0.05))).filter((g) => g > 0).reduce((s, g) => s + g, 0);
  console.log(`  holding for 72 h: the best 5% of coins (${Math.round(n * 0.05)}) make ${((100 * top) / pos).toFixed(0)}% of all the gains there are\n`);

  // ---- 2. every rule over all coins
  console.log("== Every rule, all coins (mean net multiple after costs; interval = 90% bootstrap of the mean)");
  const base = rows.map((r) => r.net[10]!); // the example plan
  RULES.forEach(([name], k) => {
    const v = rows.map((r) => r.net[k]!);
    const d = pairedBoot(v.map((x, i) => x - base[i]!));
    const ended1 = (100 * v.filter((x) => x >= 1).length) / n;
    const big = rows.filter((r) => r.peak >= 5);
    const kept = mean(big.map((r) => r.net[k]!)) / mean(big.map((r) => r.peak));
    console.log(`  ${name.padEnd(50)} mean ${pct(mean(v))}   ended >= 1x ${ended1.toFixed(0).padStart(3)}%   on the 5x+ coins it keeps ${(kept * 100).toFixed(0).padStart(3)}% of the peak   vs example plan ${ci(d)}`);
  });

  // ---- 3. the second level at 5x
  const kHalf = 6; // half at 2x, trail 40%
  const kHalf5 = 8; // half at 2x, rest at 5x
  const kThird = 9; // third, third, trail
  const kAll2 = 3;
  console.log("\n== What each part of a plan adds (paired, same coins; mean difference in points of the stake, 90% interval)");
  for (const [label, a, b] of [
    ["third at 2x + third at 5x  minus  half at 2x (trail 40%)", kThird, kHalf],
    ["half at 2x + rest at 5x  minus  half at 2x (trail 40%)", kHalf5, kHalf],
    ["half at 2x (trail 40%)  minus  all out at 2x", kHalf, kAll2],
    ["half at 2x (trail 40%)  minus  half at 2x (no trail)", kHalf, 7],
    ["half at 2x (trail 40%)  minus  hold 72 h", kHalf, 0],
    ["half at 2x (trail 25%)  minus  half at 2x (trail 40%)", 12, kHalf],
    ["half at 2x (trail 55%)  minus  half at 2x (trail 40%)", 13, kHalf],
  ] as Array<[string, number, number]>) console.log(`  ${label.padEnd(62)} ${ci(pairedBoot(rows.map((r) => r.net[a]! - r.net[b]!)))}`);

  // ---- 4. segments
  const segs: Array<[string, (r: Row) => string]> = [
    ["narrative", (r) => r.narrative],
    ["found via", (r) => r.found],
    ["lane", (r) => r.lane],
    ["pool age at first look", (r) => r.age],
    ["pool size at first look", ((f) => (r: Row) => f(r.liq))(thirds(rows.map((r) => r.liq)))],
    ["market cap at first look", ((f) => (r: Row) => f(r.mcap))(thirds(rows.map((r) => r.mcap)))],
  ];
  console.log("\n== How far each kind of coin runs (share of its coins that reached the level within 72 h)");
  for (const label of [...new Set(rows.map((r) => r.narrative))].sort()) {
    const g = rows.filter((r) => r.narrative === label);
    const sh = (m: number) => `${((100 * g.filter((r) => r.peak >= m).length) / g.length).toFixed(0).padStart(3)}%`;
    console.log(`  ${label.padEnd(9)} n ${String(g.length).padStart(4)}   2x ${sh(2)}   3x ${sh(3)}   5x ${sh(5)}   10x ${sh(10)}${g.length < 30 ? "   (under 30 coins)" : ""}`);
  }
  const globalMeans = RULES.map((_, k) => mean(rows.map((r) => r.net[k]!)));
  console.log("\n== Rules by segment (mean net multiple; * = best in the segment; rank agreement = Spearman correlation of the segment's rule ranking with the overall ranking)");
  console.log("  " + "segment".padEnd(26) + "n".padStart(5) + "  " + RULES.map((_, k) => `R${k + 1}`.padStart(5)).join("") + "   best rule   rank agreement");
  const bySeg: Array<{ dim: string; label: string; idx: number[] }> = [];
  for (const [dim, f] of segs) {
    const labels = [...new Set(rows.map(f))].sort();
    for (const label of labels) {
      const idx = rows.map((r, i) => (f(r) === label ? i : -1)).filter((i) => i >= 0);
      bySeg.push({ dim, label, idx });
      if (idx.length < 30) {
        console.log(`  ${(dim + ": " + label).padEnd(26)}${String(idx.length).padStart(5)}  (under 30 coins: not read)`);
        continue;
      }
      const means = RULES.map((_, k) => mean(idx.map((i) => rows[i]!.net[k]!)));
      const best = means.indexOf(Math.max(...means));
      console.log(`  ${(dim + ": " + label).padEnd(26)}${String(idx.length).padStart(5)}  ${means.map((m, k) => (pct(m).trim() + (k === best ? "*" : "")).padStart(5)).join("")}   R${best + 1}   ${spearman(means, globalMeans).toFixed(2)}`);
    }
  }
  console.log("\n  rules: " + RULES.map(([name], k) => `R${k + 1} ${name}`).join("; "));

  // ---- 5. the out-of-sample test
  const cut = Math.floor(n * 0.6);
  const train = rows.slice(0, cut);
  const test = rows.slice(cut);
  const trainMeans = RULES.map((_, k) => mean(train.map((r) => r.net[k]!)));
  const globalBest = trainMeans.indexOf(Math.max(...trainMeans));
  console.log(`\n== Out of sample: rules chosen on the earlier ${train.length} coins, judged on the later ${test.length}`);
  console.log(`  the one best rule overall on the earlier coins: R${globalBest + 1} ${RULES[globalBest]![0]} (mean ${pct(trainMeans[globalBest]!)} there, ${pct(mean(test.map((r) => r.net[globalBest]!)))} on the later coins)`);
  const testMeans = RULES.map((_, k) => mean(test.map((r) => r.net[k]!)));
  const hindsight = testMeans.indexOf(Math.max(...testMeans));
  console.log(`  for contrast, in hindsight the best rule on the later coins is R${hindsight + 1} ${RULES[hindsight]![0]} (mean ${pct(testMeans[hindsight]!)}); every rule did about ${((mean(trainMeans) - mean(testMeans)) * 100).toFixed(0)} points worse on the later coins than on the earlier ones`);
  let better = 0;
  let worse = 0;
  let read = 0;
  for (const s of bySeg) {
    const tr = s.idx.filter((i) => i < cut);
    const te = s.idx.filter((i) => i >= cut);
    if (tr.length < 30 || te.length < 15) continue;
    read++;
    const m = RULES.map((_, k) => mean(tr.map((i) => rows[i]!.net[k]!)));
    const segBest = m.indexOf(Math.max(...m));
    const d = pairedBoot(te.map((i) => rows[i]!.net[segBest]! - rows[i]!.net[globalBest]!));
    const verdict = segBest === globalBest ? "same rule" : d.lo > 0 ? "BETTER than the global rule" : d.hi < 0 ? "WORSE than the global rule" : "no difference";
    if (segBest !== globalBest) (d.lo > 0 ? better++ : d.hi < 0 && worse++);
    console.log(`  ${(s.dim + ": " + s.label).padEnd(26)} earlier ${String(tr.length).padStart(4)} / later ${String(te.length).padStart(4)}: best on the earlier coins R${segBest + 1}; on the later coins it is ${ci(d)} against the global rule: ${verdict}`);
  }
  console.log(`\n  ${read} segments read; a segment's own best rule beat the global one on later coins in ${better}, was worse in ${worse}.`);
}

main()
  .catch((e) => {
    console.error(String((e as Error)?.message ?? e).replace(/postgres(ql)?:\/\/\S+/g, "postgres://***"));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
