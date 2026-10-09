"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { BoardView, SectionKey } from "../../lib/boardSections";
import type { CandidateDecisionView } from "../../lib/candidateView";
import { DecisionCard, StatusPill, dur, price, pctSigned } from "../../components/DecisionCard";
import { ago, shortMint, dexUrl } from "../../lib/format";

const LADDER = ["DISCOVERED", "FUNDAMENTAL_WATCH", "SETUP_FORMING", "ENTRY_APPROACHING", "ENTRY_READY"];
type Flash = "promoted" | "downgraded" | "newly-ready" | "invalidated";

const SECTIONS: Array<{ key: SectionKey; title: string; sub: string; tone: string }> = [
  { key: "ENTRY_READY", title: "Entry Ready", sub: "Core Safety PASS + confirmed structure — concrete plan", tone: "go" },
  { key: "ENTRY_APPROACHING", title: "Entry Approaching", sub: "Most conditions met — awaiting final confirmation", tone: "near" },
  { key: "PRIMARY_WATCH", title: "Primary Fundamental Watch", sub: "Best coins to follow before an entry exists (max 5)", tone: "watch" },
  { key: "SETUP_FORMING", title: "Setup Forming", sub: "Base / range / pullback building — monitored closely", tone: "watch" },
  { key: "TOO_EXTENDED", title: "Too Extended", sub: "Strong, but beyond a disciplined entry — wait for pullback", tone: "ext" },
  { key: "SECONDARY_WATCH", title: "Secondary Watch", sub: "Interesting, further from entry or more unknowns", tone: "dim" },
  { key: "ASSESSING", title: "Nieuw gevonden", sub: "Kleine caps die nu beoordeeld worden", tone: "dim" },
  { key: "INVALID_REJECTED", title: "Invalidated / Rejected", sub: "Removed from the active shortlist", tone: "rej" },
];

export function BoardLive({ initial }: { initial: BoardView }) {
  const [board, setBoard] = useState<BoardView>(initial);
  const [flashes, setFlashes] = useState<Record<string, Flash>>({});
  const [now, setNow] = useState<number>(() => Date.parse(initial.generatedAt) || 0);
  const prev = useRef<Record<string, string>>({});

  useEffect(() => {
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const seed: Record<string, string> = {};
    for (const s of SECTIONS) for (const c of initial.sections[s.key]) seed[c.id] = c.status;
    prev.current = seed;
  }, [initial]);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/action-board", { cache: "no-store" });
        if (!res.ok) return;
        const next: BoardView = await res.json();
        if (!alive) return;
        const f: Record<string, Flash> = {};
        for (const s of SECTIONS) for (const c of next.sections[s.key]) {
          const before = prev.current[c.id];
          if (before && before !== c.status) {
            if (c.status === "ENTRY_READY") f[c.id] = "newly-ready";
            else if (c.status === "INVALIDATED" || c.status === "REJECTED") f[c.id] = "invalidated";
            else if (LADDER.indexOf(c.status) > LADDER.indexOf(before)) f[c.id] = "promoted";
            else f[c.id] = "downgraded";
          }
          prev.current[c.id] = c.status;
        }
        setBoard(next);
        if (Object.keys(f).length) {
          setFlashes((p) => ({ ...p, ...f }));
          setTimeout(() => { if (alive) setFlashes((p) => { const c = { ...p }; for (const k of Object.keys(f)) delete c[k]; return c; }); }, 14_000);
        }
      } catch { /* keep last good board */ }
    };
    const iv = setInterval(poll, 10_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const w = board.worker;
  const c = board.counts;
  const noEntry = c.entryReady === 0;

  return (
    <>
      {/* ── system bar ── */}
      <div className="sysbar">
        <span className={`dot ${w.online ? "on" : "off"}`} />
        <b>{w.online ? "LIVE" : "OFFLINE"}</b>
        <span className="sep">·</span>
        <span>Helius <b className={w.heliusMode === "LIVE" ? "good" : "warnT"}>{w.heliusMode}</b></span>
        <span className="sep">·</span>
        <span>scan {w.lastCycleAt ? ago(w.lastCycleAt, now) : "—"} ago</span>
        <span className="sep">·</span>
        <span>enrich {w.lastEnrichmentAt ? ago(w.lastEnrichmentAt, now) : "—"} ago</span>
        <span className="sep">·</span>
        <span title="Aged out, dead pool, too thin, or not a real market. Still tracked and graded — just not tradeable, so not on the board.">
          universe <b>{c.activeMonitored}</b> active
          {c.outsideUniverse > 0 ? <span className="dim"> · {c.outsideUniverse} filtered out</span> : null}
        </span>
        <span className="grow" />
        <span className="dim mono">refresh 10s</span>
      </div>

      {/* ── funnel: the pipeline at a glance ── */}
      <div className="funnel">
        <Stat n={c.entryReady} label="Entry Ready" tone="go" big />
        <Arrow />
        <Stat n={c.entryApproaching} label="Approaching" tone="near" />
        <Arrow />
        <Stat n={c.setupForming} label="Setup Forming" tone="watch" />
        <Arrow />
        <Stat n={c.fundamentalWatch} label="Fundamental Watch" tone="watch" />
        <Arrow />
        <Stat n={c.discovered} label="Discovered" tone="dim" />
        <span className="funnel-tail">
          <Stat n={c.tooExtended} label="Too Extended" tone="ext" />
          <Stat n={c.invalidated + c.rejected} label="Out" tone="rej" />
        </span>
      </div>

      {/* ── headline ── */}
      {noEntry ? (
        <div className="headline none">
          <div className="hl-main">NO VALID ENTRY RIGHT NOW</div>
          <div className="hl-sub">Nothing meets Core Safety PASS + a confirmed entry structure. Best coins to watch before entry are below.</div>
        </div>
      ) : null}

      {board.best ? (
        <section className={`best ${board.best.status === "ENTRY_READY" ? "is-ready" : "is-watch"}`}>
          <div className={`best-kicker ${board.best.status === "ENTRY_READY" ? "k-ready" : "k-watch"}`}>
            {board.best.status === "ENTRY_READY"
              ? "ENTRY READY — PLAN BELOW"
              : "TOP OF WATCHLIST · NOT AN ENTRY — DO NOT BUY THIS YET"}
          </div>
          <DecisionCard v={board.best} now={now} flash={flashes[board.best.id] ?? null} />
        </section>
      ) : (
        <div className="empty">No active candidates.</div>
      )}

      {/* ── sections ── */}
      {SECTIONS.map((s) => {
        const items = board.sections[s.key];
        return (
          <section key={s.key} className={`sec tone-${s.tone}`}>
            <div className="sec-head">
              <h2>{s.title}</h2>
              <span className="sec-count">
                {items.length}{(board.sectionTotals?.[s.key] ?? items.length) > items.length ? ` of ${board.sectionTotals[s.key]}` : ""}
              </span>
              <span className="sec-sub">{s.sub}</span>
            </div>
            {items.length === 0 ? (
              <div className="sec-empty">{s.key === "ENTRY_READY" ? "No entry-ready candidate right now." : "None."}</div>
            ) : s.key === "SECONDARY_WATCH" || s.key === "INVALID_REJECTED" ? (
              <div className="rows">
                {items.map((v) => (
                  <div key={v.id} className="row">
                    <StatusPill status={v.status} />
                    <b>{v.symbol ?? "Unknown"}</b>
                    <span className="mono dim">{shortMint(v.mint)}</span>
                    <span className="row-reason">{v.primaryBlocker}</span>
                    <span className="mono dim">Q{v.qualityRank ?? "—"}·E{v.entryRank ?? "—"}</span>
                    <Link className="btn xs" href={`/candidate/${v.id}`}>Open</Link>
                    <a className="btn xs" href={dexUrl(v.mint, v.pool)} target="_blank" rel="noreferrer">Dex ↗</a>
                  </div>
                ))}
              </div>
            ) : (
              items.map((v, i) => <DecisionCard key={v.id} v={v} rank={i + 1} now={now} flash={flashes[v.id] ?? null} />)
            )}
          </section>
        );
      })}
    </>
  );
}

function Stat({ n, label, tone, big }: { n: number; label: string; tone: string; big?: boolean }) {
  return (
    <div className={`stat ${tone} ${big ? "big" : ""} ${n === 0 ? "zero" : ""}`}>
      <div className="stat-n">{n}</div>
      <div className="stat-l">{label}</div>
    </div>
  );
}
function Arrow() { return <span className="fn-arrow">›</span>; }
