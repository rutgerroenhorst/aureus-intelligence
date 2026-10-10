"use client";
import { useMemo, useState } from "react";
import { MarketStrip } from "@/components/MarketStrip";

export interface Graduate {
  mint: string;
  symbol: string | null;
  name: string | null;
  ageMin: number;
  createToMigrateMin: number | null;
  devBuySol: number | null;
  mayhem: boolean;
  creatorLaunches: number | null;
  mcap: number | null;
  liq: number | null;
  change1h: number | null;
  change5m: number | null;
  sinceFirst: number | null;
  buys1h: number | null;
  sells1h: number | null;
  readingAgeMin: number | null;
  flags: string[];
}

const usd = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "-";
  const a = Math.abs(v);
  return a >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${v.toFixed(0)}`;
};
const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "-" : `${v >= 0 ? "+" : "−"}${Math.abs(v) >= 100 ? Math.abs(v).toFixed(0) : Math.abs(v).toFixed(1)}%`);
const col = (v: number | null | undefined) => (v == null ? "#ececf4" : v >= 0 ? "#34c759" : "#ff453a");
const age = (m: number) => (m < 90 ? `${Math.round(m)} min` : m < 2880 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} d`);

type SortKey = "new" | "big" | "up";

export function GraduatesTab({ coins, lab }: { coins: Graduate[]; lab: { followed3d: number; held2: { p: number } } | null }) {
  const [sort, setSort] = useState<SortKey>("new");
  const list = useMemo(() => {
    const l = [...coins];
    if (sort === "big") l.sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0));
    else if (sort === "up") l.sort((a, b) => (b.sinceFirst ?? -1) - (a.sinceFirst ?? -1));
    else l.sort((a, b) => a.ageMin - b.ageMin);
    return l.slice(0, 60);
  }, [coins, sort]);
  return (
    <div style={{ padding: 16 }}>
      <MarketStrip />
      <h3 style={{ color: "#ff9f0a", marginBottom: 8 }}>🎓 Graduations ({coins.length} in 24 h)</h3>
      <div style={{ fontSize: 12, color: "#b4b4c6", marginBottom: 6, lineHeight: 1.5 }}>
        Coins that just graduated from pump.fun to PumpSwap, straight from pump.fun's own event stream, from their first minute. The Radar's door waits an hour on purpose (the first hour has ten times the downside); this tab shows what happens in that hour so you can see it for yourself. HOTBOT was worth about $550K an hour after it graduated.
      </div>
      <div style={{ fontSize: 12, color: "#ff9f0a", marginBottom: 12, lineHeight: 1.5 }}>
        Most coins give everything back in the first hour. {lab ? `The lab has followed ${lab.followed3d} graduations for 3 days so far: ${Math.round(lab.held2.p * 100)}% held 2x from the moment it first saw them.` : "The lab is following every graduation for days; its first numbers appear after three days."} Not advice.
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {([["new", "Newest"], ["big", "Biggest"], ["up", "Most up since first seen"]] as Array<[SortKey, string]>).map(([k, label]) => (
          <button key={k} onClick={() => setSort(k)} style={{ padding: "5px 10px", fontSize: 12, borderRadius: 6, cursor: "pointer", background: sort === k ? "#2a2a3e" : "#1a1a1f", color: sort === k ? "#fff" : "#8a8a8e", border: `1px solid ${sort === k ? "#4a4a66" : "#2a2a2f"}` }}>{label}</button>
        ))}
      </div>
      {list.length === 0 ? (
        <div style={{ textAlign: "center", color: "#8a8a8e", padding: 32 }}>
          No graduations recorded. They come from pump.fun's event stream, which needs the laptop worker (<code>pnpm worker:start</code>) or <code>scripts/lab-daemon.ts</code> running; the hosted site cannot hold that connection open.
        </div>
      ) : (
        list.map((c) => (
          <div key={c.mint} style={{ background: "#141418", border: "1px solid #2a2a2f", borderRadius: 8, padding: 12, marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div>
                <b style={{ color: "#fff", fontSize: 15 }}>{c.symbol ?? "?"}</b> <span style={{ color: "#8a8a8e", fontSize: 12 }}>{c.name}</span>
                <div style={{ fontSize: 11, color: "#8a8a8e", marginTop: 2 }}>graduated {age(c.ageMin)} ago{c.createToMigrateMin != null ? ` · ${c.createToMigrateMin < 90 ? `${Math.round(c.createToMigrateMin)} min` : `${(c.createToMigrateMin / 60).toFixed(1)} h`} after launch` : ""}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "#fff", fontWeight: 700 }}>{usd(c.mcap)}</div>
                <div style={{ fontSize: 11, color: "#8a8a8e" }}>liquidity {usd(c.liq)}</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 8, marginTop: 10, fontSize: 12 }}>
              <Cell label="Since first seen" value={c.sinceFirst == null ? "-" : `${c.sinceFirst.toFixed(2)}x`} color={c.sinceFirst == null ? undefined : c.sinceFirst >= 1 ? "#34c759" : "#ff453a"} />
              <Cell label="Last hour" value={pct(c.change1h)} color={col(c.change1h)} />
              <Cell label="Last 5 min" value={pct(c.change5m)} color={col(c.change5m)} />
              <Cell label="Buys / sells, 1 h" value={c.buys1h != null && c.sells1h != null ? `${Math.round(c.buys1h)} / ${Math.round(c.sells1h)}` : "-"} />
              <Cell label="Creator's first buy" value={c.devBuySol == null ? "-" : `${c.devBuySol.toFixed(2)} SOL`} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 8, flexWrap: "wrap" }}>
              <div>
                {c.flags.map((f) => (
                  <span key={f} style={{ display: "inline-block", fontSize: 11, padding: "1px 7px", marginRight: 4, borderRadius: 6, border: "1px solid #2a2a2f", color: /down|serial|within 2|no longer|Mayhem/.test(f) ? "#ff9f0a" : "#b4b4c6" }}>{f}</span>
                ))}
              </div>
              <a href={`/coin/${c.mint}`} style={{ color: "#30b0c0", fontSize: 12, fontWeight: 600, textDecoration: "none" }}>Dossier →</a>
            </div>
          </div>
        ))
      )}
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
