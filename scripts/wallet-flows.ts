/**
 * Look for deposits and withdrawals (SOL sent to or from the followed wallet outside trades) in the transactions the wallet sync read before it knew
 * about them: every transaction that produced no fill and has not been looked at for flows yet is read once more through the free public RPC,
 * paced like the sync, and what it holds goes into wallet_flows with its dollar value at that time. Resumable and idempotent: a transaction that
 * cannot be read now stays marked "not looked at" and is tried the next time.
 *
 *   corepack pnpm exec tsx scripts/wallet-flows.ts                 # the laptop database (DATABASE_URL, default local)
 *   corepack pnpm exec tsx scripts/wallet-flows.ts --dry-run       # print the totals, store nothing
 *   corepack pnpm exec tsx scripts/wallet-flows.ts --reprice       # recompute the dollar value of the stored flows from SOL's price at their time
 *
 * Afterwards the laptop loop copies the rows to the hosted database (or scripts/wallet-push.ts does). Never prints the address in full.
 */
import pg from "pg";
import { decodeFlows, fetchTransaction, solUsdLookup, type Flow } from "../apps/web/lib/wallet";
import { maskAddress, storeFlows } from "../apps/web/lib/walletSync";

const dry = process.argv.includes("--dry-run");
const reprice = process.argv.includes("--reprice");
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://aureus:aureus@localhost:5432/aureus", max: 2 });

async function repriceAll() {
  const rows = (await db.query(`SELECT signature, direction, n, amount, EXTRACT(EPOCH FROM t)::float8 AS t FROM wallet_flows ORDER BY t`)).rows as Array<{ signature: string; direction: string; n: number; amount: number; t: number }>;
  if (!rows.length) return console.log("no flows stored");
  const price = await solUsdLookup(rows[0]!.t - 3600);
  let changed = 0;
  for (const r of rows) {
    const p = price(r.t);
    await db.query(`UPDATE wallet_flows SET usd = $4 WHERE signature = $1 AND direction = $2 AND n = $3`, [r.signature, r.direction, r.n, p > 0 ? r.amount * p : null]);
    changed++;
  }
  console.log(`repriced ${changed} flows`);
  const total = (await db.query(`SELECT direction, count(*)::int AS n, sum(amount) AS sol, sum(usd) AS usd, count(*) FILTER (WHERE usd IS NULL)::int AS unpriced FROM wallet_flows GROUP BY direction ORDER BY direction`)).rows;
  for (const r of total) console.log(`  ${r.direction === "in" ? "deposits" : "withdrawals"} ${r.n} = ${Number(r.sol).toFixed(4)} SOL = $${Number(r.usd).toFixed(2)}${r.unpriced ? ` (${r.unpriced} without a price)` : ""}`);
}

async function main() {
  if (reprice) return repriceAll();
  for (const w of (await db.query(`SELECT address FROM wallet_watch`)).rows as Array<{ address: string }>) {
    const todo = (
      await db.query(
        `SELECT t.signature FROM wallet_txs t
          WHERE t.address = $1 AND t.state = 'done' AND NOT t.flows_read
            AND NOT EXISTS (SELECT 1 FROM wallet_fills f WHERE f.signature = t.signature)
          ORDER BY t.block_time`,
        [w.address],
      )
    ).rows.map((r) => r.signature as string);
    console.log(`${maskAddress(w.address)}: ${todo.length} transactions without a trade to look at`);
    const flows: Flow[] = [];
    const looked: string[] = [];
    let unreadable = 0;
    for (const sig of todo) {
      const tx = await fetchTransaction(sig);
      if (!tx) {
        unreadable++;
        continue;
      }
      flows.push(...decodeFlows(tx, w.address));
      looked.push(sig);
    }
    const deposits = flows.filter((f) => f.direction === "in");
    const withdrawals = flows.filter((f) => f.direction === "out");
    const sum = (l: Flow[]) => l.reduce((a, f) => a + f.amount, 0);
    console.log(`  read ${looked.length}, unreadable ${unreadable}: ${deposits.length} deposits (${sum(deposits).toFixed(4)} SOL), ${withdrawals.length} withdrawals (${sum(withdrawals).toFixed(4)} SOL)`);
    if (dry) continue;
    if (flows.length) {
      const price = await solUsdLookup(Math.min(...flows.map((f) => f.t)) - 3600);
      await storeFlows(db, w.address, flows, price);
    }
    if (looked.length) await db.query(`UPDATE wallet_txs SET flows_read = true WHERE signature = ANY($1::text[])`, [looked]);
    // transactions that did produce fills are trades: nothing to look for in them
    await db.query(`UPDATE wallet_txs t SET flows_read = true WHERE t.address = $1 AND NOT t.flows_read AND EXISTS (SELECT 1 FROM wallet_fills f WHERE f.signature = t.signature)`, [w.address]);
    const total = (await db.query(`SELECT direction, count(*)::int AS n, sum(amount) AS sol, sum(usd) AS usd FROM wallet_flows WHERE address = $1 GROUP BY direction ORDER BY direction`, [w.address])).rows;
    for (const r of total) console.log(`  stored: ${r.direction === "in" ? "deposits" : "withdrawals"} ${r.n} = ${Number(r.sol).toFixed(4)} SOL = $${Number(r.usd).toFixed(2)}`);
  }
}
main().catch((e) => { console.error(String((e as Error)?.message ?? e).replace(/postgres(ql)?:\/\/\S+/g, "postgres://***")); process.exitCode = 1; }).finally(() => db.end());
