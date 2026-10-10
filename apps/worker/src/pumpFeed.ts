/**
 * pump.fun's own event stream, free and keyless (PumpPortal's websocket): every coin created and every coin that graduates to
 * PumpSwap, as it happens. This is what the Radar's discovery cannot see: a graduation in its first minute, who created the coin,
 * how much they bought, and whether it was launched in Mayhem Mode.
 *
 *  - creations are buffered and written every few seconds to pump_launches (kept 72 hours)
 *  - a graduation is written to pump_graduates with what was known about its creator, and the coin enters the lab's watch list
 *    (lane "graduate") at once, so the Learning Lab follows it from minute 0
 *
 * PumpPortal asks for ONE websocket connection at a time (more can get the address banned for an hour). A database advisory lock
 * makes sure only one process in the whole system holds the feed: the long-running worker or scripts/lab-daemon.ts, whichever
 * is first. Best effort throughout: nothing here may ever stop scanning.
 */

interface Client {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}
interface PoolLike extends Client {
  connect(): Promise<Client & { release(): void }>;
}
type Log = (msg: string, extra?: Record<string, unknown>) => void;

const URL = "wss://pumpportal.fun/api/data";
const LOCK_KEY = "aureus:pump-feed";
const KEEP_HOURS = 72;
const WATCH_DAYS = 5;
const ACTIVE_CAP = Number(process.env.LAB_WATCH_CAP ?? 2500);

interface Create { mint: string; creator: string; name: string | null; symbol: string | null; solAmount: number | null; mcapSol: number | null; mayhem: boolean; pool: string | null; at: number }

export class PumpFeed {
  private ws: WebSocket | null = null;
  private stopped = false;
  private buf: Create[] = [];
  private lastMsg = 0;
  private backoff = 1_000;
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private lockClient: (Client & { release(): void }) | null = null;
  private stats = { creates: 0, migrations: 0, watched: 0, reconnects: 0 };

  constructor(private pool: PoolLike, private log: Log) {}

  /** Take the lock (or wait for it), then stream until stopped. Never throws. */
  async start(): Promise<void> {
    if (typeof WebSocket === "undefined") {
      this.log("pump feed disabled: this Node has no global WebSocket");
      return;
    }
    void this.run();
  }

  private async run(): Promise<void> {
    while (!this.stopped && !(await this.acquire())) await new Promise((r) => setTimeout(r, 60_000));
    if (this.stopped) return;
    this.log("pump feed: holding the lock, connecting");
    this.connect();
    this.timers.push(setInterval(() => void this.flush(), 5_000));
    this.timers.push(setInterval(() => void this.prune(), 3_600_000));
    this.timers.push(setInterval(() => {
      // a silent socket is a dead socket: the stream produces about 30 creations a minute
      if (this.lastMsg && Date.now() - this.lastMsg > 120_000) {
        this.log("pump feed: silent for 2 minutes, reconnecting");
        this.ws?.close();
      }
      this.log("pump feed", { ...this.stats });
    }, 600_000));
  }

  private async acquire(): Promise<boolean> {
    try {
      const c = await this.pool.connect();
      const { rows } = await c.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS ok`, [LOCK_KEY]);
      if (rows[0]?.ok) {
        this.lockClient = c; // held for the life of the process: the lock goes when this connection does
        return true;
      }
      c.release();
    } catch (e) {
      this.log("pump feed: could not take the lock", { error: String((e as Error)?.message ?? e).slice(0, 120) });
    }
    return false;
  }

  private connect(): void {
    if (this.stopped) return;
    const ws = new WebSocket(URL);
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 1_000;
      this.lastMsg = Date.now();
      ws.send(JSON.stringify({ method: "subscribeNewToken" }));
      ws.send(JSON.stringify({ method: "subscribeMigration" }));
    };
    ws.onmessage = (ev) => {
      this.lastMsg = Date.now();
      let m: any;
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (m?.txType === "create" && m.mint && m.traderPublicKey) {
        if (this.buf.length < 5_000) {
          this.buf.push({
            mint: m.mint, creator: m.traderPublicKey, name: m.name ?? null, symbol: m.symbol ?? null,
            solAmount: Number.isFinite(m.solAmount) ? m.solAmount : null, mcapSol: Number.isFinite(m.marketCapSol) ? m.marketCapSol : null,
            mayhem: m.is_mayhem_mode === true, pool: m.pool ?? null, at: Date.now(),
          });
        }
        this.stats.creates++;
      } else if (m?.txType === "migrate" && m.mint) {
        this.stats.migrations++;
        void this.graduate(m.mint, m.signature ?? null);
      }
    };
    const again = () => {
      if (this.stopped) return;
      this.stats.reconnects++;
      const wait = this.backoff;
      this.backoff = Math.min(60_000, this.backoff * 2);
      setTimeout(() => this.connect(), wait);
    };
    ws.onclose = again;
    ws.onerror = () => { /* onclose follows */ };
  }

  /** Write the buffered creations. */
  private async flush(): Promise<void> {
    if (!this.buf.length) return;
    const batch = this.buf.splice(0, this.buf.length);
    try {
      await this.pool.query(
        `INSERT INTO pump_launches (mint, creator, created_at, name, symbol, initial_buy_sol, mcap_sol, mayhem, pool)
         SELECT v.mint, v.creator, to_timestamp(v.at / 1000.0), v.name, v.symbol, v.sol, v.mcap, v.mayhem, v.pool
           FROM unnest($1::text[], $2::text[], $3::float8[], $4::text[], $5::text[], $6::float8[], $7::float8[], $8::bool[], $9::text[]) AS v(mint, creator, at, name, symbol, sol, mcap, mayhem, pool)
         ON CONFLICT (mint) DO NOTHING`,
        [batch.map((b) => b.mint), batch.map((b) => b.creator), batch.map((b) => b.at), batch.map((b) => b.name), batch.map((b) => b.symbol), batch.map((b) => b.solAmount), batch.map((b) => b.mcapSol), batch.map((b) => b.mayhem), batch.map((b) => b.pool)],
      );
    } catch (e) {
      this.log("pump feed: could not write creations", { error: String((e as Error)?.message ?? e).slice(0, 120), lost: batch.length });
    }
  }

  /** A coin graduated: remember what was known about it, and let the lab watch it from this minute. */
  private async graduate(mint: string, signature: string | null): Promise<void> {
    try {
      await this.flush(); // its creation may still be in the buffer
      await this.pool.query(
        `INSERT INTO pump_graduates (mint, migrated_at, creator, created_at, create_to_migrate_min, initial_buy_sol, mayhem, creator_launches_72h, name, symbol, signature)
         SELECT $1, now(), l.creator, l.created_at, EXTRACT(EPOCH FROM (now() - l.created_at)) / 60.0, l.initial_buy_sol, l.mayhem,
                (SELECT count(*)::int FROM pump_launches x WHERE x.creator = l.creator AND x.created_at <= l.created_at AND x.created_at > l.created_at - interval '72 hours'),
                l.name, l.symbol, $2
           FROM (SELECT 1) d LEFT JOIN pump_launches l ON l.mint = $1
         ON CONFLICT (mint) DO NOTHING`,
        [mint, signature],
      );
      const { rows } = await this.pool.query(`SELECT count(*)::int AS n FROM lab_watch WHERE active`);
      if ((rows[0]?.n ?? 0) >= ACTIVE_CAP) return;
      const r = await this.pool.query(
        `INSERT INTO lab_watch (mint, lane, reason, symbol, name, first_seen_at, watch_until)
         SELECT $1, 'graduate', 'pump_migration', g.symbol, g.name, now(), now() + make_interval(days => $2::int)
           FROM pump_graduates g
          WHERE g.mint = $1 AND NOT EXISTS (SELECT 1 FROM tokens t JOIN candidates c ON c.token_id = t.id WHERE t.mint = $1)
         ON CONFLICT (mint) DO NOTHING`,
        [mint, WATCH_DAYS],
      );
      if ((r.rowCount ?? 0) > 0) this.stats.watched++;
    } catch (e) {
      this.log("pump feed: could not record a graduation", { mint: mint.slice(0, 8), error: String((e as Error)?.message ?? e).slice(0, 120) });
    }
  }

  private async prune(): Promise<void> {
    try {
      await this.pool.query(`DELETE FROM pump_launches WHERE created_at < now() - make_interval(hours => $1::int)`, [KEEP_HOURS]);
    } catch {
      /* next hour */
    }
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    try {
      this.ws?.close();
    } catch {
      /* closing */
    }
    this.lockClient?.release();
  }
}
