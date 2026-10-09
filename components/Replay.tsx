"use client";
import { useEffect, useMemo, useState } from "react";
import type { ReplayData } from "../lib/queries";

/** Playable lifecycle timeline: scrub/play through price + events from discovery. */
export function Replay({ data }: { data: ReplayData }) {
  const steps = useMemo(() => {
    // Merge price points + events onto one ordered timeline of instants.
    const set = new Set<number>();
    for (const p of data.prices) set.add(p.atMs);
    for (const e of data.events) set.add(e.atMs);
    return [...set].sort((a, b) => a - b);
  }, [data]);

  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    if (i >= steps.length - 1) { setPlaying(false); return; }
    const t = setTimeout(() => setI((x) => Math.min(steps.length - 1, x + 1)), 350);
    return () => clearTimeout(t);
  }, [playing, i, steps.length]);

  if (steps.length === 0) return <div className="mono" style={{ color: "var(--muted-2)" }}>no timeline data yet</div>;

  const cursorMs = steps[Math.min(i, steps.length - 1)]!;
  const anchor = data.prices[0]?.price ?? null;
  const priceAt = [...data.prices].filter((p) => p.atMs <= cursorMs).pop() ?? data.prices[0] ?? null;
  const ret = anchor && priceAt ? priceAt.price / anchor - 1 : null;
  const stateNow = [...data.events].filter((e) => e.type === "state" && e.atMs <= cursorMs).pop();
  const shownEvents = data.events.filter((e) => e.atMs <= cursorMs);

  // Sparkline
  const prices = data.prices;
  const W = 640, H = 90;
  const minP = Math.min(...prices.map((p) => p.price));
  const maxP = Math.max(...prices.map((p) => p.price));
  const t0 = prices[0]?.atMs ?? 0, t1 = prices[prices.length - 1]?.atMs ?? 1;
  const x = (ms: number) => t1 === t0 ? 0 : ((ms - t0) / (t1 - t0)) * W;
  const y = (p: number) => maxP === minP ? H / 2 : H - ((p - minP) / (maxP - minP)) * H;
  const path = prices.map((p, k) => `${k === 0 ? "M" : "L"}${x(p.atMs).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
  const cursorX = x(cursorMs);
  const rel = (ms: number) => { const s = Math.round((ms - data.discoveredAtMs) / 1000); if (s < 60) return `${s}s`; const m = Math.round(s / 60); return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`; };

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
        <button className="btn primary" onClick={() => (i >= steps.length - 1 ? (setI(0), setPlaying(true)) : setPlaying(!playing))}>
          {playing ? "⏸ pause" : i >= steps.length - 1 ? "↻ replay" : "▶ play"}
        </button>
        <button className="btn" onClick={() => { setPlaying(false); setI(0); }}>⏮ reset</button>
        <input type="range" min={0} max={steps.length - 1} value={i} onChange={(e) => { setPlaying(false); setI(Number(e.target.value)); }} style={{ flex: 1 }} />
        <span className="mono" style={{ minWidth: 60 }}>+{rel(cursorMs)}</span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 90, background: "var(--panel-2)", borderRadius: 8, border: "1px solid var(--border)" }}>
        <path d={path} fill="none" stroke="var(--gold-dim)" strokeWidth={1.5} />
        <line x1={cursorX} y1={0} x2={cursorX} y2={H} stroke="var(--gold)" strokeWidth={1} />
        {priceAt ? <circle cx={cursorX} cy={y(priceAt.price)} r={3} fill="var(--gold)" /> : null}
      </svg>

      <div className="readiness-grid" style={{ marginTop: 10 }}>
        <div><div className="lab">Time from discovery</div><div className="val mono">+{rel(cursorMs)}</div></div>
        <div><div className="lab">Price</div><div className="val mono">{priceAt ? `$${priceAt.price.toPrecision(4)}` : "—"}</div></div>
        <div><div className="lab">Return</div><div className="val mono" style={{ color: (ret ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>{ret != null ? `${ret >= 0 ? "+" : ""}${(ret * 100).toFixed(1)}%` : "—"}</div></div>
        <div><div className="lab">State</div><div className="val mono">{stateNow ? stateNow.label.split(":")[0] : "—"}</div></div>
      </div>

      <ul className="timeline" style={{ marginTop: 10, maxHeight: 180, overflowY: "auto" }}>
        {shownEvents.slice().reverse().map((e, k) => (
          <li key={k}><span className="tt">+{rel(e.atMs)}</span><span className="ty">{e.type}</span><span>{e.label}</span></li>
        ))}
      </ul>
    </div>
  );
}
