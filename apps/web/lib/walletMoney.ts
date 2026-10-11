/**
 * How much money went into (and out of) the followed wallet, for the Results page: SOL sent to the wallet by another address (a deposit) or sent away
 * from it, each valued in dollars at the SOL price of that hour (table wallet_flows, apps/web/lib/wallet.ts decodeFlows says what counts and what does not).
 * Never carries the wallet address; the other side of a transfer is masked.
 */

interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface MoneyLine {
  t: string;
  amount: number;
  usd: number | null;
  /** the sender, masked (first and last four characters) */
  from: string | null;
}

export interface WalletMoney {
  deposited: { usd: number; sol: number; n: number; unpriced: number; first: string | null; last: string | null };
  withdrawn: { usd: number; sol: number; n: number; unpriced: number };
  /** newest first */
  deposits: MoneyLine[];
}

const mask = (a: unknown) => (typeof a === "string" && a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : null);
const num = (x: unknown) => {
  const n = typeof x === "number" ? x : x == null ? NaN : Number(x);
  return Number.isFinite(n) ? n : 0;
};
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

/** null when there is nothing recorded (no wallet followed, the table is missing on an older database, or the database is down). */
export async function walletMoney(db: Queryable): Promise<WalletMoney | null> {
  try {
    const sums = (
      await db.query(
        `SELECT direction, count(*)::int AS n, COALESCE(sum(amount), 0) AS sol, COALESCE(sum(usd), 0) AS usd, count(*) FILTER (WHERE usd IS NULL)::int AS unpriced, min(t) AS first, max(t) AS last
           FROM wallet_flows GROUP BY direction`,
      )
    ).rows;
    if (!sums.length) return null;
    const inn = sums.find((r) => r.direction === "in");
    const out = sums.find((r) => r.direction === "out");
    const list = (await db.query(`SELECT t, amount, usd, counterparty FROM wallet_flows WHERE direction = 'in' ORDER BY t DESC LIMIT 60`)).rows;
    return {
      deposited: { usd: num(inn?.usd), sol: num(inn?.sol), n: num(inn?.n), unpriced: num(inn?.unpriced), first: iso(inn?.first), last: iso(inn?.last) },
      withdrawn: { usd: num(out?.usd), sol: num(out?.sol), n: num(out?.n), unpriced: num(out?.unpriced) },
      deposits: list.map((r) => ({ t: new Date(r.t).toISOString(), amount: num(r.amount), usd: r.usd == null ? null : num(r.usd), from: mask(r.counterparty) })),
    };
  } catch {
    return null;
  }
}
