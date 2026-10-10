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

const usd = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "-";
  const a = Math.abs(v);
  return a >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${v.toFixed(0)}`;
};
const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "-" : `${v >= 0 ? "+" : ""}${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)}%`);
const VIA: Record<string, string> = {
  jupiter_organic: "found on Jupiter's organic list",
  jupiter_traded: "found on Jupiter's most-traded list",
  jupiter_trending: "found on Jupiter's trending list",
  too_big: "turned away by the door (worth more than its $150K cap)",
};

type SortKey = "new" | "big" | "up";
type Kind = "all" | "lists" | "young";

function Row({ c, onEnter, entered, failed }: { c: Runner; onEnter: (c: Runner) => void; entered: boolean; failed: boolean }) {
  const age = c.ageDays == null ? "-" : c.ageDays < 2 ? `${Math.round(c.ageDays * 24)} h` : `${c.ageDays.toFixed(0)} d`;
  return (
    <div style={{ background: "#141418", border: "1px solid #2a2a2f", borderRadius: 8, padding: 12, marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <b style={{ color: "#fff", fontSize: 15 }}>{c.symbol ?? "?"}</b> <span style={{ color: "#8a8a8e", fontSize: 12 }}>{c.name}</span>
          <div style={{ fontSize: 11, color: "#8a8a8e", marginTop: 2 }}>
            {VIA[c.via] ?? c.via}, {c.seenHoursAgo < 1 ? "just now" : c.seenHoursAgo < 48 ? `${Math.round(c.seenHoursAgo)} h ago` : `${Math.round(c.seenHoursAgo / 24)} d ago`}
            {c.launchpad ? ` · ${c.launchpad}` : ""}
            {c.dex ? ` · ${c.dex}` : ""}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: "#fff", fontWeight: 700 }}>{usd(c.mcap)}</div>
          <div style={{ fontSize: 11, color: "#8a8a8e" }}>liquidity {usd(c.liq)}</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 8, marginTop: 10, fontSize: 12 }}>
        <Cell label="Age" value={age} />
        <Cell label="24 h" value={pct(c.change24h)} color={c.change24h == null ? undefined : c.change24h >= 0 ? "#34c759" : "#ff453a"} />
        <Cell label="Last hour" value={pct(c.change1h)} color={c.change1h == null ? undefined : c.change1h >= 0 ? "#34c759" : "#ff453a"} />
        <Cell label="Since first seen" value={c.sinceFirst == null ? "-" : `${c.sinceFirst.toFixed(2)}x`} />
        <Cell label="Holders" value={c.holders == null ? "-" : Math.round(c.holders).toLocaleString("en-US")} />
        <Cell label="Traders, 24 h" value={c.traders24h == null ? "-" : Math.round(c.traders24h).toLocaleString("en-US")} />
        <Cell label="Organic score" value={c.organic == null ? "-" : String(Math.round(c.organic))} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 8, flexWrap: "wrap" }}>
        <div>
          {c.flags.map((f) => (
            <span key={f} style={{ display: "inline-block", fontSize: 11, padding: "1px 7px", marginRight: 4, borderRadius: 6, border: "1px solid #2a2a2f", color: /fading|sellers/.test(f) ? "#ff9f0a" : "#b4b4c6" }}>{f}</span>
          ))}
        </div>
        <button
          onClick={() => onEnter(c)}
          disabled={entered}
          style={{ background: entered ? "#1a1a1f" : "#34c759", color: entered ? "#8a8a8e" : "#000", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: entered ? "default" : "pointer" }}
        >
          {entered ? "Entered" : failed ? "Not saved - retry" : "I entered this"}
        </button>
      </div>
    </div>
  );
}

function Cell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ color: "#8a8a8e", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ color: color ?? "#ececf4", fontWeight: 600 }}>{value}</div>
    </div>
  );
}

export function RunnersTab({ runners, lab, entered, failedMints, onEnter }: { runners: Runner[]; lab: RunnersLab | null; entered: Set<string>; failedMints: Set<string>; onEnter: (c: Runner) => void }) {
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
      <h3 style={{ color: "#30b0c0", marginBottom: 8 }}>🏃 Runners ({runners.length})</h3>
      <div style={{ fontSize: 12, color: "#b4b4c6", marginBottom: 6, lineHeight: 1.5 }}>
        Coins the other tabs never show because they are older or bigger than the Radar's door allows ($150K, an hour old). They come from Jupiter's free lists of the most organic, most traded and trending coins and have to look healthy: $0.3M to $150M, real liquidity, thousands of holders. HOTBOT was exactly this kind of coin.
      </div>
      <div style={{ fontSize: 12, color: "#ff9f0a", marginBottom: 12, lineHeight: 1.5 }}>
        These coins are already up. The Learning Lab follows each one for a week and is measuring how often they keep going{" "}
        {lab && lab.followed3d >= 8 && lab.held2
          ? `(so far ${lab.followed3d} runners followed for 3 days: ${Math.round(lab.held2.p * 100)}% held 2x, ${lab.held3 != null ? Math.round(lab.held3 * 100) : "-"}% held 3x).`
          : "(no result yet: a runner has to be followed for 3 days before it counts, so the first numbers appear in about three days)."}{" "}
        Not advice.
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        {([["all", `All ${runners.length}`], ["lists", `Healthy and established ${nLists}`], ["young", `Young and exploding ${runners.length - nLists}`]] as Array<[Kind, string]>).map(([k, label]) => (
          <button key={k} onClick={() => setKind(k)} style={{ padding: "5px 10px", fontSize: 12, borderRadius: 6, cursor: "pointer", background: kind === k ? "#2a2a3e" : "#1a1a1f", color: kind === k ? "#fff" : "#8a8a8e", border: `1px solid ${kind === k ? "#4a4a66" : "#2a2a2f"}` }}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "#8a8a8e", marginBottom: 8 }}>
        Healthy and established: on Jupiter's lists, days or weeks old, thousands of holders (HOTBOT at $4.6M was this kind). Young and exploding: hours old and already past the door's cap; the first hours are where most coins give everything back (the Radar's own first-hour rule exists for that reason).
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {([["new", "Newest on the lists"], ["big", "Biggest"], ["up", "Strongest 24 h"]] as Array<[SortKey, string]>).map(([k, label]) => (
          <button key={k} onClick={() => setSort(k)} style={{ padding: "5px 10px", fontSize: 12, borderRadius: 6, cursor: "pointer", background: sort === k ? "#2a2a3e" : "#1a1a1f", color: sort === k ? "#fff" : "#8a8a8e", border: `1px solid ${sort === k ? "#4a4a66" : "#2a2a2f"}` }}>
            {label}
          </button>
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
