/**
 * Which messages are worth sending, and which sales should they suggest? (docs/ALERT_REDESIGN.md)
 *
 *   corepack pnpm exec tsx scripts/lab-alert-ladders.ts
 *
 * Read-only. Same coins and same way of entering as scripts/lab-exit-segments.ts (every lab coin whose whole 72 hours were seen, entered at its first look, phantom readings
 * removed, 5% cost on what is sold, a stop at -50% until the first target fills). Written down BEFORE looking:
 *  1. VOLUME: how many messages would each ladder of levels send per coin? (a level counts when two readings in a row are at or above it, which is what the alert needs)
 *  2. SUGGESTED SALES: the rules below, from the current advice (half at 2x, a trailing stop of 40% under the rest) to the owner's idea (50% at 2x, 25% at 10x, ...) and
 *     to a stop that tightens as the coin runs. Every rule is run twice: sold AT the level / the price read (the lab's usual, optimistic) and sold 5 minutes after the
 *     crossing (an alert takes two to four minutes to arrive, then a person has to act), the price in between readings taken on the straight line.
 *  3. The comparison is always against the current advice, coin by coin (paired, 90% bootstrap interval), on all coins and on the later 40% only.
 * Every number is a ceiling (a thin pool fills worse than assumed): the comparison between rules is the point, not the level. Never prints an address.
 */
import pg from "pg";
import { loadObs, selectCandidates, selectWatch } from "../apps/web/lib/lab/builder";
import { cleanObs, type Obs } from "../apps/web/lib/lab/paths";
import { forwardLabels } from "../apps/web/lib/lab/outcomes";
import { rng } from "../apps/web/lib/lab/stats";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://aureus:aureus@localhost:5432/aureus", max: 2, statement_timeout: 300_000 });

interface Rule {
  name: string;
  /** [multiple, share of the ORIGINAL position] resting sells; the first one that fills arms the trailing stop */
  rungs: Array<[number, number]>;
  /** the trailing stop under what is left, as a function of the highest multiple reached: the fraction below that highest price at which the rest is sold */
  trail: (peakMultiple: number) => number;
  /** once armed, the rest is also sold when the price is back at this multiple of the entry (1 = break-even) */
  floor?: number;
  /** a floor that steps up with the highest multiple reached (null = no floor yet): the rest is sold when the price is back at it */
  floorFn?: (peakMultiple: number) => number | null;
  /** a floor that only applies until this multiple has been reached (then the trailing stop takes over) */
  floorUntil?: number;
  /** stop on the whole position until the first rung fills (as a multiple of the entry) */
  stop?: number;
}

const flat = (t: number) => () => t;
const RULES: Rule[] = [
  { name: "hold 72 h, no stop (reference)", rungs: [], trail: flat(1), stop: 0 },
  { name: "all out at 2x", rungs: [[2, 1]], trail: flat(0.4) },
  { name: "CURRENT ADVICE: half at 2x, trail 40%", rungs: [[2, 0.5]], trail: flat(0.4) },
  { name: "owner's idea: 50% at 2x, 25% at 10x, trail 40%", rungs: [[2, 0.5], [10, 0.25]], trail: flat(0.4) },
  { name: "half at 2x, then 10% each at 3x 5x 10x 20x, trail 40%", rungs: [[2, 0.5], [3, 0.1], [5, 0.1], [10, 0.1], [20, 0.1]], trail: flat(0.4) },
  { name: "even ladder: 20% each at 2x 3x 5x 10x 20x, trail 40%", rungs: [[2, 0.2], [3, 0.2], [5, 0.2], [10, 0.2], [20, 0.2]], trail: flat(0.4) },
  { name: "half at 2x, trail tightens: 40% / 30% from 5x / 25% from 10x", rungs: [[2, 0.5]], trail: (m) => (m >= 10 ? 0.25 : m >= 5 ? 0.3 : 0.4) },
  { name: "half at 2x, trail loosens early: 50% until 5x, then 40%", rungs: [[2, 0.5]], trail: (m) => (m >= 5 ? 0.4 : 0.5) },
  { name: "half at 2x, rest stopped at break-even (1x), no trail", rungs: [[2, 0.5]], trail: flat(1), floor: 1 },
  { name: "half at 2x, break-even floor until 3x, then trail 40%", rungs: [[2, 0.5]], trail: flat(0.4), floor: 1, floorUntil: 3 },
  { name: "half at 2x, trail 40%, tight stop -30% before", rungs: [[2, 0.5]], trail: flat(0.4), stop: 0.7 },
];
/** the highest level of the log ladder that the price has reached */
const LOG_LEVELS = [2, 3, 5, 10, 20, 50, 100];
const levelOf = (m: number): number | null => [...LOG_LEVELS].reverse().find((l) => m >= l) ?? null;
RULES.push(
  { name: "half at 2x, rest NOT protected (no stop, no trail)", rungs: [[2, 0.5]], trail: flat(1) },
  { name: "half at 2x, rest stopped at 1.5x (fixed)", rungs: [[2, 0.5]], trail: flat(1), floor: 1.5 },
  { name: "half at 2x, stop steps up with the ladder (60% of the highest level: 2x->1.2x, 3x->1.8x, 5x->3x, 10x->6x)", rungs: [[2, 0.5]], trail: flat(1), floorFn: (m) => { const l = levelOf(m); return l == null ? null : 0.6 * l; } },
  { name: "half at 2x, stop steps up with the ladder (75% of the highest level: 2x->1.5x, 5x->3.8x, 10x->7.5x)", rungs: [[2, 0.5]], trail: flat(1), floorFn: (m) => { const l = levelOf(m); return l == null ? null : 0.75 * l; } },
  // the middle way between half and everything (added when the owner's app turned out to have no stops: how much to keep when the rest is protected by hand?)
  { name: "75% at 2x, trail 40% on the rest", rungs: [[2, 0.75]], trail: flat(0.4) },
  { name: "90% at 2x, trail 40% on the rest", rungs: [[2, 0.9]], trail: flat(0.4) },
  { name: "75% at 2x, 25% rest stopped at the 75% line (2x->1.5x, 5x->3.8x)", rungs: [[2, 0.75]], trail: flat(1), floorFn: (m) => { const l = levelOf(m); return l == null ? null : 0.75 * l; } },
);
const BASE = RULES.findIndex((r) => r.name.startsWith("CURRENT"));

/** the price at time t, on the straight line between readings (the last reading's price after the last reading) */
function priceAt(obs: Obs[], i: number, t: number): number {
  for (let k = i; k < obs.length - 1; k++) {
    if (obs[k + 1]!.t >= t) {
      const a = obs[k]!;
      const b = obs[k + 1]!;
      const w = b.t === a.t ? 1 : Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
      return a.p + (b.p - a.p) * w;
    }
  }
  return obs[obs.length - 1]!.p;
}

/** The stake multiple after costs, the number of sales made, and the highest multiple reached. delayS = 0: sold at the level / the price read; else sold delayS after the crossing. */
function simulate(obs: Obs[], rule: Rule, delayS: number, cost = 0.05, horizonS = 72 * 3600): { net: number; sells: number; sales: number[] } {
  const tk = obs[0]!.t;
  const pk = obs[0]!.p;
  let rem = 1;
  let proceeds = 0;
  let peak = pk;
  let armed = false;
  let sells = 0;
  const filled = rule.rungs.map(() => false);
  const stop = rule.stop ?? 0.5;
  let last = pk;
  /** what each sale brought in, in multiples of the stake, before any cost */
  const sales: number[] = [];
  const sell = (share: number, i: number, level: number | null) => {
    // resting sells fill at their level in the optimistic model; a delayed sale gets the price delayS after the crossing
    const price = delayS > 0 ? priceAt(obs, i, obs[i]!.t + delayS) / pk : level ?? obs[i]!.p / pk;
    proceeds += share * price;
    sales.push(share * price);
    rem -= share;
    sells++;
  };
  for (let i = 1; i < obs.length; i++) {
    if (obs[i]!.t - tk > horizonS) break;
    const p = obs[i]!.p;
    last = p;
    const m = p / pk;
    if (p > peak) peak = p;
    for (let q = 0; q < rule.rungs.length; q++) {
      const [tm, share] = rule.rungs[q]!;
      if (!filled[q] && rem > 1e-9 && m >= tm) {
        sell(Math.min(share, rem), i, tm);
        filled[q] = true;
        armed = true;
      }
    }
    if (rem > 1e-9) {
      const peakM = peak / pk;
      const floorOn = armed && rule.floor != null && (rule.floorUntil == null || peakM < rule.floorUntil);
      const stepFloor = armed && rule.floorFn ? rule.floorFn(peakM) : null;
      if (stepFloor != null && m <= stepFloor) {
        sell(rem, i, null);
        break;
      }
      if (armed && p <= peak * (1 - rule.trail(peakM))) {
        sell(rem, i, null);
        break;
      }
      if (floorOn && m <= rule.floor!) {
        sell(rem, i, null);
        break;
      }
      if (!armed && stop > 0 && m <= stop) {
        sell(rem, i, null);
        break;
      }
    }
    if (rem <= 1e-9) break;
  }
  if (rem > 1e-9) {
    proceeds += rem * (last / pk);
    sales.push(rem * (last / pk));
    sells++;
  }
  return { net: proceeds * (1 - cost), sells, sales };
}

/**
 * The owner's real cost per sale in the trading app, measured on their own trades (scripts/fomo-fee-probe.ts, 2026-10-13): a flat $0.10 on (almost) every order,
 * and about 1% more on orders of roughly $8 and up (about 2% in all from $10). A leftover worth under $0.50 is not sold at all, so it costs nothing.
 * Returns the stake multiple after those costs for a stake of `stakeUsd` dollars. Only the sales are charged; the purchase costs the same under every rule.
 */
function netFlat(sales: number[], stakeUsd: number): number {
  let net = 0;
  for (const v of sales) {
    const usd = v * stakeUsd;
    const fee = usd < 0.5 ? 0 : 0.1 + (usd >= 8 ? 0.01 * usd : 0);
    net += v - fee / stakeUsd;
  }
  return net;
}

/** how many of the levels were crossed: two readings in a row at or above the level within the 72 hours (what an alert needs) */
function crossed(obs: Obs[], levels: number[], horizonS = 72 * 3600): number {
  const tk = obs[0]!.t;
  const pk = obs[0]!.p;
  let n = 0;
  for (const lv of levels) {
    for (let i = 1; i + 1 < obs.length; i++) {
      if (obs[i + 1]!.t - tk > horizonS) break;
      if (obs[i]!.p / pk >= lv && obs[i + 1]!.p / pk >= lv) {
        n++;
        break;
      }
    }
  }
  return n;
}

const LADDERS: Array<[string, number[]]> = [
  ["today: 2x, 5x", [2, 5]],
  ["2x, 3x, 5x, 10x", [2, 3, 5, 10]],
  ["log ladder: 2x 3x 5x 10x 20x 50x 100x", [2, 3, 5, 10, 20, 50, 100]],
  ["every whole x up to 10x, then 15x 20x 30x 50x 100x", [2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30, 50, 100]],
  ["EVERY whole x up to 100x", Array.from({ length: 99 }, (_, k) => k + 2)],
];

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : NaN;
};
function pairedBoot(diffs: number[], B = 1000, seed = 7) {
  const n = diffs.length;
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
const pts = (d: { mean: number; lo: number; hi: number }) => `${(d.mean * 100).toFixed(0).padStart(4)} [${(d.lo * 100).toFixed(0)}, ${(d.hi * 100).toFixed(0)}]`;

/** quantiles of a sorted list */
const q = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? NaN;

async function main() {
  const cands = [...(await selectCandidates(pool, { limit: 1_000_000, all: true })), ...(await selectWatch(pool, { limit: 1_000_000, all: true }))];
  const firstSeen = new Map<string, number>();
  for (const r of (await pool.query(`SELECT mint, EXTRACT(EPOCH FROM first_seen_at)::float8 AS seen FROM lab_coins`)).rows) firstSeen.set(r.mint, r.seen);
  const coins: Array<{ t: number; obs: Obs[] }> = [];
  let latest = 0;
  for (let b = 0; b < cands.length; b += 40) {
    const batch = cands.slice(b, b + 40);
    const obsMap = await loadObs(pool, batch);
    for (const c of batch) {
      const { clean } = cleanObs(obsMap.get(c.pool_id) ?? []);
      if (clean.length < 3) continue;
      latest = Math.max(latest, clean[clean.length - 1]!.t);
      const y = forwardLabels(clean, 0, { rule: "auto" });
      if (!y || y.go2 == null || y.ev == null) continue; // the whole window must have been seen
      coins.push({ t: firstSeen.get(c.mint) ?? c.discovered_at, obs: clean });
    }
  }
  // CORRECTION 2026-10-13: a coin that died has a decided window at once, a living one only after 72 hours, so a recent cohort held only the dead ones and looked worse than it was
  // (it favoured selling early). A coin now counts only when its 72 hours are over by the latest reading, dead or alive. MATURE=0 gives the old selection back.
  const before = coins.length;
  if (process.env.MATURE !== "0") for (let i = coins.length - 1; i >= 0; i--) if (coins[i]!.obs[0]!.t + 73 * 3600 > latest) coins.splice(i, 1);
  console.log(`selection: ${before} coins with a decided window, ${coins.length} of them first looked at least 73 hours before the latest reading${process.env.MATURE === "0" ? " (maturity filter OFF)" : ""}`);
  coins.sort((a, b) => a.t - b.t);
  const n = coins.length;
  const cut = Math.floor(0.6 * n);
  console.log(`${n} coins entered at the first look, whole 72 hours seen (the later 40% = the last ${n - cut})\n`);

  // ---- 1. VOLUME
  console.log("== 1. How many messages would each ladder send? (per coin that was ever held; a level counts on two readings in a row)");
  console.log("   ladder".padEnd(58), "per coin".padStart(9), "per coin that reached 2x".padStart(26), "max".padStart(5), "p95 of those".padStart(13));
  const reached2 = coins.filter((c) => crossed(c.obs, [2]) === 1);
  for (const [name, lv] of LADDERS) {
    const all = coins.map((c) => crossed(c.obs, lv));
    const r2 = reached2.map((c) => crossed(c.obs, lv));
    const sorted = [...r2].sort((a, b) => a - b);
    console.log(`   ${name}`.padEnd(58), mean(all).toFixed(2).padStart(9), mean(r2).toFixed(2).padStart(26), String(Math.max(...all)).padStart(5), String(sorted[Math.floor(0.95 * sorted.length)] ?? 0).padStart(13));
  }
  console.log(`   (${reached2.length} of ${n} coins, ${((100 * reached2.length) / n).toFixed(1)}%, reached 2x)\n`);

  // ---- 1b. how fast is it, and what comes after 2x
  console.log("== 1b. What happens after a coin passes 2x (the moment an alert would be sent: two readings in a row at 2x)");
  const after: Array<{ ratios: number[]; ttp: number }> = [];
  for (const c of coins) {
    const pk = c.obs[0]!.p;
    let k = -1;
    for (let i = 1; i + 1 < c.obs.length; i++) if (c.obs[i]!.p / pk >= 2 && c.obs[i + 1]!.p / pk >= 2) { k = i + 1; break; }
    if (k < 0) continue;
    const t0 = c.obs[k]!.t;
    const p0 = c.obs[k]!.p;
    let top = p0;
    let tTop = t0;
    for (let i = k; i < c.obs.length && c.obs[i]!.t - c.obs[0]!.t <= 72 * 3600; i++) if (c.obs[i]!.p > top) { top = c.obs[i]!.p; tTop = c.obs[i]!.t; }
    after.push({ ratios: [300, 900, 1800, 3600].map((d) => priceAt(c.obs, k, t0 + d) / p0), ttp: (tTop - t0) / 60 });
  }
  console.log(`   ${after.length} coins crossed 2x. The price N minutes after the alert, against the price at the alert (10th / 50th / 90th percentile; share below the alert price; share down 30% or more):`);
  [5, 15, 30, 60].forEach((mins, j) => {
    const r = after.map((a) => a.ratios[j]!).sort((x, y) => x - y);
    console.log(`   after ${String(mins).padStart(2)} min: ${q(r, 0.1).toFixed(2)} / ${q(r, 0.5).toFixed(2)} / ${q(r, 0.9).toFixed(2)}   below: ${((100 * r.filter((x) => x < 1).length) / r.length).toFixed(0)}%   down 30%+: ${((100 * r.filter((x) => x <= 0.7).length) / r.length).toFixed(0)}%`);
  });
  const ttp = after.map((a) => a.ttp).sort((x, y) => x - y);
  console.log(`   the highest price came ${q(ttp, 0.25).toFixed(0)} / ${q(ttp, 0.5).toFixed(0)} / ${q(ttp, 0.75).toFixed(0)} minutes after the alert (25th / 50th / 75th percentile); within 15 min: ${((100 * ttp.filter((x) => x <= 15).length) / ttp.length).toFixed(0)}%, within 60 min: ${((100 * ttp.filter((x) => x <= 60).length) / ttp.length).toFixed(0)}%`);
  const reachedN = (m: number) => coins.filter((c) => crossed(c.obs, [m]) === 1).length;
  console.log(`   of the coins that reached 2x: ${LOG_LEVELS.slice(1).map((m) => `${m}x ${((100 * reachedN(m)) / reachedN(2)).toFixed(0)}%`).join(", ")} went on to reach that level (${reachedN(2)} coins)\n`);

  // ---- 2. SUGGESTED SALES
  for (const delay of [0, 300]) {
    const net = RULES.map((r) => coins.map((c) => simulate(c.obs, r, delay)));
    const label = delay === 0 ? "sold AT the level / the price read (optimistic)" : "sold 5 minutes after the crossing (an alert, then a person)";
    console.log(`== 2${delay === 0 ? "a" : "b"}. Suggested sales, ${label}`);
    console.log("   rule".padEnd(70), "mean".padStart(6), "median".padStart(7), "profit".padStart(7), "sales*".padStart(7), "  vs current, all coins [90% interval]".padEnd(40), "later 40%".padStart(12));
    RULES.forEach((r, k) => {
      const nets = net[k]!.map((x) => x.net);
      const d = nets.map((x, i) => x - net[BASE]![i]!.net);
      const dLate = d.slice(cut);
      const r2idx = coins.map((c, i) => (reached2.includes(c) ? i : -1)).filter((i) => i >= 0);
      const sellsR2 = mean(r2idx.map((i) => net[k]![i]!.sells));
      console.log(
        `   ${r.name}`.padEnd(70),
        `${((mean(nets) - 1) * 100).toFixed(0)}%`.padStart(6),
        `${((median(nets) - 1) * 100).toFixed(0)}%`.padStart(7),
        `${((100 * nets.filter((x) => x >= 1).length) / n).toFixed(0)}%`.padStart(7),
        sellsR2.toFixed(1).padStart(7),
        k === BASE ? "(the baseline)".padEnd(40) : `  ${pts(pairedBoot(d))} pts`.padEnd(40),
        k === BASE ? "".padStart(12) : `${(mean(dLate) * 100).toFixed(0)} pts`.padStart(12),
      );
    });
    // the coins that matter: those that reached 5x
    const big = coins.map((c, i) => (c.obs.length && crossed(c.obs, [5]) === 1 ? i : -1)).filter((i) => i >= 0);
    console.log(`   on the ${big.length} coins that reached 5x (mean result, % of stake): ${RULES.map((r, k) => `${r.name.split(":")[0]!.slice(0, 22)} ${((mean(big.map((i) => net[k]![i]!.net)) - 1) * 100).toFixed(0)}%`).join(" | ")}`);
    console.log("   * average number of sales made on a coin that reached 2x (each is something to do on a phone)\n");
  }

  // ---- 2c. the same rules with the owner's real cost per sale (a flat $0.10 and about 1% more from $8), for the stakes the owner uses
  {
    const STAKES = [2, 3, 5];
    const sims = RULES.map((r) => coins.map((c) => simulate(c.obs, r, 300)));
    console.log("== 2c. Suggested sales with the real cost per order (flat $0.10, +1% from $8 up), sold 5 minutes after the crossing, stake $2 / $3 / $5");
    console.log("   mean result in % of the stake, and the difference against the current advice in points of the stake [90% interval]");
    console.log("   rule".padEnd(70), STAKES.map((s) => `$${s} mean`.padStart(9) + `   vs current`.padEnd(20)).join(""));
    RULES.forEach((r, k) => {
      const cells = STAKES.map((s) => {
        const nets = sims[k]!.map((x) => netFlat(x.sales, s));
        const d = nets.map((x, i) => x - netFlat(sims[BASE]![i]!.sales, s));
        return `${((mean(nets) - 1) * 100).toFixed(0)}%`.padStart(9) + (k === BASE ? "   (baseline)".padEnd(20) : `   ${pts(pairedBoot(d))}`.padEnd(20));
      });
      console.log(`   ${r.name}`.padEnd(70), cells.join(""));
    });
    // what one extra order costs the owner, in points of the stake
    console.log(`   one extra order of about ${"$"}1 to ${"$"}8 costs ${STAKES.map((s) => `${((0.1 / s) * 100).toFixed(1)} points of a $${s} stake`).join(", ")}\n`);
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
