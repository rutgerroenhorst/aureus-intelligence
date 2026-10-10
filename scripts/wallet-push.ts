/**
 * Copy what the wallet sync has read (laptop database) to another database (the hosted one) and update that database's trade journal,
 * so the hosted site starts with the whole history instead of reading 400 transactions through a rate-limited public node.
 *
 *   TO_URL=postgres://...  corepack pnpm exec tsx scripts/wallet-push.ts       # FROM_URL defaults to the laptop database
 *
 * Idempotent: transactions and fills are copied with ON CONFLICT DO NOTHING, and the journal update recomputes from the fills.
 * The address is copied into the target's wallet_watch (it is never printed in full).
 */
import pg from "pg";
import { applyToJournal, maskAddress } from "../apps/web/lib/walletSync";

const fromUrl = process.env.FROM_URL ?? "postgres://aureus:aureus@localhost:5432/aureus";
const toUrl = process.env.TO_URL;
if (!toUrl) {
  console.error("TO_URL is required.");
  process.exit(1);
}
if (fromUrl === toUrl) {
  console.error("FROM_URL and TO_URL are the same database.");
  process.exit(1);
}
const from = new pg.Pool({ connectionString: fromUrl, max: 2 });
const to = new pg.Pool({ connectionString: toUrl, max: 2, statement_timeout: 120_000 });

async function main() {
  const watch = (await from.query(`SELECT address, label, added_at, synced_at, newest_sig FROM wallet_watch`)).rows;
  for (const w of watch) {
    await to.query(
      `INSERT INTO wallet_watch (address, label, added_at, synced_at, newest_sig) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (address) DO UPDATE SET synced_at = EXCLUDED.synced_at, newest_sig = EXCLUDED.newest_sig`,
      [w.address, w.label, w.added_at, w.synced_at, w.newest_sig],
    );
    console.log(`following ${maskAddress(w.address)} on the target`);
    const txs = (await from.query(`SELECT signature, address, block_time, state, tries, last_try FROM wallet_txs WHERE address = $1`, [w.address])).rows;
    for (let i = 0; i < txs.length; i += 500) {
      await to.query(
        `INSERT INTO wallet_txs (signature, address, block_time, state, tries, last_try) SELECT * FROM jsonb_populate_recordset(NULL::wallet_txs, $1::jsonb) ON CONFLICT (signature) DO NOTHING`,
        [JSON.stringify(txs.slice(i, i + 500))],
      );
    }
    const fills = (await from.query(`SELECT * FROM wallet_fills WHERE address = $1`, [w.address])).rows;
    for (let i = 0; i < fills.length; i += 500) {
      await to.query(`INSERT INTO wallet_fills SELECT * FROM jsonb_populate_recordset(NULL::wallet_fills, $1::jsonb) ON CONFLICT (signature, mint, side) DO NOTHING`, [JSON.stringify(fills.slice(i, i + 500))]);
    }
    console.log(`copied ${txs.length} transactions and ${fills.length} fills`);
    const j = await applyToJournal(to, w.address);
    console.log(`journal on the target: +${j.inserted} added, ~${j.updated} updated, ${j.skipped} skipped`);
  }
  if (!watch.length) console.log("no wallet registered on the source");
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await from.end(); await to.end(); });
