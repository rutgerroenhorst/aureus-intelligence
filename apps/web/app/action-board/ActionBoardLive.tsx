"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { BoardData, BoardCandidate, ActionStatus } from "../../lib/actionBoard";
import { ACTION_LABEL } from "../../lib/actionBoard";
import { usd, ago, dexUrl, shortMint } from "../../lib/format";

const STATUS_RANK: Record<ActionStatus, number> = {
  ACTIONABLE_NOW: 6, WATCH_SAFETY_INCOMPLETE: 5, WAIT_FOR_ENTRY: 4, TOO_EXTENDED: 3, INVALIDATED: 2, REJECTED: 1,
};
type Change = "promoted" | "downgraded" | "newly-actionable" | "invalidated" | null;

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const p = v * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(Math.abs(p) >= 10 ? 0 : 1)}%`;
}
function fmtRatioPct(v: number | null): string { return v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(1)}%`; }
function fmtRatio(v: number | null): string { return v == null ? "—" : v === Infinity ? "∞" : v.toFixed(2); }
function conc(v: number | null): string { return v == null ? "UNKNOWN" : `${(v * 100).toFixed(0)}%`; }
function ageMs(ms: number | null, now: number): string { return ms == null ? "—" : ago(new Date(now - ms).toISOString(), now); }

/** Monitoring status from next_scan_at: SCANNING NOW / OVERDUE BY Xs / NEXT SCAN IN Xs. */
function monitorStatus(nextScanAt: string | null, now: number): { label: string; cls: string } {
  if (!nextScanAt) return { label: "—", cls: "ms-idle" };
  const dtSec = Math.round((Date.parse(nextScanAt) - now) / 1000);
  if (Math.abs(dtSec) <= 2) return { label: "SCANNING NOW", cls: "ms-now" };
  if (dtSec < 0) return { label: `OVERDUE BY ${-dtSec}s`, cls: "ms-overdue" };
  return { label: `NEXT SCAN IN ${dtSec}s`, cls: "ms-next" };
}

export function ActionBoardLive({ initial, debug = false }: { initial: BoardData; debug?: boolean }) {
  const [board, setBoard] = useState<BoardData>(initial);
  const [changes, setChanges] = useState<Record<string, Change>>({});
  // Anchor relative-time rendering to a value that is identical on server and first
  // client render (avoids hydration mismatch); tick it forward only after mount.
  const [now, setNow] = useState<number>(() => Date.parse(initial.generatedAt) || 0);
  const prevStatus = useRef<Record<string, ActionStatus>>({});

  useEffect(() => {
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  // seed prev-status from initial
  useEffect(() => {
    const seed: Record<string, ActionStatus> = {};
    for (const b of ["A", "B", "C", "D"] as const) for (const c of initial.buckets[b]) seed[c.id] = c.action.status;
    prevStatus.current = seed;
  }, [initial]);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/action-board", { cache: "no-store" });
        if (!res.ok) return;
        const next: BoardData = await res.json();
        if (!alive) return;
        // diff statuses → transient change badges
        const nextChanges: Record<string, Change> = {};
        for (const b of ["A", "B", "C", "D"] as const) {
          for (const c of next.buckets[b]) {
            const old = prevStatus.current[c.id];
            const nw = c.action.status;
            if (old && old !== nw) {
              if (nw === "ACTIONABLE_NOW") nextChanges[c.id] = "newly-actionable";
              else if (nw === "INVALIDATED" || nw === "REJECTED") nextChanges[c.id] = "invalidated";
              else if (STATUS_RANK[nw] > STATUS_RANK[old]) nextChanges[c.id] = "promoted";
              else nextChanges[c.id] = "downgraded";
            }
            prevStatus.current[c.id] = nw;
          }
        }
        setBoard(next);
        if (Object.keys(nextChanges).length) {
          setChanges((c) => ({ ...c, ...nextChanges }));
          setTimeout(() => { if (alive) setChanges((c) => { const cp = { ...c }; for (const k of Object.keys(nextChanges)) delete cp[k]; return cp; }); }, 12_000);
        }
      } catch { /* keep last board on transient error */ }
    };
    const iv = setInterval(poll, 10_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const w = board.worker;
  const empty: BoardCandidate[] = [];
  const sec = board.sections ?? { ENTRY_READY: empty, ENTRY_APPROACHING: empty, PRIMARY_WATCH: empty, SETUP_FORMING: empty, TOO_EXTENDED: empty, SECONDARY_WATCH: empty, INVALID_REJECTED: empty };
  return (
    <>
      <div className="ab-sys">
        <span className={`livedot ${w.online ? "on" : "off"}`} />
        <span className="lbl-strong">{w.online ? "WORKER LIVE" : "WORKER OFFLINE"}</span>
        <span className="lb-sep">·</span>
        <span>Helius <b className={w.heliusMode === "LIVE" ? "tg-on" : "tg-off"}>{w.heliusMode}</b></span>
        <span className="lb-sep">·</span>
        <span>last scan <b>{w.lastCycleAt ? ago(w.lastCycleAt, now) + " ago" : "—"}</b></span>
        <span className="lb-sep">·</span>
        <span>last enrichment <b>{w.lastEnrichmentAt ? ago(w.lastEnrichmentAt, now) + " ago" : "—"}</b></span>
        <span className="lb-grow" />
        <span>monitored <b>{w.activeMonitored}</b></span>
        <span className="lb-sep">·</span>
        <span className="mono ab-refresh">refreshes every 10s</span>
      </div>

      {debug ? <div className="ab-debug-flag">DEBUG MODE — ranking breakdown shown per card</div> : null}

      <div className="ab-sys">
        <span className="lbl-strong">WATCH</span>
        <span className="lb-sep">·</span><span>fundamental <b>{board.counts.fundamentalWatch}</b></span>
        <span className="lb-sep">·</span><span>setup forming <b>{board.counts.setupForming}</b></span>
        <span className="lb-sep">·</span><span>entry approaching <b>{board.counts.entryApproaching}</b></span>
        <span className="lb-sep">·</span><span>entry ready <b className={board.counts.entryReady ? "tg-on" : ""}>{board.counts.entryReady}</b></span>
        <span className="lb-sep">·</span><span>too extended <b>{board.counts.tooExtended}</b></span>
      </div>

      {/* BEST CURRENT CANDIDATE */}
      {board.best ? <BestCard c={board.best} change={changes[board.best.id] ?? null} now={now} debug={debug} /> : (
        <div className="ab-best empty">No active candidates right now.</div>
      )}

      {/* A. ENTRY READY */}
      <Section title="A · ENTRY READY" sub="Core Safety PASS + confirmed structure — concrete plan" tone="go">
        {sec.ENTRY_READY.length === 0
          ? <div className="ab-none">NO VALID ENTRY RIGHT NOW</div>
          : sec.ENTRY_READY.map((c, i) => <CandidateCard key={c.id} c={c} rank={i + 1} change={changes[c.id] ?? null} now={now} debug={debug} entryPlan />)}
      </Section>

      {/* B. ENTRY APPROACHING */}
      <Section title="B · ENTRY APPROACHING" sub="Most conditions met — awaiting final confirmation" tone="wait">
        {sec.ENTRY_APPROACHING.length === 0 ? <div className="ab-none subtle">None approaching.</div>
          : sec.ENTRY_APPROACHING.map((c, i) => <CandidateCard key={c.id} c={c} rank={i + 1} change={changes[c.id] ?? null} now={now} debug={debug} waiting />)}
      </Section>

      {/* C. PRIMARY FUNDAMENTAL WATCH — the "best coins to watch before entry" */}
      <Section title="C · PRIMARY FUNDAMENTAL WATCH" sub="Best ≤5 coins to follow before an entry exists" tone="wait">
        {sec.PRIMARY_WATCH.length === 0 ? <div className="ab-none subtle">No coins qualify for primary watch.</div>
          : sec.PRIMARY_WATCH.map((c, i) => <CandidateCard key={c.id} c={c} rank={i + 1} change={changes[c.id] ?? null} now={now} debug={debug} waiting />)}
      </Section>

      {/* D. SETUP FORMING */}
      <Section title="D · SETUP FORMING" sub="Base / range / pullback forming — monitored intensively" tone="wait">
        {sec.SETUP_FORMING.length === 0 ? <div className="ab-none subtle">None forming.</div>
          : sec.SETUP_FORMING.map((c, i) => <CandidateCard key={c.id} c={c} rank={i + 1} change={changes[c.id] ?? null} now={now} debug={debug} waiting />)}
      </Section>

      {/* E. TOO EXTENDED */}
      <Section title="E · TOO EXTENDED" sub="Strong, but do not chase — waiting for pullback/reclaim" tone="ext">
        {sec.TOO_EXTENDED.length === 0 ? <div className="ab-none subtle">None extended.</div>
          : sec.TOO_EXTENDED.map((c, i) => <CandidateCard key={c.id} c={c} rank={i + 1} change={changes[c.id] ?? null} now={now} debug={debug} waiting />)}
      </Section>

      {/* F. SECONDARY WATCH */}
      <Section title="F · SECONDARY WATCH" sub="Interesting, but further from an entry or more unknowns" tone="wait">
        {sec.SECONDARY_WATCH.length === 0 ? <div className="ab-none subtle">None.</div>
          : <div className="ab-rejlist">{sec.SECONDARY_WATCH.map((c) => (
              <div key={c.id} className="ab-rejrow">
                <span className={`ab-badge s-WAIT_FOR_ENTRY`}>{c.watch?.status.replace(/_/g, " ")}</span>
                <b>{c.symbol ?? "Unknown"}</b>
                <span className="mono">{shortMint(c.mint)}</span>
                <span className="ab-reason">Q{c.watch?.qualityRank ?? "—"} / E{c.watch?.entryRank ?? "—"} · {c.watch?.blocker}</span>
                <Link className="btn xs" href={`/candidate/${c.id}`}>Open</Link>
              </div>))}</div>}
      </Section>

      {/* G. RECENTLY INVALIDATED / REJECTED */}
      <Section title="G · RECENTLY INVALIDATED / REJECTED" sub="Removed from the active shortlist" tone="rej">
        {sec.INVALID_REJECTED.length === 0 ? <div className="ab-none subtle">None.</div>
          : <div className="ab-rejlist">{sec.INVALID_REJECTED.map((c) => (
              <div key={c.id} className="ab-rejrow">
                <span className={`ab-badge s-${c.action.status}`}>{ACTION_LABEL[c.action.status]}</span>
                <b>{c.symbol ?? "Unknown"}</b>
                <span className="mono">{shortMint(c.mint)}</span>
                <span className="ab-reason">{c.action.blocker}</span>
                <a className="btn xs" href={dexUrl(c.mint, c.pool)} target="_blank" rel="noreferrer">Dex ↗</a>
              </div>))}</div>}
      </Section>
    </>
  );
}

function Section({ title, sub, tone, children }: { title: string; sub: string; tone: string; children: React.ReactNode }) {
  return (
    <section className={`ab-sec tone-${tone}`}>
      <div className="ab-sec-head"><h2>{title}</h2><span className="ab-sec-sub">{sub}</span></div>
      {children}
    </section>
  );
}

function ChangeFlag({ change }: { change: Change }) {
  if (!change) return null;
  const label = change === "newly-actionable" ? "NEWLY ACTIONABLE" : change.toUpperCase();
  return <span className={`ab-flag f-${change}`}>{label}</span>;
}

/** Badge shows the persisted two-decision status when available (single source of
 *  truth); the legacy action status is only a fallback for rows without one. */
function StatusBadge({ s, c }: { s: ActionStatus; c?: BoardCandidate }) {
  const v2 = c?.watch?.status;
  if (v2) {
    const cls = v2 === "ENTRY_READY" ? "s-ACTIONABLE_NOW"
      : v2 === "REJECTED" ? "s-REJECTED" : v2 === "INVALIDATED" ? "s-INVALIDATED"
      : v2 === "TOO_EXTENDED" ? "s-TOO_EXTENDED"
      : v2 === "ENTRY_APPROACHING" ? "s-WATCH_SAFETY_INCOMPLETE" : "s-WAIT_FOR_ENTRY";
    return <span className={`ab-badge ${cls}`}>{v2.replace(/_/g, " ")}</span>;
  }
  return <span className={`ab-badge s-${s}`}>{ACTION_LABEL[s]}</span>;
}

function MetricGrid({ c, now }: { c: BoardCandidate; now: number }) {
  const a = c.action;
  const lt = a.liqTrend;
  return (
    <div className="ab-metrics">
      <M k="Price" v={usd(c.priceUsd)} />
      <M k="Price 5m / 15m / 30m" v={`${fmtPct(a.priceChange.m5)} · ${fmtPct(a.priceChange.m15)} · ${fmtPct(a.priceChange.m30)}`} />
      <M k="Liquidity" v={usd(c.liquidityUsd)} />
      <M k="Liq 5m/15m/30m/disc" v={`${fmtPct(lt.m5)} · ${fmtPct(lt.m15)} · ${fmtPct(lt.m30)} · ${fmtPct(lt.sinceDiscovery)}`} />
      <M k="Volume" v={`${usd(c.volumeUsd)} · ${a.volTrend}`} />
      <M k="Buys / Sells" v={`${c.buys ?? "—"} / ${c.sells ?? "—"}`} />
      <M k="Buy share / ratio" v={`${fmtRatioPct(a.buyShare)} · ${fmtRatio(a.buySellRatio)}×`} />
      <M k="MCap/FDV" v={usd(c.marketCapUsd)} />
      <M k="Holder top-10" v={conc(c.holderTop10)} />
      <M k="Pair age" v={ageMs(c.pairAgeMs, now)} />
      <M k="Mint / Freeze auth" v={`${c.mintAuthorityActive == null ? "UNKNOWN" : c.mintAuthorityActive ? "ACTIVE" : "none"} / ${c.freezeAuthorityActive == null ? "UNKNOWN" : c.freezeAuthorityActive ? "ACTIVE" : "none"}`} />
      <M k="Tier / Enrichment" v={`${c.monitoringTier.replace("TIER", "T").replace(/_.*/, "")} · ${c.enrichmentStatus}`} />
    </div>
  );
}

function RankBreakdown({ c }: { c: BoardCandidate }) {
  return (
    <div className="ab-breakdown">
      <div className="ab-entry-h">RANKING BREAKDOWN · score {c.action.rankingScore}</div>
      <table className="ab-bd-table"><tbody>
        {c.action.rankingBreakdown.map((b, i) => (
          <tr key={i}><td>{b.label}</td><td className={b.points >= 0 ? "pos" : "neg"}>{b.points >= 0 ? "+" : ""}{b.points}</td></tr>
        ))}
      </tbody></table>
    </div>
  );
}
function M({ k, v }: { k: string; v: string }) { return <div className="ab-m"><div className="k">{k}</div><div className="v">{v}</div></div>; }

function FamilyRow({ c }: { c: BoardCandidate }) {
  const a = c.action;
  const cls = (s: string) => (s.startsWith("PASS") ? "fam-pass" : s.startsWith("FAIL") ? "fam-fail" : "fam-inc");
  return (
    <div className="ab-fam">
      <span className={cls(a.safetySummary)}>Safety: {a.safetySummary}</span>
      <span className={cls(a.qualitySummary)}>Quality: {a.qualitySummary}</span>
      <span className={cls(a.entrySummary)}>Entry: {a.entrySummary}</span>
    </div>
  );
}

function chip(status: string | null): string {
  if (status === "OK" || status === "PASS") return "sc-ok";
  if (status === "FAIL") return "sc-fail";
  if (status === "UNAVAILABLE") return "sc-na";
  return "sc-inc";
}
function advChip(a: string): string { return a === "COMPLETE" ? "sc-ok" : a === "UNKNOWN" ? "sc-na" : "sc-inc"; }

function dur(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}
const px = (v: number | null) => (v == null ? "—" : usd(v));

/** The two-decision row: status + proximity + the two separate ranks + stability. */
function WatchRow({ c }: { c: BoardCandidate }) {
  const w = c.watch;
  if (!w) return null;
  const stCls = w.status === "ENTRY_READY" ? "sc-ok" : w.status === "REJECTED" || w.status === "INVALIDATED" ? "sc-fail" : "sc-inc";
  return (
    <div className="ab-safety">
      <span className={`ab-eff ${stCls}`}>{w.status.replace(/_/g, " ")}</span>
      <span className="sc-inc">{w.proximity.replace(/_/g, " ").toLowerCase()}</span>
      <span className="mono">quality {w.qualityRank ?? "—"}/100</span>
      <span className="mono">entry-readiness {w.entryRank ?? "—"}/100</span>
      <span className="mono">{w.priority}</span>
      <span className="mono">{w.trend} · {dur(w.sinceMs)} in status · {w.scans ?? 0} scans</span>
    </div>
  );
}

/** What Aureus is waiting for + the provisional (or confirmed) plan. */
function WatchPlan({ c }: { c: BoardCandidate }) {
  const w = c.watch;
  if (!w) return null;
  const p = w.plan;
  return (
    <div className={`ab-entry ${w.status === "ENTRY_READY" ? "go" : "wait"}`}>
      <div className="ab-entry-h">{p?.label ?? "WHAT AUREUS IS WAITING FOR"}</div>
      <div className="ab-check">
        <div className="col"><div className="ttl">Confirmed</div>
          {(w.confirmed.length ? w.confirmed : w.positives).map((t, i) => <div key={i} className="ok">✓ {t}</div>)}
        </div>
        <div className="col"><div className="ttl">Waiting</div>
          {w.waiting.length ? w.waiting.map((t, i) => <div key={i} className="open">○ {t}</div>) : <div className="open">○ {w.blocker}</div>}
        </div>
      </div>
      {p ? (
        <div className="ab-entry-foot">
          <span><b>Best entry type:</b> {w.bestEntryType ?? p.triggerType}</span>
          <span><b>Entry area:</b> {px(p.entryAreaLow)} – {px(p.entryAreaHigh)}</span>
          <span><b>Invalidation:</b> {px(p.invalidation)} · <b>Max chase:</b> {px(p.maxChase)}</span>
          <span><b>Target:</b> {px(p.target)} · <b>Est. slippage:</b> {p.estSlippagePct != null ? `${p.estSlippagePct}%` : "—"}</span>
          <span><b>Required confirmation:</b> {p.requiredConfirmation}</span>
        </div>
      ) : null}
      {p?.provisional ? <div className="ab-note">PROVISIONAL — NOT AN ENTRY YET. Levels come from observed prices only.</div> : null}
    </div>
  );
}
function SafetyRow({ c }: { c: BoardCandidate }) {
  const s = c.safetyDetail;
  if (!s) return null;
  return (
    <div className="ab-safety-block">
      <div className="ab-safety">
        <span className={`ab-eff ${chip(s.core)}`}>CORE SAFETY {s.core}</span>
        <span className={chip(s.sellability)}>sellability {s.sellClass ? s.sellClass.replace(/_/g, " ").toLowerCase() : (s.sellability ?? "—")}</span>
        <span className={chip(s.authorities)}>authorities {s.authorities ?? "—"}</span>
        <span className={chip(s.liquidityDrain)}>drain {s.liquidityDrain ?? "—"}</span>
        <span className={chip(s.deployer)}>deployer exposure {s.deployer ?? "—"}</span>
        <span className="mono">insider {s.insiderPct != null ? `${(s.insiderPct * 100).toFixed(0)}%` : "—"}</span>
      </div>
      <div className="ab-safety">
        <span className={`ab-eff ${advChip(s.advanced)}`}>ADVANCED ON-CHAIN {s.advanced}</span>
        {s.knownRisks.length ? <span className="sc-fail">known: {s.knownRisks.join(", ")}</span> : <span className="sc-ok">no known risks</span>}
        {s.unknownRisks.length ? <span className="sc-na">unknown: {s.unknownRisks.join(", ")}</span> : null}
      </div>
    </div>
  );
}

function EntryPanel({ c }: { c: BoardCandidate }) {
  const a = c.action;
  if (a.status === "ACTIONABLE_NOW") {
    return (
      <div className="ab-entry go">
        <div className="ab-entry-h">ENTRY PLAN</div>
        <ul>
          <li><b>Trigger:</b> {a.entryTrigger}</li>
          <li><b>Invalidation:</b> {a.invalidation}</li>
          <li><b>Chase:</b> {a.chaseStatus}</li>
          <li><b>Liquidity/slippage:</b> {usd(c.liquidityUsd)} pool — size accordingly</li>
        </ul>
        <div className="ab-note">Entry zone is not fabricated without confirmed range data; act on the trigger above.</div>
      </div>
    );
  }
  return (
    <div className="ab-entry wait">
      <div className="ab-entry-h">WHAT AUREUS IS WAITING FOR</div>
      <div className="ab-check">
        <div className="col"><div className="ttl">Confirmed</div>{a.waitingConfirmed.map((t, i) => <div key={i} className="ok">✓ {t}</div>)}</div>
        <div className="col"><div className="ttl">Waiting</div>{a.waitingOpen.map((t, i) => <div key={i} className="open">○ {t}</div>)}</div>
      </div>
      <div className="ab-entry-foot">
        <span><b>Trigger needed:</b> {a.entryTrigger}</span>
        <span><b>Invalidation:</b> {a.invalidation}</span>
        <span><b>Chase:</b> {a.chaseStatus}</span>
      </div>
    </div>
  );
}

function CandidateCard({ c, rank, change, now, debug, entryPlan, waiting }: { c: BoardCandidate; rank: number; change: Change; now: number; debug?: boolean; entryPlan?: boolean; waiting?: boolean }) {
  const a = c.action;
  const ms = monitorStatus(c.nextScanAt, now);
  return (
    <div className={`ab-card ${change ? "flash" : ""}`}>
      <div className="ab-card-head">
        <div className="ab-rank">#{rank}</div>
        <div className="ab-title">
          <div className="token">{c.symbol ?? "Unknown"} <StatusBadge s={a.status} c={c} /> <ChangeFlag change={change} /></div>
          <div className="mono">{shortMint(c.mint)} · pool {shortMint(c.pool)}</div>
        </div>
      </div>
      <MetricGrid c={c} now={now} />
      <FamilyRow c={c} />
      <SafetyRow c={c} />
      <WatchRow c={c} />
      <div className="ab-lines">
        <div><span className="lbl">Blocker</span> {a.blocker}</div>
        <div><span className="lbl">Missing</span> {missingText(c)}</div>
        <div><span className="lbl">Why ranked here</span> {a.rankingReasons.join(" · ")}</div>
        {a.risks.length ? <div><span className="lbl">Risks</span> {a.risks.join(" · ")}</div> : null}
      </div>
      {(entryPlan || waiting) ? (c.watch ? <WatchPlan c={c} /> : <EntryPanel c={c} />) : null}
      {debug ? <RankBreakdown c={c} /> : null}
      <div className="ab-card-foot">
        <span className="mono">last scan {c.lastScanAt ? ago(c.lastScanAt, now) + " ago" : "—"} · <b className={ms.cls}>{ms.label}</b></span>
        <span className="ab-actions">
          <Link className="btn xs primary" href={`/candidate/${c.id}`}>Open</Link>
          <a className="btn xs" href={dexUrl(c.mint, c.pool)} target="_blank" rel="noreferrer">Dex ↗</a>
        </span>
      </div>
    </div>
  );
}

function missingText(c: BoardCandidate): string {
  const risks = c.action.risks.find((r) => r.startsWith("UNKNOWN RISK"));
  return risks ? risks.replace("UNKNOWN RISK — missing on-chain: ", "") + " (UNKNOWN RISK)" : "none";
}

function BestCard({ c, change, now, debug }: { c: BoardCandidate; change: Change; now: number; debug?: boolean }) {
  const a = c.action;
  const ms = monitorStatus(c.nextScanAt, now);
  return (
    <div className={`ab-best ${change ? "flash" : ""}`}>
      <div className="ab-best-head">
        <div>
          <div className="ab-best-kicker">BEST CURRENT CANDIDATE</div>
          <div className="ab-best-token">{c.symbol ?? "Unknown"} <StatusBadge s={a.status} c={c} /> <ChangeFlag change={change} /></div>
          <div className="mono">{shortMint(c.mint)} · pool {shortMint(c.pool)}</div>
        </div>
        <div className="ab-best-price">{usd(c.priceUsd)}<span className="mono"> {fmtPct(a.priceChange.m30)}/30m</span></div>
      </div>
      <MetricGrid c={c} now={now} />
      <FamilyRow c={c} />
      <SafetyRow c={c} />
      <WatchRow c={c} />
      <div className="ab-best-grid">
        <div><div className="ttl">Why it leads</div><ul>{a.rankingReasons.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
        <div><div className="ttl">Positives</div><ul>{a.positives.length ? a.positives.map((r, i) => <li key={i}>{r}</li>) : <li>—</li>}</ul></div>
        <div><div className="ttl">Risks</div><ul>{a.risks.length ? a.risks.map((r, i) => <li key={i}>{r}</li>) : <li>—</li>}</ul></div>
      </div>
      <div className="ab-best-verdict">
        <b>Buyable?</b> {a.status === "ACTIONABLE_NOW" ? "Yes — trigger + safety confirmed." : `Not yet — ${a.blocker}.`}
      </div>
      {c.watch ? <WatchPlan c={c} /> : <EntryPanel c={c} />}
      {debug ? <RankBreakdown c={c} /> : null}
      <div className="ab-card-foot">
        <span className="mono">tier {c.monitoringTier} · last scan {c.lastScanAt ? ago(c.lastScanAt, now) + " ago" : "—"} · <b className={ms.cls}>{ms.label}</b></span>
        <span className="ab-actions">
          <Link className="btn xs primary" href={`/candidate/${c.id}`}>Open candidate</Link>
          <a className="btn xs" href={dexUrl(c.mint, c.pool)} target="_blank" rel="noreferrer">Dex Screener ↗</a>
        </span>
      </div>
    </div>
  );
}
