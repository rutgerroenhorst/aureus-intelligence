"use client";
import { useMemo, useState } from "react";

export interface Runner {
  mint: string;
  symbol: string | null;
  name: string | null;
  via: string;
  launchpad: string | null;
  ageDays: number | null;
  seenHoursAgo: number;
  mcap: number | null;
  liq: number | null;
  change24h: number | null;
  change1h: number | null;
  sinceFirst: number | null;
  organic: number | null;
  holders: number | null;
  traders24h: number | null;
  volume24h: number | null;
  dex: string | null;
  readingAgeMin: number;
  flags: string[];
}

export interface RunnersLab {
  coins: number;
  followed3d: number;
  held2: { p: number; k: number; n: number } | null;
  held3: number | null;
}

export interface RunnersPrior {
  decided: number;
  held2: { p: number; k: number; n: number };
  collapse24: { p: number; k: number; n: number };
  ev: number | null;
}

const usd = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "-";
  const a = Math.abs(v);
  return a >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${v.toFixed(0)}`;
};
const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "-" : `${v >= 0 ? "+" : "−"}${Math.abs(v) >= 100 ? Math.abs(v).toFixed(0) : Math.abs(v).toFixed(1)}%`);
const col = (v: number | null | undefined) => (v == null ? "#b4b4c6" : v >= 0 ? "#34c759" : "#ff453a");

type SortKey = "new" | "big" | "up";
type Kind = "all" | "lists" | "young";

const btn: React.CSSProperties = { padding: "6px 12px", background: "#1a1a1f", color: "#34c759", border: "1px solid #34c759", borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", textDecoration: "none" };

/** Only what a decision to enter needs: the coin, its size, where it stands, one warning when there is one, and the two buttons. */
function Row({ c, onEnter, entered, failed }: { c: Runner; onEnter: (c: Runner) => void; entered: boolean; failed: boolean }) {
  const age = c.ageDays == null ? null : c.ageDays < 2 ? `${Math.max(1, Math.round(c.ageDays * 24))} h` : `${c.ageDays.toFixed(0)} d`;
  const warn = c.flags.filter((f) => /fading|sellers/.test(f));
  return (
    <div style={{ background: "#141418", border: "1px solid #2a2a2f", borderRadius: 8, padding: 12, marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <b style={{ color: "#fff", fontSize: 15 }}>{c.symbol ?? "?"}</b> <span style={{ color: "#8a8a8e", fontSize: 12 }}>{c.name}</span>
          <div style={{ fontSize: 12, color: "#b4b4c6", marginTop: 3 }}>
            {age ? `${age} old · ` : ""}24 h <span style={{ color: col(c.change24h) }}>{pct(c.change24h)}</span> · last hour <span style={{ color: col(c.change1h) }}>{pct(c.change1h)}</span>
          </div>
          {warn.length > 0 && <div style={{ fontSize: 11, color: "#ff9f0a", marginTop: 3 }}>⚠ {warn.join(" · ")}</div>}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ color: "#fff", fontWeight: 700 }}>{usd(c.mcap)}</div>
          <div style={{ fontSize: 11, color: "#8a8a8e" }}>liquidity {usd(c.liq)}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={() => onEnter(c)} disabled={entered} style={{ ...btn, background: entered ? "#34c759" : "#1a1a1f", color: entered ? "#000" : failed ? "#ff9f0a" : "#34c759", borderColor: failed ? "#ff9f0a" : "#34c759" }}>
          {entered ? "✅ Entered" : failed ? "⚠ Not saved" : "✔ Enter"}
        </button>
        <a href={`https://dexscreener.com/solana/${c.mint}`} target="_blank" rel="noreferrer" style={btn}>
          DexScreener
        </a>
      </div>
    </div>
  );
}

const chip = (on: boolean): React.CSSProperties => ({ padding: "5px 10px", fontSize: 12, borderRadius: 6, cursor: "pointer", background: on ? "#2a2a3e" : "#1a1a1f", color: on ? "#fff" : "#8a8a8e", border: `1px solid ${on ? "#4a4a66" : "#2a2a2f"}` });

export function RunnersTab({ runners, lab, prior, entered, failedMints, onEnter }: { runners: Runner[]; lab: RunnersLab | null; prior: RunnersPrior | null; entered: Set<string>; failedMints: Set<string>; onEnter: (c: Runner) => void }) {
  const [sort, setSort] = useState<SortKey>("new");
  const [kind, setKind] = useState<Kind>("all");
  const nLists = runners.filter((r) => r.via !== "too_big").length;
  const list = useMemo(() => {
    const l = runners.filter((r) => kind === "all" || (kind === "lists" ? r.via !== "too_big" : r.via === "too_big"));
    if (sort === "big") l.sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0));
    else if (sort === "up") l.sort((a, b) => (b.change24h ?? -1e9) - (a.change24h ?? -1e9));
    else l.sort((a, b) => a.seenHoursAgo - b.seenHoursAgo);
    return l;
  }, [runners, sort, kind]);
  return (
    <div style={{ padding: 16 }}>
      <h3 style={{ color: "#30b0c0", marginBottom: 6 }}>🏃 Runners ({runners.length})</h3>
      <div style={{ fontSize: 12, color: "#b4b4c6", marginBottom: 8, lineHeight: 1.5 }}>
        Healthy coins that are already up and too big or too old for the other tabs (the kind HOTBOT was). Late entries: most of them give a lot back.
      </div>
      <details style={{ marginBottom: 10, fontSize: 12, color: "#8a8a8e", lineHeight: 1.5 }}>
        <summary style={{ cursor: "pointer", color: "#30b0c0" }}>More about this tab</summary>
        <div style={{ marginTop: 6 }}>
          They come from Jupiter's free lists of the most organic, most traded and trending coins and have to look healthy: $0.3M to $150M, real liquidity, thousands of holders. "Young and exploding" are hours old and past the Radar's $150K cap; the first hours are where most coins give everything back.
          {" "}The Learning Lab follows each one for a week{lab && lab.followed3d >= 8 && lab.held2 ? ` (so far ${lab.followed3d} followed for 3 days: ${Math.round(lab.held2.p * 100)}% held 2x, ${lab.held3 != null ? Math.round(lab.held3 * 100) : "-"}% held 3x)` : " (no result yet: a coin counts after 3 days)"}.
          {prior && (
            <div style={{ marginTop: 6 }}>
              For scale, from the Radar's own history: of {prior.decided} coins that crossed $300K with real liquidity, {Math.round(prior.held2.p * 100)}% held 2x within 3 days and {Math.round(prior.collapse24.p * 100)}% were worth half or less a day later.
            </div>
          )}
        </div>
      </details>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        {([["all", `All ${runners.length}`], ["lists", `Established ${nLists}`], ["young", `Young ${runners.length - nLists}`]] as Array<[Kind, string]>).map(([k, label]) => (
          <button key={k} onClick={() => setKind(k)} style={chip(kind === k)}>{label}</button>
        ))}
        <span style={{ width: 8 }} />
        {([["new", "Newest"], ["big", "Biggest"], ["up", "Strongest 24 h"]] as Array<[SortKey, string]>).map(([k, label]) => (
          <button key={k} onClick={() => setSort(k)} style={chip(sort === k)}>{label}</button>
        ))}
      </div>
      {list.length === 0 ? (
        <div style={{ textAlign: "center", color: "#8a8a8e", padding: 32 }}>No runners on the watch list yet. They appear after the next lab round (every 10 to 15 minutes while a screen is open).</div>
      ) : (
        list.map((c) => <Row key={c.mint} c={c} onEnter={onEnter} entered={entered.has(c.mint)} failed={failedMints.has(c.mint)} />)
      )}
    </div>
  );
}
