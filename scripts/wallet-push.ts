/**
 * Copy what the wallet sync has read (laptop database) to another database (the hosted one) and update that database's trade journal,
 * so the hosted site starts with the whole history instead of reading 400 transactions through a rate-limited public node.
 *
 *   TO_URL=postgres://...  corepack pnpm exec tsx scripts/wallet-push.ts       # FROM_URL defaults to the laptop database
 *
 * Idempotent: transactions are upserted, fills are copied with ON CONFLICT DO NOTHING, and the journal update recomputes from the fills.
 * The address is copied into the target's wallet_watch (it is never printed in full). The worker loop does the same incrementally
 * when LAB_SYNC_URL is set; this script is the full, one-off version.
 */
import pg from "pg";
import { maskAddress, pushWalletFlows, pushWalletRows } from "../apps/web/lib/walletSync";

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
  const watch = (await from.query(`SELECT address FROM wallet_watch`)).rows;
  for (const w of watch) {
    const r = await pushWalletRows(from, to, w.address, { full: true });
    console.log(`${maskAddress(w.address)}: ${r ? `${r.txs} transactions and ${r.fills} fills copied; journal ${r.journal ? `+${r.journal.inserted} added, ~${r.journal.updated} updated, ${r.journal.skipped} skipped` : "unchanged"}` : "nothing to copy"}`);
    const f = await pushWalletFlows(from, to, w.address);
    if (f) console.log(`${maskAddress(w.address)}: ${f} deposits/withdrawals copied`);
  }
  if (!watch.length) console.log("no wallet registered on the source");
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await from.end(); await to.end(); });
