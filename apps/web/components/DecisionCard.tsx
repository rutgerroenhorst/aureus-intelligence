"use client";
import Link from "next/link";
import type { CandidateDecisionView } from "../lib/candidateView";
import { usd, ago, dexUrl, shortMint } from "../lib/format";

// ── shared formatting ────────────────────────────────────────────────────────
export function pctSigned(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const p = v * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(Math.abs(p) >= 10 ? 0 : 1)}%`;
}
export function pctPlain(v: number | null | undefined, dp = 0): string {
  return v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(dp)}%`;
}
export function dur(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}
export function price(v: number | null | undefined): string {
  return v == null ? "—" : usd(v);
}

export const STATUS_TONE: Record<string, string> = {
  ENTRY_READY: "st-ready", ENTRY_APPROACHING: "st-approach", SETUP_FORMING: "st-setup",
  FUNDAMENTAL_WATCH: "st-watch", DISCOVERED: "st-disc", TOO_EXTENDED: "st-ext",
  INVALIDATED: "st-inval", REJECTED: "st-rej", EXPIRED: "st-rej",
};
const PRIORITY_TONE: Record<string, string> = {
  CRITICAL: "pr-crit", PRIMARY: "pr-primary", SECONDARY: "pr-secondary",
  OBSERVATION: "pr-obs", DORMANT: "pr-dormant",
};

/** Plain language for each ENTRY_READY precondition. The card must never show a raw
 *  gate identifier as the reason a user cannot act. */
const GATE_PLAIN: Record<string, string> = {
  structure_confirmed:  "a confirmed entry structure",
  entry_rules_pass:     "all four entry rules passing",
  core_safety_pass:     "Core Safety to reach PASS",
  data_fresh:           "fresh market data",
  slippage_ok:          "slippage within the limit",
  not_late_chase:       "price out of the chase zone",
  move_not_spent:       "the move not already spent",
  meets_quality_floor:  "the tradability floor (pool depth, volume, turnover)",
  not_distributing:     "sellers to stop distributing",
};

const TREND_ICON: Record<string, string> = { NEW: "◆", RISING: "▲", STABLE: "●", FALLING: "▼" };

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill ${STATUS_TONE[status] ?? "st-disc"}`}>{status.replace(/_/g, " ")}</span>;
}
export function PriorityPill({ priority }: { priority: string }) {
  return <span className={`pill ghost ${PRIORITY_TONE[priority] ?? "pr-obs"}`}>{priority}</span>;
}

/** Scan cadence indicator derived from persisted next_scan_at. */
export function ScanState({ nextScanAt, now }: { nextScanAt: string | null; now: number }) {
  if (!nextScanAt) return <span className="scan idle">dormant</span>;
  const dt = Math.round((Date.parse(nextScanAt) - now) / 1000);
  if (Math.abs(dt) <= 2) return <span className="scan now">scanning now</span>;
  if (dt < 0) return <span className="scan over">overdue {-dt}s</span>;
  return <span className="scan next">next in {dt}s</span>;
}

function Metric({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return <div className="m"><div className="mk">{k}</div><div className={`mv ${tone ?? ""}`}>{v}</div></div>;
}

/** Trend arrow coloured by direction, for price/liquidity deltas. */
function Delta({ v }: { v: number | null }) {
  const t = v == null ? "" : v > 0.001 ? "up" : v < -0.001 ? "down" : "flat";
  return <span className={`delta ${t}`}>{pctSigned(v)}</span>;
}

export function DecisionCard({ v, rank, now, flash }: { v: CandidateDecisionView; rank?: number; now: number; flash?: string | null }) {
  const safetyTone = v.coreSafety === "PASS" ? "ok" : v.coreSafety === "FAIL" ? "bad" : "warn";
  const drainTone = v.drainStatus === "OK" ? "ok" : v.drainStatus === "FAIL" ? "bad" : "warn";
  const sellTone = v.sellClass === "SELLABLE" ? "ok" : v.sellClass === "CONFIRMED_SELLABILITY_FAIL" ? "bad" : "warn";

  return (
    <article className={`dcard ${flash ? "flash" : ""}`}>
      <header className="dcard-top">
        <div className="dcard-id">
          {rank != null ? <span className="rank">#{rank}</span> : null}
          <div>
            <div className="tok">
              {v.symbol ?? "Unknown"}
              <StatusPill status={v.status} />
              <PriorityPill priority={v.priority} />
              {flash ? <span className={`flag f-${flash}`}>{flash.replace(/-/g, " ")}</span> : null}
            </div>
            <div className="sub mono">{shortMint(v.mint)} · pool {shortMint(v.pool)}</div>
          </div>
        </div>
        <div className="dcard-price">
          <div className="p">{price(v.priceUsd)}</div>
          <div className="pc"><Delta v={v.priceChange.m30} /> <span className="dim">30m</span></div>
        </div>
      </header>

      {/* ONE canonical blocker, always the loudest line on the card */}
      <div className={`blocker ${v.status === "ENTRY_READY" ? "clear" : ""}`}>
        <span className="bl-label">BLOCKED BY</span>
        <span className="bl-text">{v.primaryBlocker}</span>
      </div>
      {v.secondaryBlockers.length > 0 ? (
        <div className="sec-blockers">also: {v.secondaryBlockers.slice(0, 3).join(" · ")}</div>
      ) : null}

      <div className="metrics">
        <Metric k="Liquidity" v={price(v.liquidityUsd)} />
        <Metric k="Liq 30m" v={pctSigned(v.liqTrend.m30)} tone={(v.liqTrend.m30 ?? 0) < -0.05 ? "bad" : ""} />
        <Metric k="Volume" v={price(v.volumeUsd)} />
        <Metric k="Buys/Sells" v={`${v.buys ?? "—"}/${v.sells ?? "—"}`} />
        <Metric k="MCap" v={price(v.marketCapUsd)} />
        <Metric k="Top-10" v={pctPlain(v.holderTop10)} tone={(v.holderTop10 ?? 0) >= 0.55 ? "bad" : (v.holderTop10 ?? 0) >= 0.30 ? "warn" : ""} />
        <Metric k="Insider" v={pctPlain(v.insiderPct)} tone={(v.insiderPct ?? 0) > 0.5 ? "warn" : ""} />
        <Metric k="Pair age" v={dur(v.pairAgeMs)} />
      </div>

      <div className="chips">
        <span className={`chip ${safetyTone}`}>CORE SAFETY {v.coreSafety}</span>
        <span className="chip warn">ADVANCED {v.advanced}</span>
        <span className={`chip ${sellTone}`}>{(v.sellClass ?? "sellability unknown").replace(/_/g, " ").toLowerCase()}</span>
        <span
          className={`chip ${drainTone}`}
          title={v.unmeasuredHorizons.length ? `Not measured: ${v.unmeasuredHorizons.join("; ")}` : undefined}
        >
          {v.drainStatus === "INCOMPLETE"
            ? "drain not measurable"
            : `drain ${v.drainSeverity.replace(/_/g, " ")}`}
        </span>
        <span className={`chip ${v.liveness === "ACTIVE" ? "ok" : v.liveness === "POOL_GONE" || v.liveness === "FROZEN" ? "bad" : "warn"}`}>
          market {v.liveness.replace(/_/g, " ").toLowerCase()}
        </span>
        {v.trendHorizon ? (
          <span
            className={`chip ${v.degenerateHorizons ? "warn" : "dim"}`}
            title={v.degenerateHorizons
              ? "This pair is younger than the 6h/24h windows, so the feed reports those as copies of a shorter one. The trend is read from the shortest window that actually contains history."
              : "The pair is old enough that the 6h window is real history."}
          >
            {v.trendHorizon === "none" ? "trend: too young to read" : `trend from ${v.trendHorizon}`}
            {v.degenerateHorizons && v.trendHorizon !== "none" ? " · 6h/24h duplicated" : ""}
          </span>
        ) : null}
        {v.activity && v.activity !== "UNKNOWN" ? (
          <span
            className={`chip ${v.activity === "REAL" ? "ok" : v.activity === "THIN" ? "warn" : "bad"}`}
            title={`turnover ${v.turnover?.toFixed(2) ?? "—"}× · avg trade $${v.avgTradeUsd?.toFixed(2) ?? "—"}. Bundling hides holder concentration, but it cannot fake how a real market flows.`}
          >
            {v.activity === "REAL" ? "market real"
              : v.activity === "THIN" ? "thin market"
              : v.activity === "PARKED" ? `parked · ${v.turnover?.toFixed(2)}× turnover`
              : `wash traded · $${v.avgTradeUsd?.toFixed(2)}/trade`}
          </span>
        ) : null}
        <span className="chip dim">{v.proximity.replace(/_/g, " ").toLowerCase()}</span>
        <span className="chip dim">Q{v.qualityRank ?? "—"} · E{v.entryRank ?? "—"}</span>
      </div>

      {/* what we're waiting for */}
      {v.status !== "REJECTED" && v.status !== "INVALIDATED" ? (
        <div className="waitbox">
          <div className="wb-h">{v.status === "ENTRY_READY" ? "ENTRY PLAN" : "WHAT AUREUS IS WAITING FOR"}</div>
          <div className="wb-cols">
            <div>
              <div className="wb-t">Confirmed</div>
              {(v.confirmed.length ? v.confirmed : v.positives).slice(0, 5).map((t, i) => <div key={i} className="ok-l">✓ {t}</div>)}
              {v.confirmed.length === 0 && v.positives.length === 0 ? <div className="dim">—</div> : null}
            </div>
            <div>
              <div className="wb-t">Waiting</div>
              {v.waiting.length ? v.waiting.slice(0, 5).map((t, i) => <div key={i} className="wait-l">○ {t}</div>)
                : <div className="wait-l">○ {v.primaryBlocker}</div>}
            </div>
          </div>

          {v.entryReadyBlockers.length > 0 ? (
            <div className="gates">
              <div className="gates-h">
                Entry ready needs {v.entryReadyBlockers.length} more condition{v.entryReadyBlockers.length > 1 ? "s" : ""}
              </div>
              <div className="gates-list">
                {v.entryReadyBlockers.map((g) => (
                  <span key={g} className="gate">{GATE_PLAIN[g] ?? g.replace(/_/g, " ")}</span>
                ))}
              </div>
            </div>
          ) : null}

          {v.plan && v.plan.valid ? (
            <div className="plan">
              <div className={`plan-label ${v.plan.provisional ? "prov" : "live"}`}>{v.plan.label}</div>
              <div className="plan-grid">
                <div><span className="pk">Trigger</span> {v.bestEntryType ?? v.plan.triggerType}</div>
                <div><span className="pk">Entry area</span> {price(v.plan.entryAreaLow)} – {price(v.plan.entryAreaHigh)}</div>
                <div><span className="pk">Invalidation</span> {price(v.plan.invalidation)}</div>
                <div><span className="pk">Max chase</span> {price(v.plan.maxChase)}</div>
                <div><span className="pk">Target</span> {price(v.plan.target)}</div>
                <div><span className="pk">Est. slippage</span> {v.plan.estSlippagePct != null ? `${v.plan.estSlippagePct}%` : "—"}</div>
              </div>
              <div className={`plan-cost ${v.plan.targetViable ? "ok" : "bad"}`}>
                <span className="pk">Round trip</span>
                {v.plan.roundTripCost != null
                  ? <>
                      <b>{(v.plan.roundTripCost * 100).toFixed(1)}%</b> in+out ·
                      break-even <b>+{((v.plan.breakevenMove ?? 0) * 100).toFixed(1)}%</b> ·
                      {v.plan.targetViable ? " target clears it" : " TARGET DOES NOT CLEAR COST"}
                      {v.plan.maxPositionUsd != null
                        ? <span className="dim"> · max size for a 10% round trip ≈ ${Math.round(v.plan.maxPositionUsd)}</span>
                        : null}
                    </>
                  : <span className="dim">{v.plan.costNote}</span>}
              </div>
              <div className="plan-src">Levels from {v.plan.structureSource}. Needs: {v.plan.requiredConfirmation}.</div>
            </div>
          ) : v.plan ? (
            <div className="plan invalid">
              <div className="plan-label bad">NO ENTRY AREA SHOWN</div>
              <div className="plan-src">Levels not usable: {v.plan.invalidReasons.join("; ")}.</div>
            </div>
          ) : null}
        </div>
      ) : null}

      {v.unknownRisks.length > 0 ? (
        <div className="risks"><span className="rk unknown">UNKNOWN RISK</span> {v.unknownRisks.join(", ")} <span className="dim">— needs a paid indexer; never counted as a pass</span></div>
      ) : null}
      {v.knownRisks.length > 0 ? (
        <div className="risks"><span className="rk known">KNOWN RISK</span> {v.knownRisks.join(", ")}</div>
      ) : null}

      <footer className="dcard-foot">
        <span className="mono dim">
          {TREND_ICON[v.trend] ?? "◆"} {v.trend.toLowerCase()} · {dur(v.sinceMs)} in status · {v.scans} scans
          {v.prevStatus ? ` · from ${v.prevStatus.replace(/_/g, " ").toLowerCase()}` : ""}
        </span>
        <span className="foot-right">
          <ScanState nextScanAt={v.nextScanAt} now={now} />
          <Link className="btn xs primary" href={`/candidate/${v.id}`}>Open</Link>
          <a className="btn xs" href={dexUrl(v.mint, v.pool)} target="_blank" rel="noreferrer">Dex ↗</a>
        </span>
      </footer>
    </article>
  );
}
