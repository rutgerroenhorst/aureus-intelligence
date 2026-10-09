/**
 * `tsx src/grade.ts [horizon]` — grade the system against its own decisions.
 *
 * Prints, per verdict and per rejection reason, what the cohort actually did
 * afterwards. This is the report that decides whether the filters are protecting
 * the user or just refusing everything.
 */
import { getPool, closePool } from "@aureus/db";
import { cohortsByVerdict, cohortsByReason, formatCohorts } from "./cohorts.js";
import { measureVerdictOutcomes, VERDICT_HORIZONS } from "./verdicts.js";

const horizon = process.argv[2] ?? "h1";

async function main() {
  const pool = getPool();
  const m = await measureVerdictOutcomes(pool, Date.now(), 2000);
  console.log(`graded this run: ${m.measured} measured, ${m.unobservable} unobservable\n`);

  const coverage = await pool.query<{ horizon: string; measured: string; unobservable: string }>(
    `SELECT horizon,
            count(*) FILTER (WHERE status='MEASURED') AS measured,
            count(*) FILTER (WHERE status='UNOBSERVABLE') AS unobservable
       FROM verdict_outcomes GROUP BY 1 ORDER BY 1`,
  );
  console.log("coverage by horizon");
  for (const r of coverage.rows) console.log(`  ${r.horizon.padEnd(5)} measured=${r.measured}  unobservable=${r.unobservable}`);
  const anchors = await pool.query<{ n: string }>(`SELECT count(*) n FROM candidate_verdicts`);
  console.log(`  anchors recorded: ${anchors.rows[0]?.n ?? 0}\n`);

  // Why has ENTRY_READY never fired? Count how often each precondition is the
  // one holding it back, across every candidate that got close enough to matter.
  // Read the LIVE fleet state, not historical anchors: "what is stopping the system
  // from firing" is a question about the candidates on the board right now.
  const NEAR = `cas.status IN ('ENTRY_APPROACHING','SETUP_FORMING','FUNDAMENTAL_WATCH')`;
  const gates = await pool.query<{ gate: string; n: string }>(
    `SELECT g AS gate, count(*) AS n
       FROM candidate_action_status cas,
            LATERAL jsonb_array_elements_text(COALESCE(cas.reasons->'entryReadyBlockers','[]'::jsonb)) g
      WHERE ${NEAR}
      GROUP BY 1 ORDER BY count(*) DESC`,
  );
  const near = await pool.query<{ n: string }>(
    `SELECT count(*) n FROM candidate_action_status cas
      WHERE ${NEAR} AND cas.reasons ? 'entryReadyBlockers'`,
  );
  const nearN = Number(near.rows[0]?.n ?? 0);
  console.log(`ENTRY_READY BINDING CONSTRAINT (${nearN} candidates that got close)`);
  if (gates.rows.length === 0) console.log("  (no gate data recorded yet)\n");
  else {
    for (const g of gates.rows) {
      const share = nearN > 0 ? (Number(g.n) / nearN) * 100 : 0;
      const bar = "█".repeat(Math.round(share / 4));
      console.log(`  ${g.gate.padEnd(20)} ${String(g.n).padStart(4)}  ${share.toFixed(0).padStart(3)}% ${bar}`);
    }
    console.log("  the top row is what actually stops this system from ever firing.\n");
  }

  // Does the 30–55% concentration band — which passes our gate today but which
  // published trader practice would flag — actually underperform? This is the
  // question n=10 cannot answer and forward grading can.
  const bands = await pool.query<{ band: string; n: string; med_mfe: string | null; med_mae: string | null }>(
    `SELECT v.evidence->>'concentrationBand' AS band,
            count(*) AS n,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY o.mfe) FILTER (WHERE o.status='MEASURED') AS med_mfe,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY o.mae) FILTER (WHERE o.status='MEASURED') AS med_mae
       FROM candidate_verdicts v
       JOIN verdict_outcomes o ON o.verdict_id = v.id
      WHERE o.horizon = $1 AND v.evidence ? 'concentrationBand'
      GROUP BY 1 ORDER BY 1`,
    [horizon],
  );
  if (bands.rows.length) {
    console.log(`TOP-10 CONCENTRATION BAND vs OUTCOME (${horizon})`);
    console.log(`  ${"band".padEnd(12)} ${"n".padStart(4)} ${"medMFE".padStart(8)} ${"medMAE".padStart(8)}`);
    for (const b of bands.rows) {
      const pct = (v: string | null) => (v == null ? "     —" : `${(Number(v) * 100).toFixed(1).padStart(6)}%`);
      const flag = b.band === "30_55" ? "  ← passes our gate, industry would flag" : "";
      console.log(`  ${(b.band ?? "?").padEnd(12)} ${String(b.n).padStart(4)} ${pct(b.med_mfe)} ${pct(b.med_mae)}${flag}`);
    }
    console.log("  hard gate stays at 55% until these cohorts are large enough to move it.\n");
  }

  if (!VERDICT_HORIZONS.includes(horizon as never)) {
    console.log(`unknown horizon "${horizon}" — use one of ${VERDICT_HORIZONS.join(", ")}`);
  } else {
    console.log(formatCohorts(await cohortsByVerdict(pool, horizon), `BY VERDICT (${horizon})`));
    console.log(formatCohorts(await cohortsByReason(pool, horizon), `BY REJECTION REASON (${horizon})`));
    console.log(
      "reading it: high medMFE on a REJECTED cohort = we walked away from real moves.\n" +
      "deep medMAE on a REJECTED cohort = the rejection saved money.\n" +
      "high unobs = we stopped watching, so that cohort says nothing either way.",
    );
  }
  await closePool();
}

main().catch((e) => { console.error(e); process.exit(1); });
