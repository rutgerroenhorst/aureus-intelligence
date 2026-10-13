import { toApi, type TradeRow } from "../my-trades";
import { journalFacts, labFacts } from "./summary";
import type { Facts } from "./types";

interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

/** Aggregate numbers only, no coin names and no addresses: the site is public. A failed read leaves that half out instead of failing the page. */
export async function loadFacts(db: Queryable): Promise<Facts> {
  const journal = await db
    .query(`SELECT * FROM my_trades ORDER BY entered_at DESC LIMIT 400`)
    .then((r) => journalFacts((r.rows as TradeRow[]).map(toApi)))
    .catch(() => null);
  const lab = await db
    .query(`SELECT kind, payload FROM lab_reports WHERE kind IN ('overview', 'headlines')`)
    .then((r) => {
      const by = Object.fromEntries(r.rows.map((x: any) => [x.kind, x.payload]));
      return labFacts(by.overview, by.headlines);
    })
    .catch(() => null);
  return { journal: journal && journal.coins > 0 ? journal : null, lab };
}
