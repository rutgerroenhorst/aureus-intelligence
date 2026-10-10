/**
 * Test ideas from outside research on the coins this system has actually followed, before building anything on them.
 *
 *   corepack pnpm exec tsx scripts/lab-ideas-check.ts
 *
 * The ideas and their definitions are fixed here, in advance, and each is run once (no tuning on the result):
 *
 *   T1  a PumpSwap pool for a coin that was NOT launched on pump.fun ("foreign pool": the pool was made by hand, not by a graduation)
 *   T2  wash-like trading: many trades per wallet in the last hour
 *   T3  independent demand: unique buyers in the last hour
 *   T4  copycats: other coins with the same symbol seen within 24 hours of the first look
 *   T5  entry timing: the first pullback that holds above the base, entered when it bounces 15% off its low, compared with a
 *       reading of the same coin at about the same age (same coin, same age: only the timing differs)
 *   T6  holders at the first look (RugCheck, graduations): one wallet >= 20%, insider networks >= 5%, liquidity not locked
 *
 * Outcomes are the lab's own: held 2x within 72 h, lost half within 24 h, and the exit plan's result; only decided windows count.
 * Differences are reported with Fisher's exact test or a bootstrap interval. Nothing is stored.
 */
import pg from "pg";
import { loadLabCoins, loadObs, selectCandidates, selectWatch, type LabCoin } from "../apps/web/lib/lab/builder";
import { cleanObs, type Obs } from "../apps/web/lib/lab/paths";
import { forwardLabels, type Fwd } from "../apps/web/lib/lab/outcomes";
import { bootDiffCi, fisherExact, rng } from "../apps/web/lib/lab/stats";
import { buildGraduates } from "../apps/web/lib/graduates";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://aureus:aureus@localhost:5432/aureus", max: 2, statement_timeout: 300_000 });

interface Row {
  y: Fwd | null;
}
const pc = (k: number, n: number) => (n ? `${((100 * k) / n).toFixed(0)}% (${k}/${n})` : "-");
function stat(rows: Row[]) {
  const d2 = rows.filter((r) => r.y?.go2 != null);
  const dc = rows.filter((r) => r.y?.collapse24 != null);
  const de = rows.filter((r) => r.y?.ev != null);
  return {
    n: rows.length,
    go2: { k: d2.filter((r) => r.y!.go2).length, n: d2.length },
    lost: { k: dc.filter((r) => r.y!.collapse24).length, n: dc.length },
    ev: de.length ? de.reduce((a, r) => a + (r.y!.ev as number), 0) / de.length : null,
    evs: de.map((r) => r.y!.ev as number),
  };
}
type S = ReturnType<typeof stat>;
const line = (label: string, s: S) => `  ${label.padEnd(46)} n=${String(s.n).padStart(4)}  held 2x ${pc(s.go2.k, s.go2.n).padEnd(14)} lost half in a day ${pc(s.lost.k, s.lost.n).padEnd(14)} plan ${s.ev == null ? "-" : `${((s.ev - 1) * 100).toFixed(0)}%`}`;
function vs(a: S, b: S, la: string, lb: string) {
  const p2 = a.go2.n && b.go2.n ? fisherExact(a.go2.k, a.go2.n - a.go2.k, b.go2.k, b.go2.n - b.go2.k) : null;
  const pl = a.lost.n && b.lost.n ? fisherExact(a.lost.k, a.lost.n - a.lost.k, b.lost.k, b.lost.n - b.lost.k) : null;
  const ci = a.evs.length >= 8 && b.evs.length >= 8 ? bootDiffCi(a.evs, b.evs) : null;
  console.log(`    ${la} vs ${lb}: held-2x p=${p2 == null ? "-" : p2.toFixed(3)}, lost-half p=${pl == null ? "-" : pl.toFixed(3)}${ci ? `, plan difference ${(ci.diff * 100).toFixed(0)} points [${(ci.lo * 100).toFixed(0)}, ${(ci.hi * 100).toFixed(0)}]` : ""}`);
}

const snap0 = (c: LabCoin) => c.snaps.find((s) => s.tau === 0);
const f0 = (c: LabCoin, k: string): number | null => {
  const v = snap0(c)?.f[k];
  return v == null || !Number.isFinite(v) ? null : v;
};

async function main() {
  const coins = await loadLabCoins(pool);
  console.log(`${coins.length} lessons (${coins.filter((c) => snap0(c)?.y?.go2 != null).length} with a decided 72-hour window at the first look)\n`);
  const rows = coins.map((c) => ({ c, y: snap0(c)?.y ?? null }));
  const all = stat(rows);
  console.log(line("ALL lessons, first look", all));

  // T1: foreign PumpSwap pools
  console.log("\nT1  PumpSwap pool for a coin that was not launched on pump.fun");
  const ps = rows.filter((r) => f0(r.c, "dex_pumpswap") === 1);
  const known = ps.filter((r) => f0(r.c, "lp_pump") != null);
  const canon = stat(known.filter((r) => f0(r.c, "lp_pump") === 1));
  const foreign = stat(known.filter((r) => f0(r.c, "lp_pump") === 0));
  console.log(line("PumpSwap, launched on pump.fun", canon));
  console.log(line("PumpSwap, launched elsewhere (foreign pool)", foreign));
  console.log(line("not on PumpSwap", stat(rows.filter((r) => f0(r.c, "dex_pumpswap") === 0))));
  vs(foreign, canon, "foreign", "pump.fun-launched");

  // T2 / T3: wash-like trading and independent demand (collected for coins seen after the collectors started)
  console.log("\nT2  trades per wallet in the last hour (wash-like when high)   T3  unique buyers in the last hour");
  const tpw = (r: { c: LabCoin }) => {
    for (const tau of [0, 1, 3]) {
      const v = r.c.snaps.find((s) => s.tau === tau)?.f.wallet_trades;
      if (v != null && Number.isFinite(v)) return v;
    }
    return null;
  };
  const withTpw = rows.filter((r) => tpw(r) != null);
  console.log(`  coins with the figure: ${withTpw.length}`);
  const lowT = stat(withTpw.filter((r) => tpw(r)! < 3));
  const midT = stat(withTpw.filter((r) => tpw(r)! >= 3 && tpw(r)! < 10));
  const highT = stat(withTpw.filter((r) => tpw(r)! >= 10));
  console.log(line("under 3 trades per wallet", lowT));
  console.log(line("3 to 10 trades per wallet", midT));
  console.log(line("10 or more trades per wallet", highT));
  vs(highT, lowT, "10+", "<3");
  const ub = (r: { c: LabCoin }) => {
    for (const tau of [0, 1, 3]) {
      const v = r.c.snaps.find((s) => s.tau === tau)?.f.uniq_buyers_h1;
      if (v != null && Number.isFinite(v)) return v;
    }
    return null;
  };
  const withUb = rows.filter((r) => ub(r) != null);
  console.log(`  coins with unique-buyer figures: ${withUb.length}`);
  const fewB = stat(withUb.filter((r) => ub(r)! < 100));
  const manyB = stat(withUb.filter((r) => ub(r)! >= 300));
  console.log(line("under 100 unique buyers in the hour", fewB));
  console.log(line("300 or more unique buyers in the hour", manyB));
  vs(manyB, fewB, "300+", "<100");

  // T4: copycats (same symbol within 24 h of the first look, among the coins this system saw)
  console.log("\nT4  other coins with the same symbol within 24 hours of the first look");
  const key = (c: LabCoin) => (c.symbol ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const bySym = new Map<string, LabCoin[]>();
  for (const c of coins) {
    const k = key(c);
    if (k.length >= 2) (bySym.get(k) ?? bySym.set(k, []).get(k)!).push(c);
  }
  const dupes = (c: LabCoin) => (bySym.get(key(c)) ?? []).filter((o) => o !== c && Math.abs(o.firstSeenAt - c.firstSeenAt) <= 86_400).length;
  const rowsD = rows.filter((r) => key(r.c).length >= 2);
  const d0 = stat(rowsD.filter((r) => dupes(r.c) === 0));
  const d1 = stat(rowsD.filter((r) => dupes(r.c) >= 1 && dupes(r.c) <= 2));
  const d3 = stat(rowsD.filter((r) => dupes(r.c) >= 3));
  console.log(line("no other coin with this symbol", d0));
  console.log(line("1 to 2 others", d1));
  console.log(line("3 or more others", d3));
  vs(d3, d0, "3+ copies", "none");
  const first = rowsD.filter((r) => dupes(r.c) >= 1 && !(bySym.get(key(r.c)) ?? []).some((o) => o !== r.c && o.firstSeenAt < r.c.firstSeenAt && r.c.firstSeenAt - o.firstSeenAt <= 86_400));
  const later = rowsD.filter((r) => dupes(r.c) >= 1 && (bySym.get(key(r.c)) ?? []).some((o) => o !== r.c && o.firstSeenAt < r.c.firstSeenAt && r.c.firstSeenAt - o.firstSeenAt <= 86_400));
  const sFirst = stat(first);
  const sLater = stat(later);
  console.log(line("first of several with this symbol", sFirst));
  console.log(line("a later copy", sLater));
  vs(sFirst, sLater, "first", "later copy");

  // T5: entry timing on the price paths
  console.log("\nT5  first pullback above the base, entered on a 15% bounce, against a reading of the same coin at about the same age");
  const cands = [...(await selectCandidates(pool, { limit: 1_000_000, all: true })), ...(await selectWatch(pool, { limit: 1_000_000, all: true }))];
  const rand = rng(11);
  const pat: Array<{ y: Fwd | null }> = [];
  const same: Array<{ y: Fwd | null }> = [];
  const firstLook: Array<{ y: Fwd | null }> = [];
  let found = 0;
  for (let b = 0; b < cands.length; b += 40) {
    const batch = cands.slice(b, b + 40);
    const obs = await loadObs(pool, batch);
    for (const c of batch) {
      const raw = obs.get(c.pool_id) ?? [];
      const { clean } = cleanObs(raw);
      const i = pullbackEntry(clean);
      if (i < 0) continue;
      found++;
      const y = forwardLabels(clean, i, { rule: "auto" });
      // a reading of the same coin at about the same age (50% to 150%), with real liquidity, not the entry itself
      const age = clean[i]!.t - clean[0]!.t;
      const pool2: number[] = [];
      for (let j = 1; j < clean.length; j++) {
        const a = clean[j]!.t - clean[0]!.t;
        if (j !== i && a >= 0.5 * age && a <= 1.5 * age && (clean[j]!.liq ?? 0) >= 5000) pool2.push(j);
      }
      if (!pool2.length) continue;
      const j = pool2[Math.floor(rand() * pool2.length)]!;
      pat.push({ y });
      same.push({ y: forwardLabels(clean, j, { rule: "auto" }) });
      firstLook.push({ y: forwardLabels(clean, 0, { rule: "auto" }) });
    }
  }
  console.log(`  ${cands.length} coins with a path, ${found} formed the pattern, ${pat.length} with a comparison reading`);
  const sp = stat(pat);
  const ss = stat(same);
  const sf = stat(firstLook);
  console.log(line("entered on the pullback bounce", sp));
  console.log(line("same coin, a reading at about the same age", ss));
  console.log(line("same coin, the first look", sf));
  vs(sp, ss, "pullback", "same age");
  vs(sp, sf, "pullback", "first look");

  // T6: holders at the first look, on graduations with a RugCheck snapshot that are at least an hour old
  console.log("\nT6  holders at the first look (RugCheck), graduations at least an hour old, real pool");
  const g = await buildGraduates(pool as never);
  const gr = g.candidates.filter((c) => c.rc && c.ageMin >= 60 && !c.empty && c.kind !== "mayhem");
  const bad = (c: (typeof gr)[number]) => c.drained || (c.sinceFirst != null && c.sinceFirst <= 0.5);
  const tab = (label: string, sel: (c: (typeof gr)[number]) => boolean) => {
    const a = gr.filter(sel);
    const b = gr.filter((c) => !sel(c));
    console.log(`  ${label.padEnd(40)} with: ${pc(a.filter(bad).length, a.length).padEnd(14)} without: ${pc(b.filter(bad).length, b.length).padEnd(14)} (share drained or halved)`);
  };
  console.log(`  ${gr.length} graduations (all kinds except Mayhem) have a snapshot and are at least an hour old; share that was drained or down by half`);
  tab("one wallet holds 20% or more", (c) => (c.rc!.top1 ?? 0) >= 0.2);
  tab("insider networks hold 5% or more", (c) => (c.rc!.insPct ?? 0) >= 0.05);
  tab("liquidity not locked (under 50%)", (c) => c.rc!.lp != null && c.rc!.lp < 50);
  tab("under 200 holders", (c) => (c.rc!.holders ?? 1e9) < 200);
  tab("born graduated", (c) => c.kind === "born");
  await pool.end();
}

/** The first pullback that holds above the base, as the index of the reading that enters it, or -1. Uses only readings up to that index. */
function pullbackEntry(clean: Obs[]): number {
  const n = clean.length;
  if (n < 12) return -1;
  let minSoFar = clean[0]!.p;
  let iImp = -1;
  let H = 0;
  let B = 0;
  for (let i = 1; i < n; i++) {
    minSoFar = Math.min(minSoFar, clean[i]!.p);
    if (clean[i]!.p >= 1.5 * minSoFar) {
      iImp = i;
      H = clean[i]!.p;
      B = minSoFar;
      break;
    }
  }
  if (iImp < 0) return -1;
  let L = Infinity;
  let inPull = false;
  for (let i = iImp + 1; i < n; i++) {
    const p = clean[i]!.p;
    if (!inPull) {
      if (p > H) {
        H = p;
        continue;
      }
      if (p <= 0.8 * H) {
        inPull = true;
        L = p;
      }
      continue;
    }
    if (p < B) return -1; // the base is lost: no pattern
    if (p < L) {
      L = p;
      if (L < 0.5 * H) return -1; // a collapse, not a pullback
      continue;
    }
    if (L > B && p >= 1.15 * L) return (clean[i]!.liq ?? 0) >= 5000 ? i : -1;
  }
  return -1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
