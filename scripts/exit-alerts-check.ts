/**
 * What the exit alerts see right now, without sending or storing anything.
 *
 *   corepack pnpm exec tsx scripts/exit-alerts-check.ts [--all]
 *
 * For every coin the followed wallet still holds (first in first out): what is still held, the price paid for it, the price now, the
 * multiple, what it is worth, the levels it has reached and whether an alert could be sent for it (a real pool, more than dust). Reads only
 * wallet_fills, my_trades and exit_alerts; never selects the wallet address, never touches Telegram or the token.
 */
import pg from "pg";
import { currentPositions, newPassState, pgStore } from "../apps/worker/src/exitLoop";
import { dexQuotes } from "../apps/worker/src/exitLoop";
import { LEVELS_DEFAULT, fmtMultiple, fmtPrice, fmtUsd, readPosition } from "../apps/web/lib/exitAlerts";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://aureus:aureus@localhost:5432/aureus", max: 2 });
const ALL = process.argv.includes("--all");

async function main() {
  const store = pgStore(pool);
  const held = await currentPositions({ store, prices: (m) => dexQuotes(m) }, newPassState());
  const symbols = await store.symbols(held.map((h) => h.pos.mint));
  const rows = held
    .map(({ pos, q }) => ({ pos, q, r: q ? readPosition(pos, q, LEVELS_DEFAULT) : null, sym: symbols.get(pos.mint) ?? q?.symbol ?? pos.mint.slice(0, 6) }))
    .sort((a, b) => (b.r?.multiple ?? -1) - (a.r?.multiple ?? -1));
  const priced = rows.filter((x) => x.r);
  console.log(`${rows.length} positions held, ${priced.length} with a price, ${priced.filter((x) => x.r!.alertable).length} that an alert could be sent for`);
  console.log("coin           held value   paid for it  now         multiple  levels   alertable");
  for (const x of rows) {
    if (!ALL && !(x.r && x.r.value >= 0.3)) continue;
    const r = x.r!;
    console.log(
      `${x.sym.slice(0, 13).padEnd(14)} ${fmtUsd(r.value).padStart(10)}   ${fmtPrice(x.pos.basis).padEnd(11)} ${fmtPrice(x.q!.price).padEnd(11)} ${fmtMultiple(r.multiple).padStart(8)}  ${(r.reached.map((l) => l + "x").join(",") || "-").padEnd(7)}  ${r.alertable ? "yes" : "no (pool $" + Math.round(x.q!.liq) + ")"}`,
    );
  }
  const st = await pool.query(`SELECT state, count(*)::int AS n FROM exit_alerts GROUP BY 1 ORDER BY 1`);
  console.log("recorded so far:", st.rows.length ? st.rows.map((r) => `${r.state} ${r.n}`).join(", ") : "nothing");
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
