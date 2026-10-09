import Link from "next/link";
import type { CandidateDecisionView } from "../../../lib/candidateView";
import { usd, ago, dexUrl, shortMint } from "../../../lib/format";

const pct = (v: number | null | undefined, dp = 0) => (v == null ? "—" : `${(v * 100).toFixed(dp)}%`);
const sgn = (v: number | null | undefined) => {
  if (v == null) return "—";
  const p = v * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(Math.abs(p) >= 10 ? 0 : 1)}%`;
};
const dur = (ms: number | null | undefined) => {
  if (ms == null) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
};

/**
 * The canonical decision header for the candidate detail page.
 * Reads the SAME CandidateDecisionView the board and Today use — so status,
 * priority, live drain, blocker and plan cannot disagree between pages.
 */
export function DecisionHeader({ v, now }: { v: CandidateDecisionView; now: number }) {
  const tone = v.coreSafety === "PASS" ? "ok" : v.coreSafety === "FAIL" ? "bad" : "warn";
  const drainTone = v.drainStatus === "OK" ? "ok" : v.drainStatus === "FAIL" ? "bad" : "warn";
  const sellTone = v.sellClass === "SELLABLE" ? "ok" : v.sellClass === "CONFIRMED_SELLABILITY_FAIL" ? "bad" : "warn";
  const st = v.status.replace(/_/g, " ");

  return (
    <div className="dhead">
      <div className="dhead-top">
        <div>
          <div className="dh-tok">
            {v.symbol ?? "Unknown"}
            <span className={`pill st-${v.status === "ENTRY_READY" ? "ready" : v.status === "ENTRY_APPROACHING" ? "approach" : v.status === "REJECTED" ? "rej" : v.status === "INVALIDATED" ? "inval" : v.status === "TOO_EXTENDED" ? "ext" : v.status === "DISCOVERED" ? "disc" : "watch"}`}>{st}</span>
            <span className="pill ghost pr-primary">{v.priority}</span>
          </div>
          <div className="mono sub">{shortMint(v.mint)} · pool {shortMint(v.pool)}</div>
        </div>
        <div className="dh-price">
          <div className="p">{v.priceUsd == null ? "—" : usd(v.priceUsd)}</div>
          <div className="pc mono">{sgn(v.priceChange.m5)} 5m · {sgn(v.priceChange.m15)} 15m · {sgn(v.priceChange.m30)} 30m</div>
        </div>
      </div>

      <div className={`blocker ${v.status === "ENTRY_READY" ? "clear" : ""}`}>
        <span className="bl-label">BLOCKED BY</span>
        <span className="bl-text">{v.primaryBlocker}</span>
      </div>
      {v.secondaryBlockers.length ? <div className="sec-blockers">also: {v.secondaryBlockers.join(" · ")}</div> : null}

      <div className="metrics">
        <div className="m"><div className="mk">Liquidity</div><div className="mv">{v.liquidityUsd == null ? "—" : usd(v.liquidityUsd)}</div></div>
        <div className="m"><div className="mk">Liq 5/15/30m</div><div className="mv">{sgn(v.liqTrend.m5)} · {sgn(v.liqTrend.m15)} · {sgn(v.liqTrend.m30)}</div></div>
        <div className="m"><div className="mk">Volume</div><div className="mv">{v.volumeUsd == null ? "—" : usd(v.volumeUsd)}</div></div>
        <div className="m"><div className="mk">Buys/Sells</div><div className="mv">{v.buys ?? "—"}/{v.sells ?? "—"}</div></div>
        <div className="m"><div className="mk">Top-10</div><div className="mv">{pct(v.holderTop10)}</div></div>
        <div className="m"><div className="mk">Insider</div><div className="mv">{pct(v.insiderPct)}</div></div>
        <div className="m"><div className="mk">Pair age</div><div className="mv">{dur(v.pairAgeMs)}</div></div>
        <div className="m"><div className="mk">Data age</div><div className="mv">{dur(v.freshnessMs)}</div></div>
      </div>

      <div className="chips">
        <span className={`chip ${tone}`}>CORE SAFETY {v.coreSafety}</span>
        <span className="chip warn">ADVANCED {v.advanced}</span>
        <span className={`chip ${sellTone}`}>{(v.sellClass ?? "sellability unknown").replace(/_/g, " ").toLowerCase()}</span>
        <span className={`chip ${drainTone}`}>drain {v.drainSeverity.replace(/_/g, " ")} (live)</span>
        <span className="chip dim">{v.proximity.replace(/_/g, " ").toLowerCase()}</span>
        <span className="chip dim">Q{v.qualityRank ?? "—"} · E{v.entryRank ?? "—"}</span>
        <span className="chip dim">{v.trend.toLowerCase()} · {dur(v.sinceMs)} in status · {v.scans} scans</span>
      </div>

      {v.plan && v.plan.valid ? (
        <div className="plan">
          <div className={`plan-label ${v.plan.provisional ? "prov" : "live"}`}>{v.plan.label}</div>
          <div className="plan-grid">
            <div><span className="pk">Trigger</span> {v.bestEntryType ?? v.plan.triggerType}</div>
            <div><span className="pk">Entry area</span> {v.plan.entryAreaLow == null ? "—" : usd(v.plan.entryAreaLow)} – {v.plan.entryAreaHigh == null ? "—" : usd(v.plan.entryAreaHigh)}</div>
            <div><span className="pk">Invalidation</span> {v.plan.invalidation == null ? "—" : usd(v.plan.invalidation)}</div>
            <div><span className="pk">Max chase</span> {v.plan.maxChase == null ? "—" : usd(v.plan.maxChase)}</div>
            <div><span className="pk">Target</span> {v.plan.target == null ? "—" : usd(v.plan.target)}</div>
            <div><span className="pk">Est. slippage</span> {v.plan.estSlippagePct == null ? "—" : `${v.plan.estSlippagePct}%`}</div>
          </div>
          <div className="plan-src">Levels from {v.plan.structureSource}. Needs: {v.plan.requiredConfirmation}.</div>
        </div>
      ) : v.plan ? (
        <div className="plan invalid">
          <div className="plan-label bad">NO ENTRY AREA SHOWN</div>
          <div className="plan-src">Levels not usable: {v.plan.invalidReasons.join("; ")}.</div>
        </div>
      ) : null}

      {v.unknownRisks.length ? <div className="risks"><span className="rk unknown">UNKNOWN RISK</span> {v.unknownRisks.join(", ")}</div> : null}
      {v.knownRisks.length ? <div className="risks"><span className="rk known">KNOWN RISK</span> {v.knownRisks.join(", ")}</div> : null}

      <div className="dcard-foot">
        <span className="mono dim">last scan {v.lastScanAt ? `${ago(v.lastScanAt, now)} ago` : "—"}</span>
        <span className="foot-right">
          <Link className="btn xs" href="/action-board">← Action Board</Link>
          <a className="btn xs primary" href={dexUrl(v.mint, v.pool)} target="_blank" rel="noreferrer">Dex Screener ↗</a>
        </span>
      </div>
    </div>
  );
}
