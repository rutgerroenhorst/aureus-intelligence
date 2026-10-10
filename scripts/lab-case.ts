/**
 * Build the Learning Lab's case studies (HOTBOT) from live market data and store them in lab_reports (kind "cases").
 *
 *   corepack pnpm exec tsx scripts/lab-case.ts                       # laptop database
 *   DATABASE_URL=<hosted url> corepack pnpm exec tsx scripts/lab-case.ts   # or straight into the hosted database
 *
 * The hosted site only reads the stored result. GeckoTerminal refuses often from a busy address; the script retries with a pause.
 */
import pg from "pg";
import { buildHotbotCase } from "../apps/web/lib/lab/cases";

const url = process.env.DATABASE_URL ?? "postgres://aureus:aureus@localhost:5432/aureus";
const pool = new pg.Pool({ connectionString: url, max: 1 });

async function main() {
  const c = await buildHotbotCase();
  if (!c) throw new Error("Could not read HOTBOT from DexScreener right now; nothing stored.");
  if (c.series.length < 24) throw new Error(`Only ${c.series.length} hourly candles came back (GeckoTerminal is probably rate limiting); nothing stored, try again in a few minutes.`);
  await pool.query(
    `INSERT INTO lab_reports (kind, computed_at, n_coins, payload) VALUES ('cases', now(), 0, $1::jsonb)
     ON CONFLICT (kind) DO UPDATE SET computed_at = now(), payload = EXCLUDED.payload`,
    [JSON.stringify({ items: [c] })],
  );
  console.log(`stored case "${c.title}": ${c.series.length} hourly closes, ${c.facts.length} facts, door crossed after ${c.door.crossedAtH?.toFixed(1) ?? "?"} h, cap at 60 min $${Math.round(c.door.mcapAtMinAge ?? 0)}`);
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => pool.end());
