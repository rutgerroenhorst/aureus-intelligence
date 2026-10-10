/**
 * Aureus continuous scanner.
 *   tsx src/run.ts once    — one bounded cycle, then exit
 *   tsx src/run.ts watch   — loop (short-lived dev use)
 *   tsx src/run.ts start   — long-running: lock + heartbeat + circuit breaker + graceful shutdown
 *
 * Reliability: Redis distributed lock (no double cycles), per-source circuit
 * breaker, retries/backoff (in the HTTP adapter), idempotent candidate identity,
 * per-candidate fault isolation, bounded concurrency, graceful SIGTERM/SIGINT.
 */
import { Redis } from "ioredis";
import { getPool, closePool } from "@aureus/db";
import { loadConfig } from "@aureus/config";
import { DexScreenerAdapter, HeliusAdapter, JupiterAdapter } from "@aureus/ingestion";
import { processPair, recordSourceHealth, primaryPair } from "./pipeline.js";
import { dispatchForResult, buildChannel } from "./alerts.js";
import { dueCandidates, freshCandidates, scheduleNext, recordScanError, mapLimit } from "./scan.js";
import { workerConfig } from "./wconfig.js";
import { CycleLock } from "./lock.js";
import { CircuitBreaker } from "./breaker.js";
import { writeHeartbeat } from "./heartbeat.js";
import { RedisQueue, InMemoryQueue, type EnrichmentQueue } from "./queue.js";
import { enrichCandidate, markEnrichmentFailed } from "./enrichment.js";
import { measureOpenSignals } from "./shadow.js";
import { measurePhaseSnapshots } from "./watchStatus.js";
import { measureVerdictOutcomes } from "./verdicts.js";
import { ensurePartitions, currentMonthWritable, reconcileRuleCurrent } from "./partitions.js";
import { noteTurnedAway, type TurnedAway } from "./labWatch.js";
import { PumpFeed } from "./pumpFeed.js";

const WORKER_ID = process.env.WORKER_ID ?? `worker-${process.pid}`;
const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), worker: WORKER_ID, msg, ...extra }));

// Run inside the web app (AUREUS_EMBEDDED), the scan gets a pool of its own so it cannot starve the pages' queries.
const pool = getPool(undefined, process.env.AUREUS_EMBEDDED === "1" ? "scan" : undefined);
const cfg = loadConfig();
const dex = new DexScreenerAdapter(cfg.env.DEXSCREENER_BASE_URL);
const helius = new HeliusAdapter({ apiKey: cfg.env.HELIUS_API_KEY });
const jupiter = new JupiterAdapter();
const channel = buildChannel();
const heliusMode = cfg.modes.helius as "LIVE" | "DEGRADED" | "MOCK";
const breaker = new CircuitBreaker(5, 60_000);
const heliusBreaker = new CircuitBreaker(5, 120_000);
const MAX_ENRICH_PER_CYCLE = Number(process.env.MAX_ENRICH_PER_CYCLE ?? 5);
const MAX_REEVAL_PER_CYCLE = Number(process.env.MAX_REEVAL_PER_CYCLE ?? 10);

// Redis-backed enrichment queue (falls back to in-memory if Redis is unavailable).
// On Vercel the web app runs scans through scanOnce(): there is no Redis there, and a client that keeps
// retrying localhost:6379 every second only burns CPU, so serverless always uses the in-memory queue.
const SERVERLESS = Boolean(process.env.VERCEL) || process.env.AUREUS_NO_REDIS === "1";
let redis: Redis | null = null;
let queue: EnrichmentQueue;
if (SERVERLESS) {
  queue = new InMemoryQueue();
} else {
  try {
    redis = new Redis(cfg.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => 1000 });
    queue = new RedisQueue(redis);
  } catch {
    queue = new InMemoryQueue();
  }
}

let cycleCount = 0;
let avgCycleMs = 0;
let lastDiscoveryMs = 0;
let shuttingDown = false;
let inCycle = false;

/**
 * Minimum pool depth to be tracked at all.
 *
 * This was $20k, which is the right floor for a $500 position and the wrong one for a
 * €10 position — and it was silently deciding WHICH COINS EXIST. Measured first-sighting
 * market caps under that floor: MOMENTUM $124k, catalyst $196k, RIKA $761k, BREAKING
 * $1.4m. By the time a coin cleared it, the move being traded had already happened.
 *
 * Forward outcomes say the real boundary is the dead zone, not the position size:
 *     liq  2-4k  n=46  median peak  0%   (dead)
 *     liq  4-6k  n=29  median peak +5%   marginal against ~5% round-trip cost
 *     liq  6-8k  n=17  median peak +9%
 *     liq 8-12k  n=66  median peak +18%  p75 +51%
 *     liq 12-20k n=71  median peak +22%  p75 +62%   ← the productive band
 *
 * So $6k: above the dead zone and above the band whose median move does not clear its
 * own cost. An $8k floor rejected 29 of a 72-coin scan, most of them the small caps
 * this is meant to find. The 8-20k band is genuinely more volatile — that is carried
 * by position size and a stop, not by refusing to look.
 */
/**
 * The OBSERVATION floor. Kept equal to the tradability floor in decisionRules.ts, so
 * behaviour matches the configuration that produced the reference trade.
 *
 * They remain SEPARATE constants deliberately: sub-$6k pools are still a blind spot
 * (1 measurement in 299), and lowering this to study them must never be able to drag
 * the buy gate down with it, the way one shared variable used to.
 */
const DISCOVERY_MIN_LIQUIDITY_USD = Number(process.env.DISCOVERY_MIN_LIQUIDITY_USD ?? 6_000);

/**
 * Two sources, because they see different parts of the market.
 *
 * `search?q=pumpswap` ranks by liquidity, so a coin only appears once it is already
 * large — every coin it surfaced had first-seen market caps of $95k to $1.4m. The
 * launch feeds (`token-profiles/latest`, `token-boosts/latest`) carry a median market
 * cap of ~$14k, which is the band worth entering. Using only the first meant arriving
 * after the move; using only the second means missing coins that graduated quietly.
 */
/** Share of each cycle reserved for newly discovered mints, so a backlog of
 *  already-judged candidates can never starve discovery entirely. */
const DISCOVERY_CYCLE_SHARE = Number(process.env.DISCOVERY_CYCLE_SHARE ?? 0.4);
/** Share of each cycle reserved for recently discovered coins. See freshCandidates(). */
const FRESH_CYCLE_SHARE = Number(process.env.FRESH_CYCLE_SHARE ?? 0.3);
const FRESH_MAX_AGE_HOURS = Number(process.env.FRESH_MAX_AGE_HOURS ?? 6);

/**
 * Discovery breadth.
 *
 * A single "pumpswap" query scanned ~70 pairs a minute, and the median coin was already
 * 136 minutes old when we first saw it — against our own 60-minute admission floor. We
 * were not being cautious, we were looking through a keyhole: the floor said 60 and we
 * arrived at 136.
 *
 * These are the venues a Solana launch actually lands on, so the set widens coverage
 * rather than deepening one source. Cost is one search call per venue per discovery
 * interval, which is far inside the rate budget and behind the same circuit breaker.
 */
const DISCOVERY_QUERIES = (process.env.DISCOVERY_QUERIES ?? "pumpswap")
  .split(",").map((s) => s.trim()).filter(Boolean);
/** Pull the small-cap launch feeds as well as the (large-cap biased) search. */
const DISCOVERY_USE_LAUNCH_FEED = (process.env.DISCOVERY_USE_LAUNCH_FEED ?? "1") !== "0";
/**
 * On-chain discovery. These are the programs a Solana memecoin actually launches and
 * trades on, so a mint touching them is live NOW rather than whenever an indexer
 * catches up. Only used when Helius is LIVE; there is no fallback, because inventing
 * one would mean pretending to a freshness we do not have.
 */
const DISCOVERY_ONCHAIN = process.env.DISCOVERY_ONCHAIN === "1";
const LAUNCH_PROGRAMS = (process.env.DISCOVERY_PROGRAMS ??
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA,6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P")
  .split(",").map((s) => s.trim()).filter(Boolean);

/**
 * AGE WINDOW — the strategy is freshly-graduated coins, not mature ones.
 *
 * Filtering only on depth floated 26-day-old tokens to the top of the board (CATE:
 * 625h, $45m mcap, +2.4% in 30m) — a completed move, the worst possible entry. The
 * age distribution measured 2026-08-21 on `search?q=pumpswap`:
 *
 *     1-6h    median liq $47,064   3/3 tradeable at $500
 *     6-24h   median liq $40,021   5/7 tradeable
 *     >7d     median liq $710,694  already run
 *
 * So the fresh band has real depth from the bonding-curve migration and is genuinely
 * tradeable. The MINIMUM is not caution: the setup we trade is break-out → pull-back →
 * reclaim, and a pair minutes old has no prior high to break out FROM. Structure needs
 * time to exist before it can be traded.
 */
// MEASURED, not assumed. Forward outcomes on our own candidates (h1 horizon):
//
//   age <1h   n=258  median peak +11%  median dip -40%   43% HALVED
//   age 1-6h  n= 75  median peak  +6%  median dip  -4%   13% halved
//   age 6-24h n= 25  median peak +11%  median dip  -6%    4% halved
//
// The first hour carries the same upside as the next twenty-three and ten times the
// downside. "Buy it in the first minutes" is the worst risk profile in the data.
// so the floor is an hour, not twenty minutes.
//
// Was briefly lowered to 20 to observe earlier (buying stayed gated at 60 via
// UNIVERSE_MIN_AGE_MINUTES). Reverted at the user's request: this is the configuration
// that actually called the reference trade, and an emptier, earlier board was not an
// improvement on one that produced a real entry.
const DISCOVERY_MIN_AGE_MIN = Number(process.env.DISCOVERY_MIN_AGE_MINUTES ?? 60);
const DISCOVERY_MAX_AGE_H = Number(process.env.DISCOVERY_MAX_AGE_HOURS ?? 48);

/**
 * Ceiling on market cap AT DISCOVERY.
 *
 * Not a claim that larger coins are worse — measured at h6 they are not; 200-600k
 * doubled more often (16%) than <25k (9%). It is a claim about what a move is WORTH:
 * a 3x from $50k is reachable, the same 3x from $700k needs $2.1m and is far rarer.
 *
 * Applied at the door only. A coin admitted at $50k that grows past the ceiling keeps
 * being tracked — we are already in it, and dropping a winner because it won would be
 * the opposite of the point.
 */
const DISCOVERY_MAX_MCAP_USD = Number(process.env.DISCOVERY_MAX_MCAP_USD ?? 150_000);

/**
 * Supported networks for elite discovery.
 * DexScreener supports: solana, ethereum, polygon, arbitrum, base, optimism, avalanche, etc.
 */
const SUPPORTED_CHAINS = (process.env.DISCOVERY_CHAINS ?? "solana,ethereum,polygon,arbitrum,base")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

interface SearchPair {
  chainId?: string;
  pairAddress?: string;
  dexId?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  liquidity?: { usd?: number };
  pairCreatedAt?: number;
  marketCap?: number;
  fdv?: number;
}

async function discoveryDue(pollMs: number): Promise<string[]> {
  if (pollMs - lastDiscoveryMs < workerConfig.discoveryIntervalMs && lastDiscoveryMs !== 0) return [];
  if (breaker.isOpen) { log("discovery skipped: circuit open"); return []; }
  try {
    const seen = new Set<string>();
    let scanned = 0;
    let tooThin = 0;
    let tooYoung = 0;
    let tooOld = 0;
    let noAge = 0;
    let tooBig = 0;
    /** What the door refused for being too young or too big: handed to the Learning Lab, which watches it (never the Radar). */
    const turnedAway: TurnedAway[] = [];

    /** Median admitted age per source — the number that decides where to invest next. */
    const agesBySource: Record<string, number[]> = { search: [], feed: [], onchain: [] };
    let source = "search";

    /** One admission test, applied identically to every source. */
    const admit = (p: SearchPair): boolean => {
      const liq = p.liquidity?.usd ?? 0;
      // Depth is checked HERE, at the door, rather than discovering everything and
      // rejecting it later: a candidate we can never trade is not worth a scan slot.
      if (liq < DISCOVERY_MIN_LIQUIDITY_USD) { tooThin++; return false; }
      const ageH = p.pairCreatedAt ? (pollMs - p.pairCreatedAt) / 3.6e6 : null;
      if (ageH == null) { noAge++; return false; }   // cannot place it in the window
      if (ageH * 60 < DISCOVERY_MIN_AGE_MIN) { tooYoung++; turnedAway.push({ p, reason: "too_young" }); return false; }
      if (ageH > DISCOVERY_MAX_AGE_H) { tooOld++; return false; }
      const mc = p.marketCap ?? p.fdv ?? null;
      if (mc != null && mc > DISCOVERY_MAX_MCAP_USD) { tooBig++; turnedAway.push({ p, reason: "too_big" }); return false; }
      agesBySource[source]!.push(ageH * 60);
      return true;
    };

    for (const query of DISCOVERY_QUERIES) {
      const res = await dex.searchPairs(query);
      const pairs = ((res.payload as { pairs?: SearchPair[] } | null)?.pairs ?? [])
        .filter((p) => SUPPORTED_CHAINS.includes(p.chainId?.toLowerCase() ?? "") && p.baseToken?.address);
      scanned += pairs.length;
      for (const p of pairs) if (admit(p)) seen.add(p.baseToken!.address!);
    }

    // The launch feeds return MINTS, not pairs, so their depth and age have to be
    // resolved before the same admission test can be applied.
    /** Resolve mints to their deepest pair across all chains and run the shared admission test. */
    const admitMints = async (list: string[], chain: string = "solana"): Promise<void> => {
      for (let i = 0; i < list.length; i += 30) {
        const res = await dex.tokens(list.slice(i, i + 30), chain).catch(() => null);
        const pairs = (Array.isArray(res?.payload) ? (res!.payload as SearchPair[]) : [])
          .filter((p) => SUPPORTED_CHAINS.includes(p.chainId?.toLowerCase() ?? "") && p.baseToken?.address);
        scanned += pairs.length;
        const best = new Map<string, SearchPair>();
        for (const p of pairs) {
          const k = p.baseToken!.address!;
          const cur = best.get(k);
          if (!cur || (p.liquidity?.usd ?? 0) > (cur.liquidity?.usd ?? 0)) best.set(k, p);
        }
        for (const p of best.values()) if (admit(p)) seen.add(p.baseToken!.address!);
      }
    };

    source = "onchain";
    if (DISCOVERY_ONCHAIN && heliusMode === "LIVE") {
      const onchain = new Set<string>();
      for (const prog of LAUNCH_PROGRAMS) {
        const r = await helius.launchProgramMints(prog).catch(() => null);
        for (const m of r?.payload ?? []) onchain.add(m);
      }
      await admitMints([...onchain]);
    }

    source = "feed";
    if (DISCOVERY_USE_LAUNCH_FEED) {
      const feeds = await Promise.all([
        dex.latestTokenProfiles().catch(() => null),
        dex.latestBoosts().catch(() => null),
      ]);
      // Group mints by chain for batch resolution
      const mintsByChain = new Map<string, Set<string>>();
      for (const chain of SUPPORTED_CHAINS) mintsByChain.set(chain, new Set());

      for (const f of feeds) {
        const arr = Array.isArray(f?.payload) ? (f!.payload as Array<{ chainId?: string; tokenAddress?: string }>) : [];
        for (const t of arr) {
          const chain = t.chainId?.toLowerCase() ?? "solana";
          if (SUPPORTED_CHAINS.includes(chain) && t.tokenAddress) {
            mintsByChain.get(chain)?.add(t.tokenAddress);
          }
        }
      }

      // Process each chain's mints
      for (const [chain, mints] of mintsByChain) {
        if (mints.size === 0) continue;
        const list = [...mints];
        for (let i = 0; i < list.length; i += 30) {
          const res = await dex.tokens(list.slice(i, i + 30), chain).catch(() => null);
          const pairs = (Array.isArray(res?.payload) ? (res!.payload as SearchPair[]) : [])
            .filter((p) => SUPPORTED_CHAINS.includes(p.chainId?.toLowerCase() ?? "") && p.baseToken?.address);
          scanned += pairs.length;
          // A mint can have several pools; keep the deepest so a dust pool does not
          // disqualify a coin that trades fine on its primary pair.
          const best = new Map<string, SearchPair>();
          for (const p of pairs) {
            const k = p.baseToken!.address!;
            const cur = best.get(k);
            if (!cur || (p.liquidity?.usd ?? 0) > (cur.liquidity?.usd ?? 0)) best.set(k, p);
          }
          for (const p of best.values()) if (admit(p)) seen.add(p.baseToken!.address!);
        }
      }
    }

    // The coins the door refused are not lost: the Learning Lab watches them (see labWatch.ts). Failures are swallowed there.
    const watching = await noteTurnedAway(pool, turnedAway, pollMs);

    // Discovery's job is to find things we do NOT have. A mint we already track is
    // rescanned by the due-list anyway, so spending a scarce discovery slot on it is
    // pure waste — and it was: the search feed (large caps, all already known) filled
    // every slot before the launch feed was even reached, so the small caps this was
    // changed to find never entered the system at all.
    const known = new Set<string>();
    if (seen.size > 0) {
      const { rows } = await pool.query<{ mint: string }>(
        `SELECT t.mint FROM tokens t JOIN candidates c ON c.token_id = t.id WHERE t.mint = ANY($1)`,
        [[...seen]],
      );
      for (const r of rows) known.add(r.mint);
    }
    const fresh = [...seen].filter((m) => !known.has(m));
    const rediscovered = seen.size - fresh.length;

    lastDiscoveryMs = pollMs;
    breaker.recordSuccess();
    await recordSourceHealth(pool, "dexscreener", true, null);
    // Report what was dropped. A discovery step that silently discards most of what it
    // saw looks identical to one that found nothing.
    log("discovery", {
      queries: DISCOVERY_QUERIES.length, launchFeed: DISCOVERY_USE_LAUNCH_FEED,
      onchain: DISCOVERY_ONCHAIN && heliusMode === "LIVE", scanned, admitted: seen.size,
      medianAgeMin: Object.fromEntries(Object.entries(agesBySource).map(([k, v]) => {
        if (v.length === 0) return [k, null];
        const sorted = [...v].sort((a, b) => a - b);
        return [k, { n: v.length, p50: Math.round(sorted[Math.floor(sorted.length / 2)]!) }];
      })),
      new: fresh.length, alreadyKnown: rediscovered,
      dropped: { tooThin, tooYoung, tooOld, tooBig, noAge }, labWatchAdded: watching,
      window: { minLiquidityUsd: DISCOVERY_MIN_LIQUIDITY_USD, minAgeMin: DISCOVERY_MIN_AGE_MIN,
                maxAgeH: DISCOVERY_MAX_AGE_H, maxMcapUsd: DISCOVERY_MAX_MCAP_USD },
    });
    return fresh.slice(0, workerConfig.maxCandidatesPerCycle);
  } catch (err) {
    breaker.recordFailure();
    await recordSourceHealth(pool, "dexscreener", false, (err as Error).message);
    log("discovery error", { error: (err as Error).message, breaker: breaker.state });
    return [];
  }
}

async function processMint(mint: string, candidateId: string | null, pollMs: number): Promise<void> {
  if (breaker.isOpen) return;
  try {
    const tokens = await dex.tokens([mint]);
    breaker.recordSuccess();
    const pair = primaryPair(tokens.payload);
    if (!pair) return;
    const res = await processPair(pool, pair, pollMs); // processPair now sets next_scan_at via tiers
    // The triggering candidate may be a secondary pool of the same mint; advance it too.
    if (candidateId && candidateId !== res.candidateId) await scheduleNext(pool, candidateId, res.state);
    // Enqueue on-chain enrichment when Helius is LIVE and this candidate still needs it.
    if (heliusMode === "LIVE" && (res.enrichmentStatus === "NOT_REQUESTED" || res.enrichmentStatus === "STALE")) {
      // Fresh coins first. 241 candidates were sitting on STALE waiting for their
      // holder check while newly-found small caps queued behind them — backwards for a
      // strategy whose entire premise is being early. Age in hours is the score, so a
      // 2-hour-old coin is claimed before a 40-hour-old one.
      const ageH = res.facts.pairAgeMs != null ? res.facts.pairAgeMs / 3.6e6 : 999;
      const enq = await queue.enqueue("HELIUS_ENRICHMENT", res.candidateId, Math.round(ageH));
      if (enq) await pool.query(`UPDATE candidates SET enrichment_status='QUEUED', enrichment_queued_at=now() WHERE id=$1`, [res.candidateId]);
    }
    const outcomes = await dispatchForResult(pool, channel, res, heliusMode);
    if (res.changed || outcomes.length) log("candidate", { mint: mint.slice(0, 8), from: res.fromState, to: res.state, reason: res.reason, tier: res.tier, enrichment: res.enrichmentStatus, alerts: outcomes });
  } catch (err) {
    breaker.recordFailure();
    if (candidateId) await recordScanError(pool, candidateId);
    const msg = (err as Error).message;
    cycleErrors.push(msg);
    log("candidate error", { mint: mint.slice(0, 8), error: msg, breaker: breaker.state });
  }
}

/**
 * Errors seen during the current cycle, used to tell a SYSTEMIC fault from a bad
 * candidate. The missing-partition outage produced 25 identical "candidate error"
 * lines per cycle and read as routine per-item noise, while in reality no market
 * data was being written at all. One coin failing is normal; every coin failing the
 * same way is an outage and must say so.
 */
let cycleErrors: string[] = [];

function systemicFault(errors: string[], attempted: number): { systemic: boolean; reason: string; count: number } {
  if (attempted === 0 || errors.length === 0) return { systemic: false, reason: "", count: 0 };
  const tally = new Map<string, number>();
  for (const e of errors) {
    // Normalise volatile bits (ids, mints) so identical faults group together.
    const key = e.replace(/"[^"]*"/g, '"…"').replace(/\b[0-9a-f-]{8,}\b/gi, "…").slice(0, 120);
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  let top = ""; let n = 0;
  for (const [k, v] of tally) if (v > n) { top = k; n = v; }
  return { systemic: n >= Math.max(3, Math.ceil(attempted * 0.5)), reason: top, count: n };
}

async function mintFor(candidateId: string): Promise<string | null> {
  const r = await pool.query<{ mint: string }>(`SELECT t.mint FROM candidates c JOIN tokens t ON t.id=c.token_id WHERE c.id=$1`, [candidateId]);
  return r.rows[0]?.mint ?? null;
}

/**
 * Drain the async enrichment queue. A slow/failing Helius call is fully isolated
 * here — it never blocks discovery or the market pipeline. On success, a
 * REEVALUATE job re-runs the deterministic engines with the new on-chain intel.
 *
 * FAIRNESS: reevaluations are claimed FIRST (bounded), then enrichment, so a
 * REEVALUATE queued after `changed=true` runs promptly and is never starved.
 * Trace logs carry only job_id, candidate_id, job_type, stage — no key/RPC-URL.
 */
async function drainEnrichment(nowMs: number): Promise<{ enriched: number; reeval: number }> {
  if (heliusMode !== "LIVE") return { enriched: 0, reeval: 0 };
  const reevalJobs = await queue.claimDue("REEVALUATE_CANDIDATE", nowMs, MAX_REEVAL_PER_CYCLE);
  const enrichJobs = await queue.claimDue("HELIUS_ENRICHMENT", nowMs, MAX_ENRICH_PER_CYCLE);
  let enriched = 0, reeval = 0;
  for (const job of [...reevalJobs, ...enrichJobs]) {
    const trace = (stage: string, extra: Record<string, unknown> = {}) => log("job", { job_id: job.id, candidate_id: job.candidateId, job_type: job.type, stage, ...extra });
    try {
      const mint = await mintFor(job.candidateId);
      if (!mint) { await queue.ack(job); continue; }
      if (job.type === "HELIUS_ENRICHMENT") {
        if (heliusBreaker.isOpen) { await queue.retry(job, nowMs); trace("retried", { reason: "breaker_open" }); continue; }
        trace("claimed");
        const r = await enrichCandidate(pool, helius, jupiter, job.candidateId, mint, nowMs);
        heliusBreaker.recordSuccess();
        trace("enriched", { status: r.status, changed: r.changed });
        if (r.changed) { const enq = await queue.enqueue("REEVALUATE_CANDIDATE", job.candidateId); trace("reeval_enqueued", { enqueued: enq }); }
        await queue.ack(job); // ack AFTER enrichment saved + reeval enqueued
        trace("acked");
        enriched++;
      } else if (job.type === "REEVALUATE_CANDIDATE") {
        trace("reeval_claimed");
        const tokens = await dex.tokens([mint]);
        const pair = primaryPair(tokens.payload);
        if (pair) { const res = await processPair(pool, pair, nowMs); reeval++; trace("reevaluated", { to: res.state, tier: res.tier, enrichment: res.enrichmentStatus }); }
        else trace("reeval_no_pair");
        await queue.ack(job); // ack AFTER a successful reevaluation
      } else {
        await queue.ack(job);
      }
    } catch (err) {
      if (job.type === "HELIUS_ENRICHMENT") heliusBreaker.recordFailure();
      const outcome = await queue.retry(job, nowMs);
      await markEnrichmentFailed(pool, job.candidateId, (err as Error).message, outcome === "deadlettered");
      if (outcome === "deadlettered") {
        await pool.query(`INSERT INTO enrichment_failures (candidate_id, job_type, attempts, error) VALUES ($1,$2,$3,$4)`, [job.candidateId, job.type, job.attempts + 1, (err as Error).message.slice(0, 500)]);
      }
      trace("error", { error: (err as Error).message, outcome, breaker: heliusBreaker.state });
    }
  }
  return { enriched, reeval };
}

let lastPartitionCheckMs = 0;
const PARTITION_CHECK_INTERVAL_MS = 60 * 60_000;

/**
 * The Learning Lab's round between scan cycles, so the laptop learns by itself around the clock (collectors, lessons, reports).
 * The hosted site runs the same round inside its own learning tick, so this is only for the long-running worker. It runs beside
 * the scan, never inside it, and any failure is logged and forgotten: the lab must not be able to hurt scanning.
 * LAB_IN_WORKER=0 switches it off; LAB_EVERY_MINUTES (default 10) sets the pace.
 */
const LAB_IN_WORKER = (process.env.LAB_IN_WORKER ?? "1") !== "0" && !process.env.VERCEL;
const LAB_EVERY_MS = Number(process.env.LAB_EVERY_MINUTES ?? 10) * 60_000;
let lastLabMs = 0;
let labRunning = false;
// Watched coins (above all fresh graduations) are read every couple of minutes, not only every lab round, so a new graduation has a price within minutes.
let lastWatchMs = 0;
let watchRunning = false;
function maybePollWatch(): void {
  if (!LAB_IN_WORKER || watchRunning || Date.now() - lastWatchMs < 120_000) return;
  lastWatchMs = Date.now();
  watchRunning = true;
  void (async () => {
    try {
      const { collectWatch } = await import("../../web/lib/lab/lanes.js");
      await collectWatch(pool as never, { maxCalls: 30 });
    } catch (e) {
      log("lab watch poll failed", { error: (e as Error).message });
    } finally {
      watchRunning = false;
    }
  })();
}
function maybeRunLab(): void {
  if (!LAB_IN_WORKER || labRunning || Date.now() - lastLabMs < LAB_EVERY_MS) return;
  lastLabMs = Date.now();
  labRunning = true;
  void (async () => {
    try {
      const { runLab } = await import("../../web/lib/lab/tick.js");
      const r = await runLab();
      log("lab", { ms: r.ms, runners: r.runners, watch: r.watch, lessons: r.lessons, reports: r.reports });
    } catch (e) {
      log("lab failed", { error: (e as Error).message });
    } finally {
      labRunning = false;
    }
  })();
}

interface CycleStats {
  candidates: number;
  fresh: number;
  errors: number;
  discovered: number;
  due: number;
  /** most coins one cycle takes; a due list this long means more are still waiting */
  cap: number;
  ms: number;
}

async function runCycle(): Promise<CycleStats | null> {
  if (inCycle) return null;
  inCycle = true;
  const start = Date.now();
  cycleErrors = [];
  try {
    // A month rollover with no partition makes every market-data INSERT fail while
    // cycles still report healthy. Check hourly so that can never go unnoticed.
    if (start - lastPartitionCheckMs > PARTITION_CHECK_INTERVAL_MS) {
      lastPartitionCheckMs = start;
      const made = await ensurePartitions(pool).catch((e: unknown) => {
        log("partition maintenance failed", { error: (e as Error).message });
        return [] as string[];
      });
      if (made.length) log("partitions created", { partitions: made });
      const repaired = await reconcileRuleCurrent(pool).catch((e: unknown) => {
        log("rule projection reconcile failed", { error: (e as Error).message });
        return 0;
      });
      // Logged even at zero would be noise; logged when non-zero it is a real signal
      // that writes are being lost somewhere and deserves looking at.
      if (repaired > 0) log("rule projection drift repaired", { rows: repaired });
    }
    const discovered = await discoveryDue(start);
    const due = await dueCandidates(pool, workerConfig.maxCandidatesPerCycle);
    const fresh = await freshCandidates(pool, workerConfig.maxCandidatesPerCycle, FRESH_MAX_AGE_HOURS);
    // Dedup work by MINT: processMint always resolves a mint to its primary pair,
    // so a mint with several candidates (multiple pools) must be processed once per
    // cycle — otherwise it inserts duplicate time-series rows and wastes API calls.
    const seenMints = new Set<string>();
    const cap = workerConfig.maxCandidatesPerCycle;

    // STARVATION FIX. Newly discovered mints used to be appended AFTER the due list and
    // the result truncated to `cap`. With a backlog of 406 overdue candidates the due
    // list filled the cycle by itself, so nothing new could ever enter the system —
    // changing the discovery source alone had no visible effect for exactly this reason.
    // Discovery now holds a reserved share of every cycle; the backlog fills the rest.
    const discoverySlots = Math.min(discovered.length, Math.ceil(cap * DISCOVERY_CYCLE_SHARE));
    const work: Array<{ mint: string; id: string | null }> = [];
    for (const m of discovered.slice(0, discoverySlots)) {
      if (!seenMints.has(m)) { seenMints.add(m); work.push({ mint: m, id: null }); }
    }
    // Second reserved lane, same reasoning as discovery's. Being ADMITTED promptly was
    // never the problem; being looked at again afterwards was. Without this, a coin
    // found at 60 minutes old got its second observation behind a 25-day backlog, and
    // one price point is not a chart — there is nothing to judge an entry on.
    const freshSlots = Math.min(fresh.length, Math.ceil(cap * FRESH_CYCLE_SHARE));
    let freshTaken = 0;
    for (const f of fresh) {
      if (freshTaken >= freshSlots) break;
      if (!seenMints.has(f.mint)) { seenMints.add(f.mint); work.push({ mint: f.mint, id: f.id }); freshTaken++; }
    }
    for (const d of due) {
      if (work.length >= cap) break;
      if (!seenMints.has(d.mint)) { seenMints.add(d.mint); work.push({ mint: d.mint, id: d.id }); }
    }
    // Any discovery left over after the backlog is served still gets a seat if there is room.
    for (const m of discovered.slice(discoverySlots)) {
      if (work.length >= cap) break;
      if (!seenMints.has(m)) { seenMints.add(m); work.push({ mint: m, id: null }); }
    }
    const bounded = work.slice(0, cap);

    await mapLimit(bounded, workerConfig.maxConcurrent, (w) => processMint(w.mint, w.id, start));

    // Async enrichment: fully decoupled — never blocks the market scan above.
    const enrich = await drainEnrichment(Date.now());
    const shadow = await measureOpenSignals(pool, Date.now()).catch(() => ({ measured: 0, closed: 0 }));
    const phases = await measurePhaseSnapshots(pool, Date.now()).catch(() => ({ measured: 0, closed: 0 }));
    // Grade past decisions — including the rejections. Measurement only.
    // A swallowed error here reads as "nothing to measure", which is exactly how a
    // broken grading query stays invisible for days. Log the reason, don't hide it.
    const verdicts = await measureVerdictOutcomes(pool, Date.now()).catch((e: unknown) => {
      log("verdict grading failed", { error: (e as Error).message });
      return { measured: 0, unobservable: 0, error: (e as Error).message };
    });
    const [queueDepth, depthByType, uniqueQueued, oldestAge] = await Promise.all([
      queue.depth().catch(() => 0),
      queue.depthByType().catch(() => ({})),
      queue.uniqueQueued().catch(() => 0),
      queue.oldestPendingAgeMs(Date.now()).catch(() => null),
    ]);
    const qs = queue.stats();

    const ms = Date.now() - start;
    cycleCount++;
    avgCycleMs = avgCycleMs === 0 ? ms : Math.round(avgCycleMs * 0.8 + ms * 0.2);
    await writeHeartbeat(pool, WORKER_ID, {
      status: "RUNNING", cycleCount, lastCycleMs: ms, avgCycleMs, candidatesLastCycle: bounded.length,
      detail: {
        breaker: breaker.state, heliusBreaker: heliusBreaker.state, heliusMode, telegram: channel.mode,
        discovered: discovered.length, due: due.length,
        enrichQueueDepth: queueDepth, enrichQueueByType: depthByType, uniqueQueued, oldestJobAgeMs: oldestAge,
        enriched: enrich.enriched, reeval: enrich.reeval, queueStats: qs, tickMs: workerConfig.cycleTickMs,
      },
    });
    const fault = systemicFault(cycleErrors, bounded.length);
    if (fault.systemic) {
      log("SYSTEMIC FAULT", {
        error: fault.reason, affected: fault.count, of: bounded.length,
        hint: "every candidate is failing the same way — this is an outage, not bad data",
      });
    }
    log("cycle done", { ms, candidates: bounded.length, fresh: freshTaken, errors: cycleErrors.length, enriched: enrich.enriched, reeval: enrich.reeval, shadow, phases, verdicts, queueDepth, byType: depthByType, oldestJobAgeMs: oldestAge, stats: qs, breaker: breaker.state });
    return { candidates: bounded.length, fresh: freshTaken, errors: cycleErrors.length, discovered: discovered.length, due: due.length, cap, ms };
  } finally {
    inCycle = false;
  }
}

async function loop(): Promise<void> {
  const lock = new CycleLock();
  await lock.connect();
  if (redis) await redis.connect().catch(() => undefined);
  await writeHeartbeat(pool, WORKER_ID, { status: "STARTING", cycleCount });

  const shutdown = async (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("shutting down", { sig });
    // let an in-flight cycle finish (best-effort)
    for (let i = 0; i < 50 && inCycle; i++) await new Promise((r) => setTimeout(r, 100));
    await writeHeartbeat(pool, WORKER_ID, { status: "STOPPING", cycleCount }).catch(() => undefined);
    await lock.release();
    lock.disconnect();
    if (redis) redis.disconnect();
    await closePool();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // pump.fun's free event stream (every launch and graduation) for the Learning Lab. One connection in the whole system: the feed
  // takes a database lock, so if scripts/lab-daemon.ts already holds it this one waits quietly. PUMP_FEED=0 switches it off.
  if (process.env.PUMP_FEED !== "0" && !process.env.VERCEL) {
    const feed = new PumpFeed(pool as never, log);
    void feed.start();
    process.once("exit", () => feed.stop());
  }
  log("started", { intervals: { discovery: workerConfig.discoveryIntervalMs, tick: workerConfig.cycleTickMs }, telegram: channel.mode, helius: heliusMode });
  while (!shuttingDown) {
    const gotLock = await lock.acquire(workerConfig.cycleTickMs * 3);
    if (gotLock) {
      try { await runCycle(); } catch (err) { log("cycle failed", { error: (err as Error).message }); }
      finally { await lock.release(); }
    } else {
      log("cycle skipped: another worker holds the lock");
    }
    maybeRunLab();
    maybePollWatch();
    await new Promise((r) => setTimeout(r, workerConfig.cycleTickMs));
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "once";
  try {
    // Boot check. Without a partition for the current month every write fails, so
    // starting up "successfully" would be a lie.
    const made = await ensurePartitions(pool);
    if (made.length) log("partitions created", { partitions: made });
    if (!(await currentMonthWritable(pool))) {
      log("FATAL", { error: "no partition for the current month — market data cannot be written" });
      await closePool();
      process.exit(1);
    }
    if (mode === "start" || mode === "watch") {
      await loop();
    } else {
      if (redis) await redis.connect().catch(() => undefined);
      await runCycle();
      await writeHeartbeat(pool, WORKER_ID, { status: "IDLE", cycleCount });
      if (redis) redis.disconnect();
      await closePool();
    }
  } catch (err) {
    log("FATAL", { error: (err as Error).message });
    await closePool();
    process.exitCode = 1;
  }
}

/**
 * One bounded scan for the web app (Vercel). The same cycle as `once`, without the parts that only make
 * sense for a process of its own: it does not close the shared pool and never calls process.exit.
 */
export async function scanOnce(): Promise<{ ok: boolean; reason?: string; stats?: CycleStats }> {
  try {
    if (!(await currentMonthWritable(pool))) {
      return { ok: false, reason: "no partition for the current month - market data cannot be written" };
    }
    const stats = await runCycle();
    if (!stats) return { ok: false, reason: "a scan is already running in this instance" };
    await writeHeartbeat(pool, WORKER_ID, { status: "IDLE", cycleCount });
    return { ok: true, stats };
  } catch (err) {
    log("scan failed", { error: (err as Error).message });
    return { ok: false, reason: (err as Error).message };
  }
}

// Run as a command (tsx apps/worker/src/run.ts once|watch|start). When the web app imports this file,
// process.argv[1] is Next's own entry point, so nothing starts on import; AUREUS_EMBEDDED=1 (set by the
// web app before it imports this module) makes that explicit instead of relying on the file name.
if (process.env.AUREUS_EMBEDDED !== "1" && /[\\/]run\.(ts|js|mjs|cjs)$/.test(process.argv[1] ?? "")) {
  void main();
}
