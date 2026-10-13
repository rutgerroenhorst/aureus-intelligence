/**
 * The exit rules that are used in practice for memecoins like these (pump.fun coins that moved to PumpSwap), tested on the lab's own coins.
 * (docs/EXIT_PRACTICE.md)
 *
 *   corepack pnpm exec tsx scripts/lab-exit-practice.ts
 *
 * Read-only. WRITTEN DOWN BEFORE LOOKING (2026-10-13), after reading what guides, a vendor, a paper-trading experiment and two papers say:
 *
 *  - COINS: every lab coin whose whole 72 hours were seen from the moment of entry, phantom readings removed, one row per coin (a mint seen in the Radar and in the lab's
 *    watch list counts once, with its longest series). Three populations: PUMPSWAP (the coin's first-look pool is PumpSwap, i.e. a pump.fun graduate), OTHER (any other pool)
 *    and ALL. The primary one is PUMPSWAP.
 *  - ENTRY MOMENT: tau = 0 (the first look, what the Radar offers) and tau = 6 h (the first reading at least 6 hours after the first look: how the owner usually buys,
 *    for example $HW2, bought five hours after its migration). A coin has to be alive and priced at that moment.
 *  - EXITS: the same fills as docs/ALERT_REDESIGN.md: a trigger on a reading is sold FIVE MINUTES later at the price then (an alert, then a person), cost per sale as the owner pays
 *    it (a flat $0.10, +1% from $8; a leftover under $0.50 is not sold), stake $3, 72-hour horizon, leftover valued at the last price. The comparison between rules is the point.
 *  - RULES (fixed, 29; none added or changed after looking):
 *      A  baselines: hold; the CURRENT advice (half at 2x, trail 40%, stop -50% before the first sale); 75% at 2x (the proposal); all out at 2x.
 *      B  the ladders of the guides, each as written (stop -50% until the first sale, the rest unprotected) and with a 40% trail on the rest:
 *         initials (50% at 2x, moonbag); 25% each at 2/3/5/10x; 50% at 2x + 25% at 3x + 25% at 5x; 20% at 3x, 20% at 5x, 30% at 10x, 30% at 20x; 25% at 3x, 6x, 12x + a 25% moonbag.
 *      C  a trailing stop from the entry and nothing else: 10, 15, 20, 25, 35, 40, 50% under the highest price (the vendor's "a plain 10% trail beat ladders").
 *      D  a trail that tightens (40% to 2x, 30% from 2x, 20% from 5x, 15% from 10x); a trail that decays with time (40%, 30% after 4 h and 20% after 12 h without a new high,
 *         everything sold after 24 h without one).
 *      E  a hard stop and nothing else: -30, -40, -50%, hold to 72 h.
 *      F  overlays on the proposal (75% at 2x + trail 40% + stop -50%): a time stop (sell everything when 6 / 12 h after entry the coin never reached 1.3x), a liquidity guard
 *         (sell when the pool is down to half its highest since entry), a stop at -30% instead of -50%, and all three together (stop -30%, 6 h, liquidity).
 *  - JUDGING: paired differences against the CURRENT advice and against the proposal, 90% bootstrap intervals (resampling coins), on all coins and on the later 40% (by first look);
 *    29 rules means a few will look good by chance, so a rule only counts when its interval excludes zero on all coins AND on the later 40% AND at both entry moments. And the
 *    honest test: the best rule on the earlier 60% of the coins, judged on the later 40%.
 *  - ALSO: the path of a PumpSwap coin after the first look (price and pool), to check the guides' "graduation pump, then dump".
 *  - ENTRY TIMING (section 3): the same current rule (and hold, and all out at 2x) for entries 0, 1, 3, 6, 12 and 24 hours after the first look.
 *  - ENTRY CONDITIONS (section 4, EXPLORATORY: 6 conditions fixed before looking, at the 1 h and the 6 h entry, PumpSwap coins; they decide nothing, they only say which ideas
 *    deserve to be registered as hypotheses and graded on coins that come later): L1 the pool still holds 70% or more of its size at the first look; L2 the price is above its
 *    first-look price; L3 the price already stands at 2x or more of the first look (chasing); L4 the price is within 10% of its highest since the first look, against 30% or more below it;
 *    L5 the price rose 10% or more in the last hour, against fell 10% or more; L6 the pool is $20,000 or more.
 *  - CORRECTION (2026-10-13): a coin that died is "decided" at once, a living one only after 72 hours, so a recent cohort of decided coins held only the dead ones. A coin now counts
 *    only when entry + 72 hours is over by the latest reading (MATURE=0 gives the old selection back). The first version of this research and the first alert research had this flaw.
 * Never prints an address.
 */
import pg from "pg";
import { loadObs, selectCandidates, selectWatch } from "../apps/web/lib/lab/builder";
import { cleanObs, type Obs } from "../apps/web/lib/lab/paths";
import { forwardLabels } from "../apps/web/lib/lab/outcomes";
import { rng } from "../apps/web/lib/lab/stats";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://aureus:aureus@localhost:5432/aureus", max: 2, statement_timeout: 300_000 });
const DELAY_S = 300;
const STAKE = 3;
const HOUR = 3600;
const HORIZON_S = 72 * HOUR;

interface Rule {
  id: string;
  name: string;
  group: string;
  /** resting sells: [multiple of the entry, share of the original position]; a crossing is sold DELAY_S later */
  rungs?: Array<[number, number]>;
  /** hard stop on the whole position until the first sale, as a fraction of the entry (default 0.5; 0 = none) */
  stop?: number;
  /** trailing stop: the fraction under the highest price at which the rest is sold, given the highest multiple and the hours since that high; null = none */
  trail?: (peakMult: number, hoursSinceHigh: number) => number | null;
  /** the trail runs from the entry instead of only after the first sale */
  trailFromEntry?: boolean;
  /** sell everything after this many hours without a new high (trail rules only) */
  noHighExitH?: number;
  /** sell everything when, this many hours after the entry, the coin never reached this multiple */
  timeStop?: { afterH: number; minPeak: number };
  /** sell everything when the pool is down to this share of its highest since the entry */
  liqGuard?: number;
}

const flat = (t: number) => () => t;
const RULES: Rule[] = [];
const add = (r: Rule) => RULES.push(r);
// A
add({ id: "A0", group: "A", name: "hold 72 h, no stop", stop: 0 });
add({ id: "A1", group: "A", name: "CURRENT: half at 2x, trail 40%, stop -50%", rungs: [[2, 0.5]], trail: flat(0.4) });
add({ id: "A2", group: "A", name: "PROPOSAL: 75% at 2x, trail 40%, stop -50%", rungs: [[2, 0.75]], trail: flat(0.4) });
add({ id: "A3", group: "A", name: "all out at 2x, stop -50%", rungs: [[2, 1]], trail: flat(0.4) });
// B: the ladders of the guides, as written and with a trail
const LADDERS: Array<[string, string, Array<[number, number]>]> = [
  ["B1", "initials: 50% at 2x, moonbag", [[2, 0.5]]],
  ["B2", "25% each at 2/3/5/10x", [[2, 0.25], [3, 0.25], [5, 0.25], [10, 0.25]]],
  ["B3", "50% at 2x, 25% at 3x, 25% at 5x", [[2, 0.5], [3, 0.25], [5, 0.25]]],
  ["B4", "20% at 3x, 20% at 5x, 30% at 10x, 30% at 20x", [[3, 0.2], [5, 0.2], [10, 0.3], [20, 0.3]]],
  ["B5", "25% at 3x, 6x, 12x + 25% moonbag", [[3, 0.25], [6, 0.25], [12, 0.25]]],
];
for (const [id, name, rungs] of LADDERS) {
  add({ id, group: "B", name: `${name}, rest unprotected`, rungs, trail: () => null });
  add({ id: `${id}t`, group: "B", name: `${name}, trail 40% on the rest`, rungs, trail: flat(0.4) });
}
// C
for (const x of [10, 15, 20, 25, 35, 40, 50]) add({ id: `C${x}`, group: "C", name: `trail ${x}% from the entry, nothing else`, stop: 0, trail: flat(x / 100), trailFromEntry: true });
// D
add({ id: "D1", group: "D", name: "tightening trail 40/30/20/15% (2x, 5x, 10x), from the entry", stop: 0, trail: (m) => (m >= 10 ? 0.15 : m >= 5 ? 0.2 : m >= 2 ? 0.3 : 0.4), trailFromEntry: true });
add({ id: "D2", group: "D", name: "time-decay trail 40/30/20% (4 h, 12 h), out after 24 h without a high", stop: 0, trail: (_m, h) => (h >= 12 ? 0.2 : h >= 4 ? 0.3 : 0.4), trailFromEntry: true, noHighExitH: 24 });
// E
for (const x of [30, 40, 50]) add({ id: `E${x}`, group: "E", name: `hard stop -${x}%, hold otherwise`, stop: 1 - x / 100 });
// F
add({ id: "F1", group: "F", name: "PROPOSAL + time stop 6 h (never 1.3x)", rungs: [[2, 0.75]], trail: flat(0.4), timeStop: { afterH: 6, minPeak: 1.3 } });
add({ id: "F2", group: "F", name: "PROPOSAL + time stop 12 h (never 1.3x)", rungs: [[2, 0.75]], trail: flat(0.4), timeStop: { afterH: 12, minPeak: 1.3 } });
add({ id: "F3", group: "F", name: "PROPOSAL + liquidity guard (pool at half of its high)", rungs: [[2, 0.75]], trail: flat(0.4), liqGuard: 0.5 });
add({ id: "F4", group: "F", name: "PROPOSAL with stop -30%", rungs: [[2, 0.75]], trail: flat(0.4), stop: 0.7 });
add({ id: "F5", group: "F", name: "PROPOSAL + stop -30% + 6 h + liquidity guard", rungs: [[2, 0.75]], trail: flat(0.4), stop: 0.7, timeStop: { afterH: 6, minPeak: 1.3 }, liqGuard: 0.5 });
const IDX = new Map(RULES.map((r, i) => [r.id, i]));
const CUR = IDX.get("A1")!;
const PRO = IDX.get("A2")!;

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

/** What each sale brought in (multiples of the stake, before cost) when the coin is entered at obs[k] and managed by the rule. */
function simulate(obs: Obs[], k: number, rule: Rule): number[] {
  const tk = obs[k]!.t;
  const pk = obs[k]!.p;
  let rem = 1;
  let peak = pk;
  let tPeak = tk;
  let armed = false;
  let liqMax = obs[k]!.liq ?? 0;
  const sales: number[] = [];
  const filled = (rule.rungs ?? []).map(() => false);
  const stop = rule.stop ?? 0.5;
  let last = pk;
  const sell = (share: number, i: number) => {
    sales.push(share * (priceAt(obs, i, obs[i]!.t + DELAY_S) / pk));
    rem -= share;
  };
  for (let i = k + 1; i < obs.length; i++) {
    const o = obs[i]!;
    if (o.t - tk > HORIZON_S) break;
    const p = o.p;
    last = p;
    const m = p / pk;
    if (p > peak) {
      peak = p;
      tPeak = o.t;
    }
    if (o.liq != null && o.liq > liqMax) liqMax = o.liq;
    for (let q = 0; q < filled.length; q++) {
      const [tm, share] = rule.rungs![q]!;
      if (!filled[q] && rem > 1e-9 && m >= tm) {
        sell(Math.min(share, rem), i);
        filled[q] = true;
        armed = true;
      }
    }
    if (rem > 1e-9) {
      const peakM = peak / pk;
      const sinceHigh = (o.t - tPeak) / HOUR;
      if (rule.liqGuard != null && o.liq != null && liqMax > 0 && o.liq <= rule.liqGuard * liqMax) {
        sell(rem, i);
        break;
      }
      const tr = rule.trail ? rule.trail(peakM, sinceHigh) : null;
      const trailOn = armed || rule.trailFromEntry === true;
      if (tr != null && trailOn && p <= peak * (1 - tr)) {
        sell(rem, i);
        break;
      }
      if (rule.noHighExitH != null && trailOn && o.t - tPeak >= rule.noHighExitH * HOUR) {
        sell(rem, i);
        break;
      }
      if (rule.timeStop && !armed && o.t - tk >= rule.timeStop.afterH * HOUR && peakM < rule.timeStop.minPeak) {
        sell(rem, i);
        break;
      }
      if (!armed && stop > 0 && m <= stop) {
        sell(rem, i);
        break;
      }
    }
    if (rem <= 1e-9) break;
  }
  if (rem > 1e-9) sales.push(rem * (last / pk));
  return sales;
}

/** The stake multiple after the owner's real cost per sale (flat $0.10, +1% from $8; under $0.50 nothing is sold). */
function netFlat(sales: number[], stakeUsd: number): number {
  let net = 0;
  for (const v of sales) {
    const usd = v * stakeUsd;
    const fee = usd < 0.5 ? 0 : 0.1 + (usd >= 8 ? 0.01 * usd : 0);
    net += v - fee / stakeUsd;
  }
  return net;
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : NaN;
};
function pairedBoot(diffs: number[], B = 1000, seed = 7) {
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
const pts = (d: { mean: number; lo: number; hi: number }) => `${(d.mean * 100).toFixed(0).padStart(4)} [${(d.lo * 100).toFixed(0)}, ${(d.hi * 100).toFixed(0)}]`;
const q = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? NaN;

interface CoinRow {
  mint: string;
  /** epoch seconds of the first look */
  t0: number;
  lane: string;
  pump: boolean | null;
  obs: Obs[];
}

async function loadCoins(): Promise<CoinRow[]> {
  const meta = new Map<string, { lane: string; pump: boolean | null }>();
  for (const r of (await pool.query(`SELECT mint, lane, snaps->0->'f'->>'lp_pump' AS lp FROM lab_coins`)).rows) meta.set(r.mint, { lane: r.lane, pump: r.lp == null ? null : r.lp === "1" });
  const cands = [...(await selectCandidates(pool, { limit: 1_000_000, all: true })), ...(await selectWatch(pool, { limit: 1_000_000, all: true }))];
  const best = new Map<string, CoinRow>();
  for (let b = 0; b < cands.length; b += 40) {
    const batch = cands.slice(b, b + 40);
    const obsMap = await loadObs(pool, batch);
    for (const c of batch) {
      const { clean } = cleanObs(obsMap.get(c.pool_id) ?? []);
      if (clean.length < 3) continue;
      const m = meta.get(c.mint);
      const row: CoinRow = { mint: c.mint, t0: clean[0]!.t, lane: m?.lane ?? c.lane ?? "fresh", pump: m?.pump ?? null, obs: clean };
      const old = best.get(c.mint);
      if (!old || old.obs.length < clean.length) best.set(c.mint, row);
    }
  }
  return [...best.values()].sort((a, b) => a.t0 - b.t0);
}

/** the latest reading of any coin: a coin only counts once its whole entry window (tau + 72 h) is over by this time, dead or alive. */
let NOW_S = 0;
/** also drop coins whose window is decided only because they died (a recent cohort would then hold the dead ones and not yet the living: biased to losers). */
let MATURE_ONLY = true;

/** The reading at which a coin is entered tau hours after its first look, if it can be bought then and its whole 72 hours were seen. */
function entryIndex(c: CoinRow, tauH: number): number | null {
  const target = c.t0 + tauH * HOUR;
  if (MATURE_ONLY && c.t0 + (tauH + 72) * HOUR > NOW_S - HOUR) return null;
  let k = 0;
  while (k < c.obs.length && c.obs[k]!.t < target) k++;
  if (k >= c.obs.length) return null;
  if (c.obs[k]!.t - target > 2 * HOUR) return null; // no reading near that moment
  if (c.obs[k]!.dead || !(c.obs[k]!.p > 0)) return null;
  const y = forwardLabels(c.obs, k, { rule: "auto" });
  if (!y || y.go2 == null) return null; // the whole window has to be decided
  return k;
}

async function main() {
  const all = await loadCoins();
  const nowS = Math.max(...all.map((c) => c.obs[c.obs.length - 1]!.t));
  NOW_S = nowS;
  MATURE_ONLY = process.env.MATURE !== "0";
  console.log(`maturity filter: ${MATURE_ONLY ? "ON (a coin counts only when entry + 72 h is over)" : "OFF (a decided window is enough)"}`);
  console.log(`${all.length} distinct coins with at least 3 clean readings (latest reading ${new Date(nowS * 1000).toISOString().slice(0, 16)}Z)`);

  // --- path of a PumpSwap coin after the first look (the guides' "graduation pump, then dump")
  const pumpCoins = all.filter((c) => c.pump === true);
  console.log(`\n== 0. The path of a PumpSwap coin after its first look (${pumpCoins.length} coins; price and pool as a multiple of the first look; 10th / 50th / 90th percentile; share below the first look)`);
  for (const mins of [5, 15, 30, 60, 180, 360, 1440]) {
    const pr: number[] = [];
    const lq: number[] = [];
    for (const c of pumpCoins) {
      const t = c.t0 + mins * 60;
      const lastO = c.obs[c.obs.length - 1]!;
      if (lastO.t < t && !lastO.dead) continue; // not followed that long; a coin that died stays at its last (dead) reading
      let k = c.obs.length - 1;
      for (let i = 0; i < c.obs.length; i++) if (c.obs[i]!.t >= t) { k = i; break; }
      pr.push(c.obs[k]!.p / c.obs[0]!.p);
      const l0 = c.obs[0]!.liq;
      const l1 = c.obs[k]!.liq;
      if (l0 && l1 != null && l0 > 0) lq.push(l1 / l0);
    }
    pr.sort((a, b) => a - b);
    lq.sort((a, b) => a - b);
    console.log(
      `   +${String(mins).padStart(4)} min: price ${q(pr, 0.1).toFixed(2)} / ${q(pr, 0.5).toFixed(2)} / ${q(pr, 0.9).toFixed(2)}  below start ${((100 * pr.filter((x) => x < 1).length) / pr.length).toFixed(0)}%   pool ${q(lq, 0.1).toFixed(2)} / ${q(lq, 0.5).toFixed(2)} / ${q(lq, 0.9).toFixed(2)}  (n=${pr.length})`,
    );
  }

  // --- is the selection of coins with a decided window biased? Of the PumpSwap coins old enough for every window to have matured, how many made it in?
  for (const tau of [0, 6]) {
    const old = pumpCoins.filter((c) => c.t0 <= nowS - (tau + 72 + 24) * HOUR);
    const inn = old.filter((c) => entryIndex(c, tau) != null).length;
    console.log(`\n   check: ${old.length} PumpSwap coins were first seen at least ${(72 + 24 + tau) / 24} days before the latest reading; ${inn} (${((100 * inn) / Math.max(1, old.length)).toFixed(0)}%) can be entered ${tau} h after the first look with a decided window`);
  }

  // cross-check of a vendor's dataset (Scorp Trader, 15,548 graduations since 2026-05-31: pool of $5,000 or more still there: 56.5% at +5 min, 43.8% at +30 min, 25.8% at +6 h, 19.7% at +24 h)
  {
    const cells: string[] = [];
    for (const mins of [5, 30, 360, 1440]) {
      let n = 0;
      let alive = 0;
      for (const c of pumpCoins) {
        const t = c.t0 + mins * 60;
        const lastO = c.obs[c.obs.length - 1]!;
        if (lastO.t < t && !lastO.dead) continue;
        let k = c.obs.length - 1;
        for (let i = 0; i < c.obs.length; i++) if (c.obs[i]!.t >= t) { k = i; break; }
        const l = c.obs[k]!.liq;
        if (l == null) continue;
        n++;
        if (l >= 5000) alive++;
      }
      cells.push(`+${mins >= 60 ? mins / 60 + " h" : mins + " min"}: ${((100 * alive) / n).toFixed(0)}% (n=${n})`);
    }
    console.log(`\n   share of our PumpSwap coins with a pool of $5,000 or more:  ${cells.join("   ")}   (the vendor: 56.5% / 43.8% / 25.8% / 19.7%)`);
  }
  {
    const rd = pumpCoins.flatMap((c) => c.obs.filter((o) => o.t - c.t0 <= HORIZON_S));
    console.log(`\n   readings of PumpSwap coins in their first 72 h that carry a pool size: ${((100 * rd.filter((o) => o.liq != null && o.liq > 0).length) / rd.length).toFixed(0)}% of ${rd.length}`);
    let fired = 0;
    let firedBeforeStop = 0;
    for (const c of pumpCoins) {
      const k = entryIndex(c, 0);
      if (k == null) continue;
      const pk = c.obs[k]!.p;
      let liqMax = c.obs[k]!.liq ?? 0;
      for (let i = k + 1; i < c.obs.length && c.obs[i]!.t - c.obs[k]!.t <= HORIZON_S; i++) {
        const o = c.obs[i]!;
        if (o.liq != null && o.liq > liqMax) liqMax = o.liq;
        if (o.liq != null && liqMax > 0 && o.liq <= 0.5 * liqMax) {
          fired++;
          if (o.p / pk > 0.5) firedBeforeStop++;
          break;
        }
      }
    }
    console.log(`   the liquidity guard (pool at half of its highest) would fire on ${fired} of the tau 0 PumpSwap coins, and on ${firedBeforeStop} of them while the price was still above the -50% stop`);
  }

  // --- who is in the sample: by day of the first look, how many PumpSwap coins are included at tau = 0, how many of those are dead, how many touch 2x
  console.log("\n   included PumpSwap coins by day of the first look (tau 0): day, coins, share dead at the end, share that touched 2x");
  const byDay = new Map<string, { n: number; dead: number; go2: number }>();
  for (const c of pumpCoins) {
    const k = entryIndex(c, 0);
    if (k == null) continue;
    const day = new Date(c.t0 * 1000).toISOString().slice(5, 10);
    const e = byDay.get(day) ?? { n: 0, dead: 0, go2: 0 };
    e.n++;
    if (c.obs[c.obs.length - 1]!.dead) e.dead++;
    const y = forwardLabels(c.obs, k, { rule: "auto" });
    if (y?.go2) e.go2++;
    byDay.set(day, e);
  }
  console.log("   " + [...byDay.entries()].sort().map(([d, e]) => `${d}: ${e.n} (${((100 * e.dead) / e.n).toFixed(0)}% dead, ${((100 * e.go2) / e.n).toFixed(0)}% 2x)`).join("  "));

  // --- the sims
  for (const tau of [0, 6]) {
    const rows = all.map((c) => ({ c, k: entryIndex(c, tau) })).filter((x): x is { c: CoinRow; k: number } => x.k != null);
    const populations: Array<[string, (c: CoinRow) => boolean]> = [
      ["PUMPSWAP (primary)", (c) => c.pump === true],
      ["OTHER pools", (c) => c.pump === false],
      ["ALL", () => true],
    ];
    for (const [pname, pred] of populations) {
      const set = rows.filter((r) => pred(r.c));
      if (set.length < 40) continue;
      const cut = Math.floor(0.6 * set.length);
      const nets = RULES.map((rule) => set.map((r) => simulate(r.c.obs, r.k, rule)));
      const val = nets.map((arr) => arr.map((s) => netFlat(s, STAKE)));
      const orders = nets.map((arr) => mean(arr.map((s) => s.length)));
      const reached2 = set.filter((r) => Math.max(...r.c.obs.slice(r.k).filter((o) => o.t - r.c.obs[r.k]!.t <= HORIZON_S).map((o) => o.p)) / r.c.obs[r.k]!.p >= 2).length;
      console.log(`\n== ${tau === 0 ? "1" : "2"}. ${pname}, entered ${tau === 0 ? "at the first look" : "6 hours after the first look"}: ${set.length} coins (${reached2} touched 2x within 72 h = ${((100 * reached2) / set.length).toFixed(0)}%), stake $${STAKE}, sold 5 minutes after a trigger, the owner's real cost per sale`);
      console.log("   id   rule".padEnd(78), "mean".padStart(6), "median".padStart(7), "orders".padStart(7), "  vs CURRENT [90%]".padEnd(22), "  vs PROPOSAL [90%]".padEnd(22), "later 40% vs PROPOSAL".padStart(22));
      RULES.forEach((rule, i) => {
        const d1 = val[i]!.map((x, j) => x - val[CUR]![j]!);
        const d2 = val[i]!.map((x, j) => x - val[PRO]![j]!);
        console.log(
          `   ${rule.id.padEnd(4)} ${rule.name}`.padEnd(78),
          `${((mean(val[i]!) - 1) * 100).toFixed(0)}%`.padStart(6),
          `${((median(val[i]!) - 1) * 100).toFixed(0)}%`.padStart(7),
          orders[i]!.toFixed(2).padStart(7),
          i === CUR ? "  (baseline)".padEnd(22) : `  ${pts(pairedBoot(d1))}`.padEnd(22),
          i === PRO ? "  (baseline)".padEnd(22) : `  ${pts(pairedBoot(d2))}`.padEnd(22),
          i === PRO ? "".padStart(22) : `${(mean(d2.slice(cut)) * 100).toFixed(0)} pts`.padStart(22),
        );
      });
      // the honest test: the best rule on the earlier 60% judged on the later 40%
      const early = val.map((arr) => mean(arr.slice(0, cut)));
      const bestI = early.indexOf(Math.max(...early));
      const lateBest = val[bestI]!.slice(cut);
      const latePro = val[PRO]!.slice(cut);
      const lateCur = val[CUR]!.slice(cut);
      const dB = lateBest.map((x, j) => x - latePro[j]!);
      const dC = lateBest.map((x, j) => x - lateCur[j]!);
      console.log(`   best on the earlier 60% (${cut} coins): ${RULES[bestI]!.id} ${RULES[bestI]!.name}; on the later ${set.length - cut} coins it makes ${((mean(lateBest) - 1) * 100).toFixed(0)}% against ${((mean(latePro) - 1) * 100).toFixed(0)}% for the proposal (diff ${pts(pairedBoot(dB))}) and ${((mean(lateCur) - 1) * 100).toFixed(0)}% for the current advice (diff ${pts(pairedBoot(dC))})`);
      // the coins that matter
      const big = set.map((r, j) => ({ j, m: Math.max(...r.c.obs.slice(r.k).filter((o) => o.t - r.c.obs[r.k]!.t <= HORIZON_S).map((o) => o.p)) / r.c.obs[r.k]!.p })).filter((x) => x.m >= 5).map((x) => x.j);
      if (big.length >= 10) console.log(`   on the ${big.length} coins that touched 5x (mean result, % of the stake): ${["A0", "A1", "A2", "A3", "B1", "B2t", "C10", "C25", "C40", "D1"].map((id) => `${id} ${((mean(big.map((j) => val[IDX.get(id)!]![j]!)) - 1) * 100).toFixed(0)}%`).join(" | ")}`);
    }
  }

  // --- 3. entry timing
  const touch2 = (c: CoinRow, k: number) => Math.max(...c.obs.slice(k).filter((o) => o.t - c.obs[k]!.t <= HORIZON_S).map((o) => o.p)) / c.obs[k]!.p >= 2;
  const lose24 = (c: CoinRow, k: number) => Math.min(...c.obs.slice(k).filter((o) => o.t - c.obs[k]!.t <= 24 * HOUR).map((o) => o.p)) / c.obs[k]!.p <= 0.5;
  console.log("\n== 3. Entry timing: the same exits for an entry N hours after the first look (a coin has to be alive and priced then; stake $3, real cost, 5 minutes late)");
  console.log("   pool        hours      n   lose half within 24 h   touch 2x   hold 72 h   CURRENT   all out at 2x   CURRENT vs hold [90%]   CURRENT: later entry minus first-look entry [90%]");
  const base0 = new Map<string, number[]>();
  for (const [pname, pred] of [["PUMPSWAP", (c: CoinRow) => c.pump === true], ["OTHER   ", (c: CoinRow) => c.pump === false]] as Array<[string, (c: CoinRow) => boolean]>) {
    for (const tau of [0, 1, 3, 6, 12, 24]) {
      const set = all.filter(pred).map((c) => ({ c, k: entryIndex(c, tau) })).filter((x): x is { c: CoinRow; k: number } => x.k != null);
      if (set.length < 30) continue;
      const v = (id: string) => set.map((r) => netFlat(simulate(r.c.obs, r.k, RULES[IDX.get(id)!]!), STAKE));
      const hold = v("A0");
      const cur = v("A1");
      const out = v("A3");
      const d = cur.map((x, j) => x - hold[j]!);
      if (tau === 0) base0.set(pname, cur);
      const b0 = base0.get(pname);
      let vs0 = "";
      if (b0 && tau > 0) {
        const rand = rng(23);
        const ds: number[] = [];
        for (let b = 0; b < 1000; b++) {
          let sa = 0;
          let sb = 0;
          for (let i = 0; i < cur.length; i++) sa += cur[Math.floor(rand() * cur.length)]!;
          for (let i = 0; i < b0.length; i++) sb += b0[Math.floor(rand() * b0.length)]!;
          ds.push(sa / cur.length - sb / b0.length);
        }
        ds.sort((x, y) => x - y);
        vs0 = `   ${((mean(cur) - mean(b0)) * 100).toFixed(0)} [${(ds[50]! * 100).toFixed(0)}, ${(ds[950]! * 100).toFixed(0)}] vs the first look`;
      }
      console.log(
        `   ${pname}  ${String(tau).padStart(5)} h ${String(set.length).padStart(6)}   ${(100 * set.filter((r) => lose24(r.c, r.k)).length / set.length).toFixed(0).padStart(18)}%   ${(100 * set.filter((r) => touch2(r.c, r.k)).length / set.length).toFixed(0).padStart(7)}%   ${((mean(hold) - 1) * 100).toFixed(0).padStart(8)}%   ${((mean(cur) - 1) * 100).toFixed(0).padStart(6)}%   ${((mean(out) - 1) * 100).toFixed(0).padStart(12)}%   ${pts(pairedBoot(d))}${vs0}`,
      );
    }
  }

  // --- 4. entry conditions (exploratory)
  console.log("\n== 4. Entry conditions, EXPLORATORY (PumpSwap coins; result of the CURRENT exit, real cost, stake $3; difference between the two groups with a 90% interval; nothing here is a finding until it holds on coins that come later)");
  type Cond = { id: string; text: string; a: string; b: string; f: (c: CoinRow, k: number) => boolean | null };
  const priceAgo = (c: CoinRow, k: number, s: number): number | null => {
    const t = c.obs[k]!.t - s;
    let j = k;
    while (j > 0 && c.obs[j]!.t > t) j--;
    return c.obs[j]!.t <= t + 600 ? c.obs[j]!.p : null;
  };
  const CONDS: Cond[] = [
    { id: "L1", text: "pool still 70% or more of its size at the first look", a: "kept", b: "shrank", f: (c, k) => (c.obs[0]!.liq && c.obs[k]!.liq != null ? c.obs[k]!.liq! / c.obs[0]!.liq! >= 0.7 : null) },
    { id: "L2", text: "price above its first-look price", a: "above", b: "below", f: (c, k) => c.obs[k]!.p >= c.obs[0]!.p },
    { id: "L3", text: "price already 2x or more of the first look (chasing)", a: "chasing", b: "not", f: (c, k) => c.obs[k]!.p >= 2 * c.obs[0]!.p },
    { id: "L4", text: "within 10% of the highest since the first look (a)  vs  30% or more below it (b)", a: "at the high", b: "30%+ below", f: (c, k) => { const hi = Math.max(...c.obs.slice(0, k + 1).map((o) => o.p)); const r = c.obs[k]!.p / hi; return r >= 0.9 ? true : r <= 0.7 ? false : null; } },
    { id: "L5", text: "rose 10%+ in the last hour (a)  vs  fell 10%+ (b)", a: "rising", b: "falling", f: (c, k) => { const p1 = priceAgo(c, k, HOUR); if (p1 == null) return null; const r = c.obs[k]!.p / p1; return r >= 1.1 ? true : r <= 0.9 ? false : null; } },
    { id: "L6", text: "pool of $20,000 or more", a: "big pool", b: "small pool", f: (c, k) => (c.obs[k]!.liq != null ? c.obs[k]!.liq! >= 20_000 : null) },
  ];
  for (const tau of [1, 6]) {
    const set = pumpCoins.map((c) => ({ c, k: entryIndex(c, tau) })).filter((x): x is { c: CoinRow; k: number } => x.k != null);
    const cur = set.map((r) => netFlat(simulate(r.c.obs, r.k, RULES[CUR]!), STAKE));
    console.log(`\n   entered ${tau} h after the first look: ${set.length} PumpSwap coins`);
    console.log("   condition".padEnd(86), "n a / n b".padStart(10), "  result a / b".padStart(15), "  touch 2x a / b".padStart(16), "  lose half 24 h a / b".padStart(22), "  a minus b [90%]");
    for (const cd of CONDS) {
      const flags = set.map((r) => cd.f(r.c, r.k));
      const ia = flags.map((f, j) => (f === true ? j : -1)).filter((j) => j >= 0);
      const ib = flags.map((f, j) => (f === false ? j : -1)).filter((j) => j >= 0);
      if (ia.length < 15 || ib.length < 15) { console.log(`   ${cd.id} ${cd.text}`.padEnd(86), `${ia.length} / ${ib.length}`.padStart(10), "  (too few)"); continue; }
      const ma = mean(ia.map((j) => cur[j]!));
      const mb = mean(ib.map((j) => cur[j]!));
      // bootstrap of the difference of the two group means
      const rand = rng(11);
      const ds: number[] = [];
      for (let b = 0; b < 1000; b++) {
        let sa = 0;
        let sb = 0;
        for (let i = 0; i < ia.length; i++) sa += cur[ia[Math.floor(rand() * ia.length)]!]!;
        for (let i = 0; i < ib.length; i++) sb += cur[ib[Math.floor(rand() * ib.length)]!]!;
        ds.push(sa / ia.length - sb / ib.length);
      }
      ds.sort((x, y) => x - y);
      const t2 = (idx: number[]) => (100 * idx.filter((j) => touch2(set[j]!.c, set[j]!.k)).length) / idx.length;
      const l24 = (idx: number[]) => (100 * idx.filter((j) => lose24(set[j]!.c, set[j]!.k)).length) / idx.length;
      console.log(
        `   ${cd.id} ${cd.text}`.padEnd(86),
        `${ia.length} / ${ib.length}`.padStart(10),
        `  ${((ma - 1) * 100).toFixed(0)}% / ${((mb - 1) * 100).toFixed(0)}%`.padStart(15),
        `  ${t2(ia).toFixed(0)}% / ${t2(ib).toFixed(0)}%`.padStart(16),
        `  ${l24(ia).toFixed(0)}% / ${l24(ib).toFixed(0)}%`.padStart(22),
        `  ${((ma - mb) * 100).toFixed(0)} [${(ds[Math.floor(0.05 * 1000)]! * 100).toFixed(0)}, ${(ds[Math.floor(0.95 * 1000)]! * 100).toFixed(0)}]`,
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
