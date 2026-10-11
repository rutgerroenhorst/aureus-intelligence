/**
 * How hot a coin is at its first look, and how old its pool is: do they separate the coins that crash from the ones that do not?
 *
 *   corepack pnpm exec tsx scripts/lab-activity-check.ts
 *
 * Run after the wallet review (docs/WALLET_REVIEW.md) found that the user's own entries sit in the busier half of the lab's coins and
 * the coins younger than six hours lost most. The question and the definitions are fixed here, in advance, and each is run once on the
 * Radar's own coins (lane "fresh"):
 *
 *   A  pool age at the first look: under 2 h, 2-6 h, 6-24 h, 1-7 days. Outcomes: held 2x / 5x within 72 h, lost half within 24 h.
 *   B  activity at the first look (and at +1 h): trades in the last hour and volume in the last hour, split into three equal groups
 *      whose edges are fitted on the EARLIER 60% of the coins (by first-seen time) and then applied unchanged to the LATER 40%.
 *      Outcomes: held 2x, lost half within 24 h, and the lab's default exit ladder (the plan) from that moment.
 *
 * Nothing is stored. A result counts only if it shows in the later 40% as well; the plan difference carries a bootstrap interval.
 */
import pg from "pg";
import { loadLabCoins } from "../apps/web/lib/lab/builder";
import { bootDiffCi, mean, quantileEdges, binOf, wilson } from "../apps/web/lib/lab/stats";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://aureus:aureus@localhost:5432/aureus", max: 2 });
const pc = (k: number, n: number) => {
  if (!n) return "-";
  const w = wilson(k, n);
  return `${(100 * w.p).toFixed(0)}% [${(100 * w.lo).toFixed(0)}-${(100 * w.hi).toFixed(0)}]`;
};

async function main() {
  const coins = (await loadLabCoins(pool as never)).filter((c) => c.lane === "fresh");
  console.log(`fresh-lane coins: ${coins.length}`);

  console.log("\nA  pool age at the first look");
  const rows = coins.map((c) => ({ age0: c.pairCreatedAt != null ? (c.firstSeenAt - c.pairCreatedAt) / 3600 : null, y: c.snaps.find((s) => s.tau === 0)?.y ?? null }));
  const buckets: Array<[string, (a: number) => boolean]> = [["under 2 h", (a) => a < 2], ["2-6 h", (a) => a >= 2 && a < 6], ["6-24 h", (a) => a >= 6 && a < 24], ["1-7 days", (a) => a >= 24 && a < 168]];
  for (const [name, f] of buckets) {
    const r = rows.filter((x) => x.age0 != null && f(x.age0) && x.y);
    const d = (k: "go2" | "go5" | "collapse24") => {
      const v = r.filter((x) => x.y![k] != null);
      return pc(v.filter((x) => x.y![k]).length, v.length);
    };
    console.log(`  ${name.padEnd(10)} coins ${String(r.length).padStart(4)}   held 2x ${d("go2").padEnd(14)} held 5x ${d("go5").padEnd(14)} lost half in 24 h ${d("collapse24")}`);
  }

  console.log("\nB  activity (terciles fitted on the earlier 60%, applied to the later 40%)");
  for (const tau of [0, 1]) {
    for (const key of ["trades_h1", "vol_h1"]) {
      const all = coins
        .flatMap((c) => c.snaps.filter((s) => s.tau === tau && s.y && s.f[key] != null && Number.isFinite(s.f[key] as number)).map((s) => ({ t: c.firstSeenAt, v: s.f[key] as number, y: s.y! })))
        .sort((a, b) => a.t - b.t);
      if (all.length < 300) continue;
      const k = Math.floor(all.length * 0.6);
      const train = all.slice(0, k);
      const test = all.slice(k);
      const edges = quantileEdges(train.map((r) => r.v), 3);
      console.log(`  ${tauLabel(tau)} ${key}: edges ${edges.map((e) => e.toPrecision(3)).join(" / ")}`);
      for (const [name, set] of [["earlier 60%", train], ["LATER 40%", test]] as const) {
        const g = [0, 1, 2].map((b) => set.filter((r) => binOf(r.v, edges) === b));
        const f = (xs: typeof set) => {
          const d = xs.filter((r) => r.y.go2 != null);
          const c = xs.filter((r) => r.y.collapse24 != null);
          const e = xs.map((r) => r.y.ev).filter((x): x is number => x != null);
          return `n=${String(xs.length).padStart(3)} 2x ${pc(d.filter((r) => r.y.go2).length, d.length).padEnd(14)} lost half ${pc(c.filter((r) => r.y.collapse24).length, c.length).padEnd(14)} plan ${e.length ? (((mean(e) - 1) * 100).toFixed(0) + "%").padStart(4) : "-"}`;
        };
        console.log(`    ${name}: quiet ${f(g[0]!)} | middle ${f(g[1]!)} | busy ${f(g[2]!)}`);
        if (name === "LATER 40%") {
          const lo = g[0]!.map((r) => r.y.ev).filter((x): x is number => x != null);
          const hi = g[2]!.map((r) => r.y.ev).filter((x): x is number => x != null);
          if (lo.length > 8 && hi.length > 8) {
            const d = bootDiffCi(lo, hi);
            console.log(`    later 40%: plan result quiet minus busy ${(d.diff * 100).toFixed(0)} points [${(d.lo * 100).toFixed(0)}, ${(d.hi * 100).toFixed(0)}]`);
          }
        }
      }
    }
  }
  await pool.end();
}
const tauLabel = (tau: number) => (tau === 0 ? "first look" : `+${tau} h`);
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
