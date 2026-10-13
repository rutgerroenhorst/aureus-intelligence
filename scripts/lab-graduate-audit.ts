/**
 * Does the Graduations tab's default view hide the coins that run? (the audit asked for after $VEIL, a graduation that went about 50x and never showed)
 *
 *   corepack pnpm exec tsx scripts/lab-graduate-audit.ts
 *
 * Read-only, laptop database. WRITTEN DOWN BEFORE LOOKING (2026-10-13):
 *  - COINS: every pump.fun graduation the laptop's stream recorded (table pump_graduates, via 'stream') that is at least 26 hours old, so that 24 hours after the first reading are over for all of them
 *    (a coin counts only when its window is over by the latest reading, dead or alive: docs/EXIT_PRACTICE.md, section 0).
 *  - WHAT THE TAB SHOWED: the tab's own rule (lib/graduates.ts, lib/lab/pump.ts): shown by default only when the coin is not "born" (graduated within 2 minutes of launch with a creator buy of 50 SOL or more) and not
 *    "mayhem", has readings, is not empty (first pool reading under $1,000) and not drained, and has a pool of at least REAL_LIQ/2. Evaluated with the readings of the FIRST HOUR only (what a person looking at
 *    the tab an hour after the graduation would have seen); a coin without a reading in that hour counts as "waiting" (hidden).
 *  - WHAT THE COIN DID: the highest level the price HELD (half an hour, several readings: lib/lab/paths.ts heldPeak) within 24 hours of the first reading, as a multiple of the first reading's price,
 *    and the same from the reading at about +1 h (a later buyer).
 *  - QUESTIONS: (1) how many graduations, in which hidden or shown group; (2) in each group the share that held 2x, 5x, 10x; (3) of the coins that held 5x and 10x, how many were hidden and why.
 * Coins that were never priced by the lab (like $VEIL, whose only DexScreener pair in the batch answer was an unpriced pump.fun pair) cannot appear here: the number of such coins is printed.
 */
import pg from "pg";
import { cleanObs, heldPeak, type Obs } from "../apps/web/lib/lab/paths";
import { gradFate, gradKind, isHealthy, type Reading } from "../apps/web/lib/lab/pump";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://aureus:aureus@localhost:5432/aureus", max: 2, statement_timeout: 300_000 });
const HOUR = 3600;
const num = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : x == null || x === "" ? NaN : Number(x);
  return Number.isFinite(n) ? n : null;
};

async function main() {
  const grads = (
    await pool.query(
      `SELECT g.mint, g.symbol, EXTRACT(EPOCH FROM g.migrated_at)::float8 AS migrated_s, g.create_to_migrate_min, g.initial_buy_sol, g.mayhem, g.creator_launches_72h
         FROM pump_graduates g WHERE g.via = 'stream' AND g.migrated_at < now() - interval '26 hours' ORDER BY g.migrated_at`,
    )
  ).rows;
  console.log(`${grads.length} graduations from the laptop's stream, at least 26 hours old`);
  const reads = new Map<string, Array<{ t: number; p: number | null; liq: number | null; mcap: number | null }>>();
  for (let i = 0; i < grads.length; i += 200) {
    const ms = grads.slice(i, i + 200).map((g) => g.mint as string);
    const r = await pool.query(
      `SELECT s.mint, EXTRACT(EPOCH FROM s.taken_at)::float8 AS t, (s.payload->>'p')::float8 AS p, (s.payload->>'liq')::float8 AS liq, COALESCE((s.payload->>'mcap')::float8, (s.payload->>'fdv')::float8) AS mcap
         FROM lab_signals_ts s WHERE s.source = 'watch' AND s.payload->>'gone' IS NULL AND s.mint = ANY($1::text[]) ORDER BY s.mint, s.taken_at`,
      [ms],
    );
    for (const x of r.rows) {
      const a = reads.get(x.mint) ?? [];
      a.push({ t: x.t, p: num(x.p), liq: num(x.liq), mcap: num(x.mcap) });
      reads.set(x.mint, a);
    }
  }
  interface Rec { mint: string; symbol: string; kind: string; shown: boolean; why: string; m24: number; m24late: number | null; n: number; mcap0: number | null; liq0: number | null }
  const recs: Rec[] = [];
  let neverRead = 0;
  for (const g of grads) {
    const rs = reads.get(g.mint) ?? [];
    if (rs.length < 3) {
      neverRead++;
      continue;
    }
    const obsRaw: Obs[] = rs.filter((r) => r.p != null && r.p > 0).map((r) => ({ t: r.t, p: r.p!, liq: r.liq }));
    const { clean } = cleanObs(obsRaw);
    if (clean.length < 3) continue;
    const t0 = clean[0]!.t;
    // the window has to be over by the latest reading of any coin
    recs.push({ mint: g.mint, symbol: g.symbol ?? "?", kind: "", shown: false, why: "", m24: 0, m24late: null, n: clean.length, mcap0: null, liq0: null });
    const rec = recs[recs.length - 1]!;
    const ctm = num(g.create_to_migrate_min);
    const kind = gradKind({ createToMigrateMin: ctm, devBuySol: num(g.initial_buy_sol), mayhem: g.mayhem });
    rec.kind = kind;
    // what the tab would have said after the first hour
    const firstHour: Reading[] = rs.filter((r) => r.t <= g.migrated_s + HOUR).map((r) => ({ t: r.t, p: r.p, liq: r.liq, mcap: r.mcap }));
    const fate = firstHour.length ? gradFate(g.migrated_s, firstHour) : null;
    const lastLiq = firstHour.length ? firstHour[firstHour.length - 1]!.liq : null;
    const healthy = isHealthy(kind, fate, lastLiq);
    rec.shown = healthy;
    rec.why = healthy ? "shown" : kind === "born" ? "born" : kind === "mayhem" ? "mayhem" : !fate ? "waiting" : fate.empty ? "empty" : fate.drained ? "drained" : "small";
    rec.mcap0 = rs[0]!.mcap;
    rec.liq0 = rs[0]!.liq;
    const hp = heldPeak(clean, "auto", 0, t0 + 24 * HOUR);
    rec.m24 = hp ? hp.level / clean[0]!.p : 0;
    // a later buyer: the first reading at least one hour in
    const k1 = clean.findIndex((o) => o.t - t0 >= HOUR);
    if (k1 >= 0 && clean[clean.length - 1]!.t - clean[k1]!.t >= 23 * HOUR) {
      const hp1 = heldPeak(clean, "auto", k1, clean[k1]!.t + 24 * HOUR);
      rec.m24late = hp1 ? hp1.level / clean[k1]!.p : 0;
    }
  }
  // the window must be over: keep coins whose readings reach at least 23 hours after the first reading, or that show a drained pool (nothing more can happen)
  const latest = Math.max(...[...reads.values()].map((a) => a[a.length - 1]!.t));
  const done = recs.filter((r) => {
    const rs = reads.get(r.mint)!;
    return rs[0]!.t + 25 * HOUR <= latest;
  });
  console.log(`${neverRead} graduations had fewer than 3 readings (never priced: like $VEIL), ${recs.length - done.length} too young, ${done.length} analysed`);

  const groups = ["shown", "born", "mayhem", "waiting", "empty", "drained", "small"];
  const pc = (k: number, n: number) => (n ? `${((100 * k) / n).toFixed(0)}% (${k})` : "-");
  console.log("\n== 1. By what the default view said after the first hour (24 h from the first reading; 'held' = the price stayed there for about half an hour)");
  console.log("   group       coins   held 2x        held 5x       held 10x      median multiple");
  for (const gname of ["ALL", ...groups]) {
    const s = gname === "ALL" ? done : done.filter((r) => r.why === gname);
    if (!s.length) continue;
    const med = [...s].map((r) => r.m24).sort((a, b) => a - b)[Math.floor(s.length / 2)]!;
    console.log(`   ${gname.padEnd(10)} ${String(s.length).padStart(6)}   ${pc(s.filter((r) => r.m24 >= 2).length, s.length).padEnd(13)}  ${pc(s.filter((r) => r.m24 >= 5).length, s.length).padEnd(12)}  ${pc(s.filter((r) => r.m24 >= 10).length, s.length).padEnd(12)}  ${med.toFixed(2)}x`);
  }
  console.log("\n== 2. Where the runners were: of the coins that held 5x / 10x within 24 h, how many the default view hid, and why");
  for (const thr of [2, 5, 10]) {
    const w = done.filter((r) => r.m24 >= thr);
    console.log(`   held ${thr}x: ${w.length} coins; ` + groups.map((gname) => `${gname} ${w.filter((r) => r.why === gname).length}`).join(", ") + `; hidden in all: ${w.filter((r) => !r.shown).length} (${((100 * w.filter((r) => !r.shown).length) / Math.max(1, w.length)).toFixed(0)}%)`);
  }
  console.log("\n== 3. The same for a buyer one hour later (24 h from the first reading at or after +1 h)");
  const late = done.filter((r) => r.m24late != null);
  console.log("   group       coins   held 2x        held 5x");
  for (const gname of ["ALL", ...groups]) {
    const s = gname === "ALL" ? late : late.filter((r) => r.why === gname);
    if (s.length < 5) continue;
    console.log(`   ${gname.padEnd(10)} ${String(s.length).padStart(6)}   ${pc(s.filter((r) => r.m24late! >= 2).length, s.length).padEnd(13)}  ${pc(s.filter((r) => r.m24late! >= 5).length, s.length).padEnd(12)}`);
  }
  // A multiple on a base price from a pool of a few dollars is not a run anyone could have bought: the biggest "runners" above are pools of $0-130. The same tables for coins whose FIRST pool reading was a pool a person
  // could actually have bought into (MIN_LIQ0), which is the question the tab has to answer.
  const MIN_LIQ0 = 5000;
  const real = done.filter((r) => (r.liq0 ?? 0) >= MIN_LIQ0);
  console.log(`\n== 1b. The same, only for coins whose first pool reading was at least $${MIN_LIQ0} (${real.length} of ${done.length}): the runs a person could have bought`);
  console.log("   group       coins   held 2x        held 5x       held 10x      median multiple");
  for (const gname of ["ALL", ...groups]) {
    const s = gname === "ALL" ? real : real.filter((r) => r.why === gname);
    if (!s.length) continue;
    const med = [...s].map((r) => r.m24).sort((a, b) => a - b)[Math.floor(s.length / 2)]!;
    console.log(`   ${gname.padEnd(10)} ${String(s.length).padStart(6)}   ${pc(s.filter((r) => r.m24 >= 2).length, s.length).padEnd(13)}  ${pc(s.filter((r) => r.m24 >= 5).length, s.length).padEnd(12)}  ${pc(s.filter((r) => r.m24 >= 10).length, s.length).padEnd(12)}  ${med.toFixed(2)}x`);
  }
  for (const thr of [2, 5, 10]) {
    const w = real.filter((r) => r.m24 >= thr);
    console.log(`   held ${thr}x: ${w.length} coins; ` + groups.map((gname) => `${gname} ${w.filter((r) => r.why === gname).length}`).join(", ") + `; hidden in all: ${w.filter((r) => !r.shown).length} (${((100 * w.filter((r) => !r.shown).length) / Math.max(1, w.length)).toFixed(0)}%)`);
  }
  console.log("\n== 4. The biggest runners (symbol, first mcap, first pool, multiple within 24 h, what the default view said); the ones with a first pool under $" + MIN_LIQ0 + " are marked: nobody could have bought them");
  for (const r of [...done].sort((a, b) => b.m24 - a.m24).slice(0, 12)) console.log(`   ${r.symbol.padEnd(12)} ${r.mcap0 != null ? "$" + Math.round(r.mcap0 / 1000) + "K" : "?"}  pool $${Math.round(r.liq0 ?? 0)}  ${r.m24.toFixed(1)}x  ${r.why} (${r.kind})${(r.liq0 ?? 0) < MIN_LIQ0 ? "  [pool too small to buy]" : ""}`);
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
