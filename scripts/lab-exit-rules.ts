/**
 * Which simple exit rule would have kept the most of what the coins offered? Every rule is run on the same readings, entering at the
 * first look (what the Radar offers), for every coin whose whole 72-hour window was seen. The rules are fixed here in advance.
 *
 *   corepack pnpm exec tsx scripts/lab-exit-rules.ts
 *
 * Costs are the lab's (5% on what is sold). Stops and trailing stops fill at the price actually read, which is kinder than a thin pool
 * is to a falling coin; resting sells fill at their level. So every number is a ceiling, and the comparison between rules is the point.
 */
import pg from "pg";
import { loadObs, selectCandidates, selectWatch } from "../apps/web/lib/lab/builder";
import { cleanObs, ladderNet, type LadderOpts } from "../apps/web/lib/lab/paths";
import { forwardLabels } from "../apps/web/lib/lab/outcomes";
import { bootDiffCi } from "../apps/web/lib/lab/stats";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://aureus:aureus@localhost:5432/aureus", max: 2, statement_timeout: 300_000 });

const RULES: Array<[string, Partial<LadderOpts>]> = [
  ["hold 72 h, no stop, no sale", { ladder: [], stop: 0 }],
  ["stop at -50%, no sale", { ladder: [], stop: 0.5 }],
  ["the example plan: 1/4 at 2x, 5x, 10x; stop -50%; trail 40%", {}],
  ["take half at 2x; stop -50%; trail 40% on the rest", { ladder: [[2, 0.5]] }],
  ["sell all at 2x; stop -50%", { ladder: [[2, 1]] }],
  ["sell all at 3x; stop -50%", { ladder: [[3, 1]] }],
  ["tight: stop -30%; half at 2x; trail 30%", { stop: 0.7, ladder: [[2, 0.5]], trail: 0.3 }],
  ["thirds: 1/3 at 2x, 1/3 at 4x, trail 40% on the rest", { ladder: [[2, 1 / 3], [4, 1 / 3]] }],
  ["your pattern on HOTBOT: ~21/14/13/13% at 1.8/2.6/2.8/3.0x, trail 40%", { ladder: [[1.8, 0.21], [2.6, 0.14], [2.8, 0.13], [3.0, 0.13]] }],
];

async function main() {
  const cands = [...(await selectCandidates(pool, { limit: 1_000_000, all: true })), ...(await selectWatch(pool, { limit: 1_000_000, all: true }))];
  const res: number[][] = RULES.map(() => []);
  const peaks: number[] = [];
  let used = 0;
  for (let b = 0; b < cands.length; b += 40) {
    const batch = cands.slice(b, b + 40);
    const obs = await loadObs(pool, batch);
    for (const c of batch) {
      const { clean } = cleanObs(obs.get(c.pool_id) ?? []);
      if (clean.length < 3) continue;
      const y = forwardLabels(clean, 0, { rule: "auto" });
      if (!y || y.go2 == null || y.ev == null) continue; // the whole window must have been seen
      used++;
      peaks.push(y.peak72);
      RULES.forEach(([, o], k) => {
        const r = ladderNet(clean, 0, o);
        res[k]!.push(r ?? 0);
      });
    }
  }
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
  console.log(`${used} coins entered at the first look, whole 72 hours seen (of ${cands.length} with a path)`);
  const big = peaks.map((p, i) => (p >= 5 ? i : -1)).filter((i) => i >= 0);
  console.log(`${big.length} of them reached 5x or more at some point (held for ~30 minutes)\n`);
  console.log("rule".padEnd(74) + "mean".padStart(7) + "median".padStart(8) + "  ended >=1x".padStart(12) + "  on the 5x+ coins: kept of the peak");
  RULES.forEach(([name], k) => {
    const a = res[k]!;
    const keptBig = big.length ? mean(big.map((i) => a[i]!)) / mean(big.map((i) => peaks[i]!)) : NaN;
    console.log(`${name.padEnd(74)}${((mean(a) - 1) * 100).toFixed(0).padStart(6)}%${((med(a) - 1) * 100).toFixed(0).padStart(7)}%${((100 * a.filter((x) => x >= 1).length) / a.length).toFixed(0).padStart(10)}%   ${(keptBig * 100).toFixed(0)}% (mean ${mean(big.map((i) => a[i]!)).toFixed(1)}x of a mean peak ${mean(big.map((i) => peaks[i]!)).toFixed(1)}x)`);
  });
  const ci = bootDiffCi(res[2]!, res[0]!);
  console.log(`\nexample plan against holding: ${(ci.diff * 100).toFixed(0)} points [${(ci.lo * 100).toFixed(0)}, ${(ci.hi * 100).toFixed(0)}]`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
