/**
 * Store the wallet transactions that were read as plain "received" tokens as the purchases (or sales) they are.
 *
 *   corepack pnpm exec tsx scripts/wallet-redecode.ts [--hosted] [--dry-run]
 *
 * Found 2026-10-13 from a screenshot of the owner's trading app: a gasless swap of $2 USDC into a coin can leave a crumb of a second token in the wallet next to tens of thousands of the coin
 * bought (17 of 511 transactions). The decoder (apps/web/lib/wallet.ts, decodeFills) used to call every transaction in which two coins arrived two unpriced transfers, so those coins had no
 * price paid, no position, no exit alert and no place in the wallet reviews. The decoder now reads the coin that is overwhelmingly the larger one as the coin traded (DUST_RATIO). This script
 * re-reads exactly the transactions whose stored rows are only transfers (two or more, one with a real amount), decodes them again and replaces their rows; then it updates the journal for
 * those coins. Idempotent: a transaction that is already stored as a buy or a sell is not looked at again.
 *
 * Default is the laptop's database; --hosted writes to the hosted one (LAB_SYNC_URL or the private file, see scripts/lib/hosted.ts). --dry-run reads and prints, writes nothing.
 * Prints coin and transaction prefixes only: never the wallet address.
 */
import { connectTo, hostedUrl, localUrl } from "./lib/hosted.js";
import { decodeFills, fetchTransaction, solUsdLookup } from "../apps/web/lib/wallet";
import { applyToJournal } from "../apps/web/lib/walletSync";

const hosted = process.argv.includes("--hosted");
const dry = process.argv.includes("--dry-run");
const url = hosted ? hostedUrl() : localUrl();
if (!url) {
  console.error("no database url");
  process.exit(2);
}
const db = await connectTo(url, "wallet-redecode");

const address = (await db.query(`SELECT address FROM wallet_watch ORDER BY added_at LIMIT 1`)).rows[0]?.address as string | undefined;
if (!address) {
  console.error("no wallet is followed in this database");
  process.exit(2);
}
const candidates = (
  await db.query(
    `SELECT signature FROM wallet_fills WHERE address = $1 GROUP BY signature
      HAVING bool_and(side IN ('in', 'out')) AND count(*) >= 2 AND max(tokens) > 1 ORDER BY min(t)`,
    [address],
  )
).rows.map((r) => r.signature as string);
console.log(`${hosted ? "hosted" : "laptop"} database: ${candidates.length} transaction(s) stored only as received tokens${dry ? " (dry run: nothing is written)" : ""}`);

const touched = new Set<string>();
let fixed = 0;
let unchanged = 0;
let unreadable = 0;
for (const sig of candidates) {
  const tx = await fetchTransaction(sig);
  if (!tx) {
    unreadable++;
    console.log(`  ${sig.slice(0, 6)}  could not be read now; left as it is`);
    continue;
  }
  const d = decodeFills(tx, address);
  if (!d.fills.length) {
    unchanged++;
    continue;
  }
  const t = new Date(Number(tx.blockTime) * 1000).toISOString().slice(0, 16).replace("T", " ");
  const solUsd = d.fills.some((f) => f.quote === "SOL") ? await solUsdLookup(Number(tx.blockTime) - 7 * 86400) : null;
  const fills = d.fills.map((f) => ({ ...f, usd: f.quote === "USD" ? f.quoteAmount : f.quoteAmount * (solUsd ? solUsd(f.t) : 0) }));
  for (const f of fills) console.log(`  ${sig.slice(0, 6)}  ${t} UTC  ${f.side} ${f.mint.slice(0, 6)}…  ${f.tokens.toFixed(f.tokens > 100 ? 0 : 3)} tokens for ${f.quote === "USD" ? "$" + f.quoteAmount.toFixed(2) : f.quoteAmount.toFixed(4) + " SOL"}`);
  if (!dry) {
    await db.query("BEGIN");
    try {
      await db.query(`DELETE FROM wallet_fills WHERE signature = $1 AND side IN ('in', 'out')`, [sig]);
      const rows = [
        ...fills.map((f) => ({ sig: f.sig, t: f.t, mint: f.mint, side: f.side, tokens: f.tokens, quote: f.quote as string | null, qa: f.quoteAmount as number | null, usd: f.usd as number | null })),
        ...d.transfers.map((x) => ({ sig: x.sig, t: x.t, mint: x.mint, side: x.tokens > 0 ? "in" : "out", tokens: Math.abs(x.tokens), quote: null as string | null, qa: null as number | null, usd: null as number | null })),
      ];
      await db.query(
        `INSERT INTO wallet_fills (signature, address, t, mint, side, tokens, quote, quote_amount, usd)
         SELECT v.sig, $1, to_timestamp(v.t), v.mint, v.side, v.tokens, v.quote, v.qa, v.usd
           FROM unnest($2::text[], $3::float8[], $4::text[], $5::text[], $6::float8[], $7::text[], $8::float8[], $9::float8[]) AS v(sig, t, mint, side, tokens, quote, qa, usd)
         ON CONFLICT (signature, mint, side) DO NOTHING`,
        [address, rows.map((r) => r.sig), rows.map((r) => r.t), rows.map((r) => r.mint), rows.map((r) => r.side), rows.map((r) => r.tokens), rows.map((r) => r.quote), rows.map((r) => r.qa), rows.map((r) => r.usd)],
      );
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    }
  }
  fixed++;
  for (const f of fills) touched.add(f.mint);
}
console.log(`${fixed} transaction(s) ${dry ? "would be " : ""}stored as purchases or sales, ${unchanged} not a purchase or sale (left as they are), ${unreadable} unreadable`);
if (!dry && touched.size) {
  const j = await applyToJournal(db as never, address, { mints: [...touched] });
  console.log(`journal: ${j.inserted} inserted, ${j.updated} updated, ${j.skipped} skipped`);
}
await db.end();
