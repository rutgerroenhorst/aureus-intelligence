/**
 * Copy the Learning Lab's lessons from one database to another (laptop -> hosted), so the hosted site starts with the same
 * depth instead of the 7 days of history it keeps.
 *
 *   TO_URL=postgres://...  corepack pnpm exec tsx scripts/lab-push.ts          # from the laptop database (FROM_URL to override)
 *   LAB_REPORTS=1 ...                                                         # also recompute the reports on the target afterwards
 *
 * What moves: the lessons (lab_coins), the hypotheses with their ORIGINAL registration dates, and the case studies (built from
 * live market data by scripts/lab-case.ts). What does not: the raw collector rows (the lessons already contain what they showed)
 * and the computed reports (they come from the target's own lessons, and the live ones depend on the target's own tables). A lesson only replaces the target's when it is at least as
 * complete (same rule the target's own rebuilds follow), so pushing twice, or pushing after the hosted site learned
 * something, never loses anything.
 */
import pg from "pg";
import { REPLACE_IF_MORE_COMPLETE } from "../apps/web/lib/lab/builder";
import { computeReports, saveReports } from "../apps/web/lib/lab/reports";

const fromUrl = process.env.FROM_URL ?? "postgres://aureus:aureus@localhost:5432/aureus";
const toUrl = process.env.TO_URL;
if (!toUrl) {
  console.error("TO_URL is required (the database to copy the lessons into).");
  process.exit(1);
}
if (fromUrl === toUrl) {
  console.error("FROM_URL and TO_URL are the same database.");
  process.exit(1);
}

const from = new pg.Pool({ connectionString: fromUrl, max: 2 });
const to = new pg.Pool({ connectionString: toUrl, max: 2, statement_timeout: 120_000 });
const PAGE = 60;

async function main() {
  const t0 = Date.now();

  // hypotheses: the earliest registration date always wins (a hypothesis registered earlier is the stronger claim)
  const hyp = await from.query(`SELECT id, registered_at, title, statement, definition, note FROM lab_hypotheses`);
  for (const h of hyp.rows) {
    await to.query(
      `INSERT INTO lab_hypotheses (id, registered_at, title, statement, definition, note) VALUES ($1,$2,$3,$4,$5::jsonb,$6)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, statement = EXCLUDED.statement, definition = EXCLUDED.definition,
         note = EXCLUDED.note, registered_at = LEAST(lab_hypotheses.registered_at, EXCLUDED.registered_at)`,
      [h.id, h.registered_at, h.title, h.statement, JSON.stringify(h.definition), h.note],
    );
  }
  console.log(`hypotheses: ${hyp.rows.length} copied`);

  const cases = await from.query(`SELECT kind, computed_at, n_coins, payload FROM lab_reports WHERE kind = 'cases'`);
  for (const c of cases.rows) {
    await to.query(
      `INSERT INTO lab_reports (kind, computed_at, n_coins, payload) VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (kind) DO UPDATE SET computed_at = EXCLUDED.computed_at, n_coins = EXCLUDED.n_coins, payload = EXCLUDED.payload`,
      [c.kind, c.computed_at, c.n_coins, JSON.stringify(c.payload)],
    );
  }
  console.log(`case studies: ${cases.rows.length} copied`);

  // lessons, keyset-paged by mint; the rows travel as JSON and are turned back into rows by the target's own column types
  let last = "";
  let seen = 0;
  let written = 0;
  for (;;) {
    const { rows } = await from.query(`SELECT to_jsonb(l) AS j, l.mint FROM lab_coins l WHERE l.mint > $1 ORDER BY l.mint LIMIT ${PAGE}`, [last]);
    if (!rows.length) break;
    last = rows[rows.length - 1].mint;
    const r = await to.query(
      `INSERT INTO lab_coins SELECT * FROM jsonb_populate_recordset(NULL::lab_coins, $1::jsonb)
       ON CONFLICT (mint) DO UPDATE SET
         chain = EXCLUDED.chain, candidate_id = EXCLUDED.candidate_id, symbol = EXCLUDED.symbol, name = EXCLUDED.name, lane = EXCLUDED.lane,
         first_seen_at = EXCLUDED.first_seen_at, pair_created_at = EXCLUDED.pair_created_at, first_price = EXCLUDED.first_price,
         first_mcap = EXCLUDED.first_mcap, first_liq = EXCLUDED.first_liq, last_seen_at = EXCLUDED.last_seen_at,
         observations = EXCLUDED.observations, phantoms = EXCLUDED.phantoms, tags = EXCLUDED.tags, snaps = EXCLUDED.snaps,
         outcome = EXCLUDED.outcome, status = EXCLUDED.status, source = EXCLUDED.source, built_at = EXCLUDED.built_at
       WHERE ${REPLACE_IF_MORE_COMPLETE}`,
      [JSON.stringify(rows.map((x) => x.j))],
    );
    seen += rows.length;
    written += r.rowCount ?? 0;
    if ((seen / PAGE) % 5 === 0 || rows.length < PAGE) console.log(`  ${seen} lessons read, ${written} written`);
  }
  console.log(`lessons: ${seen} read, ${written} written, ${seen - written} kept (target already had a more complete one)`);

  if (process.env.LAB_REPORTS) {
    const reports = await computeReports(to);
    await saveReports(to, reports);
    console.log(`reports recomputed on the target: ${Object.keys(reports).join(", ")}`);
  }
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await from.end().catch(() => undefined);
    await to.end().catch(() => undefined);
  });
