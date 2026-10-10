/**
 * Follow a wallet (public address only) and keep the trade journal in step with what it bought and sold.
 *
 *   WALLET=<address> corepack pnpm exec tsx scripts/wallet-sync.ts       # registers the address in the database, then reads until done
 *   corepack pnpm exec tsx scripts/wallet-sync.ts                        # syncs the addresses already registered
 *   DATABASE_URL=<hosted url> ...                                         # the same against the hosted database
 *
 * The free public RPC is rate limited, so a first run reads a few dozen transactions at a time and keeps going until none are left
 * (or until nothing more can be read right now). The address is only stored in the database; the output shows it masked.
 */
import pg from "pg";
import { applyToJournal, maskAddress, syncAllWallets, watchWallet } from "../apps/web/lib/walletSync";

const url = process.env.DATABASE_URL ?? "postgres://aureus:aureus@localhost:5432/aureus";
const db = new pg.Pool({ connectionString: url, max: 2 });

async function main() {
  if (process.env.WALLET) {
    await watchWallet(db, process.env.WALLET, process.env.WALLET_LABEL);
    console.log(`following ${maskAddress(process.env.WALLET)}`);
  }
  let stuck = 0;
  for (let round = 1; round <= 40; round++) {
    const rs = await syncAllWallets(db, { maxRead: 60, budgetMs: 150_000 });
    if (!rs.length) {
      console.log("no wallet registered");
      return;
    }
    for (const r of rs) console.log(`round ${round}: ${r.address} new ${r.newSignatures}, read ${r.read}, unreadable ${r.unreadable}, fills ${r.fills}, still pending ${r.pending}${r.journal ? `, journal +${r.journal.inserted} ~${r.journal.updated} skipped ${r.journal.skipped}` : ""}`);
    if (rs.every((r) => r.pending === 0)) break;
    if (rs.every((r) => r.read === 0)) {
      if (++stuck >= 3) {
        console.log("nothing more can be read right now; run again later");
        break;
      }
    } else stuck = 0;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  // one last pass over the journal with everything read (coins whose supply could not be found earlier get another chance)
  for (const a of (await db.query(`SELECT address FROM wallet_watch`)).rows) {
    const j = await applyToJournal(db, a.address);
    console.log(`journal: ${maskAddress(a.address)} +${j.inserted} ~${j.updated} skipped ${j.skipped}`);
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.end());
