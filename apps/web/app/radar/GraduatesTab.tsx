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
  kind?: "born" | "mayhem" | "organic" | "unknown";
  healthy?: boolean;
  hiddenWhy?: "drained" | "empty" | "born" | "mayhem" | "gone" | "small" | "waiting" | null;
  empty?: boolean;
  drained?: boolean;
  peakMultiple?: number | null;
  rc?: { holders: number | null; top1: number | null; top10: number | null; insPct: number | null; ins: number | null; lp: number | null; risks: string[] } | null;
}

export interface KindSummary {
  kind: "born" | "mayhem" | "organic" | "unknown";
  n: number;
  empty: number;
  realPools: number;
  drained: number;
  judged1h: number;
  drained1h: number;
  halved1h: number;
  above1h: number;
  medianPeakMultiple: number | null;
  medianDrainMin: number | null;
}

export interface GradMeta {
  summary: KindSummary[];
  source?: "local" | "laptop";
  asOf?: string;
}

const KIND: Record<string, { title: string; about: string }> = {
  born: { title: "Born graduated", about: "The creator bought the whole bonding curve (about 85 SOL) in the launch transaction, so the coin graduated within minutes. The pool opens with real money and the price often climbs for a while; then the creator sells into it and the pool is sold dry." },
  mayhem: { title: "Mayhem Mode", about: "Launched with an AI agent trading it for 24 hours. The graduation leaves a pool holding a few dollars." },
  organic: { title: "Organic", about: "Graduated after real buyers filled the curve (creator bought less than 50 SOL or took more than two minutes)." },
  unknown: { title: "Launch not seen", about: "The event stream started after these coins were launched, so it does not know who bought what at launch." },
};

const usd = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "-";
  const a = Math.abs(v);
  return a >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${v.toFixed(0)}`;
};
const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "-" : `${v >= 0 ? "+" : "−"}${Math.abs(v) >= 100 ? Math.abs(v).toFixed(0) : Math.abs(v).toFixed(1)}%`);
const col = (v: number | null | undefined) => (v == null ? "#ececf4" : v >= 0 ? "#34c759" : "#ff453a");
const age = (m: number) => (m < 90 ? `${Math.round(m)} min` : m < 2880 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} d`);

type SortKey = "new" | "big" | "up";

export function GraduatesTab({ coins, lab, meta }: { coins: Graduate[]; lab: { followed3d: number; held2: { p: number } } | null; meta?: GradMeta | null }) {
  const [sort, setSort] = useState<SortKey>("new");
  const [showAll, setShowAll] = useState(false);
  // older snapshots (before the kinds existed) have no verdict: show everything then
  const judged = coins.some((c) => c.healthy !== undefined);
  const hidden = useMemo(() => {
    const h = { born: 0, mayhem: 0, empty: 0, drained: 0, gone: 0, small: 0, waiting: 0, total: 0 };
    for (const c of coins) {
      if (!judged || c.healthy) continue;
      h.total++;
      const why = c.hiddenWhy ?? (c.drained ? "drained" : c.empty ? "empty" : c.kind === "born" ? "born" : c.kind === "mayhem" ? "mayhem" : "small");
      h[why]++;
    }
    return h;
  }, [coins, judged]);
  const list = useMemo(() => {
    const l = coins.filter((c) => showAll || !judged || c.healthy);
    if (sort === "big") l.sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0));
    else if (sort === "up") l.sort((a, b) => (b.sinceFirst ?? -1) - (a.sinceFirst ?? -1));
    else l.sort((a, b) => a.ageMin - b.ageMin);
    return l.slice(0, 60);
  }, [coins, sort, showAll, judged]);
  const snapAge = meta?.source === "laptop" && meta.asOf ? Math.max(0, Math.round((Date.now() - new Date(meta.asOf).getTime()) / 60_000)) : null;
  return (
    <div style={{ padding: 16 }}>
      <MarketStrip />
      <h3 style={{ color: "#ff9f0a", marginBottom: 8 }}>🎓 Graduations ({coins.length} in 72 h)</h3>
      <div style={{ fontSize: 12, color: "#b4b4c6", marginBottom: 6, lineHeight: 1.5 }}>
        Coins that just graduated from pump.fun to PumpSwap, straight from pump.fun's own event stream, from their first minute. The Radar's door waits an hour on purpose (the first hour has ten times the downside); this tab shows what happens in that hour so you can see it for yourself. HOTBOT was worth about $550K an hour after it graduated.
      </div>
      <div style={{ fontSize: 12, color: "#ff9f0a", marginBottom: 12, lineHeight: 1.5 }}>
        Most coins give everything back in the first hour. {lab ? `The lab has followed ${lab.followed3d} graduations for 3 days so far: ${Math.round(lab.held2.p * 100)}% held 2x from the moment it first saw them.` : "The lab is following every graduation for days; its first numbers appear after three days."} Not advice.
      </div>
      {snapAge != null && (
        <div style={{ fontSize: 12, color: snapAge > 30 ? "#ff9f0a" : "#8a8a8e", marginBottom: 10 }}>
          Snapshot from the laptop, {snapAge < 90 ? `${snapAge} min` : `${(snapAge / 60).toFixed(1)} h`} old.{snapAge > 30 ? " The laptop's stream may be off, so newer graduations are missing." : ""}
        </div>
      )}
      {meta && meta.summary.length > 0 && (
        <div style={{ background: "#141418", border: "1px solid #2a2a2f", borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>How graduations end (last 72 hours, the lab's own readings)</div>
          <div style={{ fontSize: 11.5, color: "#8a8a8e", marginBottom: 8, lineHeight: 1.5 }}>
            "Drained" means the pool held at least $10K and later fell under 10% of that and under $5K. One-hour figures use a reading taken 55-100 minutes after graduation. Descriptive, not a prediction.
          </div>
          {meta.summary.map((k) => {
            const real = k.realPools;
            return (
              <div key={k.kind} style={{ padding: "8px 0", borderTop: "1px solid #202026" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <b style={{ color: k.kind === "born" || k.kind === "mayhem" ? "#ff9f0a" : "#ececf4", fontSize: 13 }}>{KIND[k.kind]?.title ?? k.kind}</b>
                  <span style={{ color: "#8a8a8e", fontSize: 12 }}>{k.n} coins</span>
                </div>
                <div style={{ fontSize: 12, color: "#b4b4c6", marginTop: 2, lineHeight: 1.5 }}>
                  {k.empty > 0 && <>{k.empty} of {k.n} had a pool under $1,000 from the start. </>}
                  {real > 0 && <>{k.drained} of {real} real pools were drained so far{k.medianDrainMin != null ? ` (median ${Math.round(k.medianDrainMin)} min after graduating)` : ""}. </>}
                  {k.judged1h > 0 && <>At about one hour: {k.drained1h} of {k.judged1h} drained, {k.halved1h} down by half or more, {k.above1h} still above their first price. </>}
                  {k.medianPeakMultiple != null && <>Median highest price: {k.medianPeakMultiple.toFixed(2)}x the first reading.</>}
                </div>
                <div style={{ fontSize: 11, color: "#6a6a72", marginTop: 2 }}>{KIND[k.kind]?.about}</div>
              </div>
            );
          })}
        </div>
      )}
      {judged && (
        <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
          <button onClick={() => setShowAll(false)} style={{ padding: "5px 10px", fontSize: 12, borderRadius: 6, cursor: "pointer", background: !showAll ? "#2a2a3e" : "#1a1a1f", color: !showAll ? "#fff" : "#8a8a8e", border: `1px solid ${!showAll ? "#4a4a66" : "#2a2a2f"}` }}>Worth a look ({coins.length - hidden.total})</button>
          <button onClick={() => setShowAll(true)} style={{ padding: "5px 10px", fontSize: 12, borderRadius: 6, cursor: "pointer", background: showAll ? "#2a2a3e" : "#1a1a1f", color: showAll ? "#fff" : "#8a8a8e", border: `1px solid ${showAll ? "#4a4a66" : "#2a2a2f"}` }}>Everything ({coins.length})</button>
          {!showAll && hidden.total > 0 && (
            <span style={{ color: "#8a8a8e" }}>
              Hidden: {[hidden.born && `${hidden.born} born graduated`, hidden.mayhem && `${hidden.mayhem} Mayhem Mode`, hidden.empty && `${hidden.empty} empty pools`, hidden.drained && `${hidden.drained} drained`, hidden.small && `${hidden.small} pools under $5K`, hidden.gone && `${hidden.gone} no longer listed`, hidden.waiting && `${hidden.waiting} without a reading yet`].filter(Boolean).join(", ")}
            </span>
          )}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {([["new", "Newest"], ["big", "Biggest"], ["up", "Most up since first seen"]] as Array<[SortKey, string]>).map(([k, label]) => (
          <button key={k} onClick={() => setSort(k)} style={{ padding: "5px 10px", fontSize: 12, borderRadius: 6, cursor: "pointer", background: sort === k ? "#2a2a3e" : "#1a1a1f", color: sort === k ? "#fff" : "#8a8a8e", border: `1px solid ${sort === k ? "#4a4a66" : "#2a2a2f"}` }}>{label}</button>
        ))}
      </div>
      {list.length === 0 ? (
        <div style={{ textAlign: "center", color: "#8a8a8e", padding: 32 }}>
          {coins.length > 0 && !showAll ? "Nothing worth a look right now: every recent graduation is one of the kinds above." : <>No graduations recorded. They come from pump.fun's event stream, which needs the laptop worker (<code>pnpm worker:start</code>) or <code>scripts/lab-daemon.ts</code> running; the hosted site shows the laptop's last snapshot.</>}
        </div>
      ) : (
        list.map((c) => (
          <div key={c.mint} style={{ background: "#141418", border: "1px solid #2a2a2f", borderRadius: 8, padding: 12, marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div>
                <b style={{ color: "#fff", fontSize: 15 }}>{c.symbol ?? "?"}</b> <span style={{ color: "#8a8a8e", fontSize: 12 }}>{c.name}</span>
                <div style={{ fontSize: 11, color: "#8a8a8e", marginTop: 2 }}>{c.kind && c.kind !== "organic" ? <span style={{ color: c.kind === "unknown" ? "#8a8a8e" : "#ff9f0a" }}>{KIND[c.kind]?.title} · </span> : null}graduated {age(c.ageMin)} ago{c.createToMigrateMin != null ? ` · ${c.createToMigrateMin < 90 ? `${Math.round(c.createToMigrateMin)} min` : `${(c.createToMigrateMin / 60).toFixed(1)} h`} after launch` : ""}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "#fff", fontWeight: 700 }}>{usd(c.mcap)}</div>
                <div style={{ fontSize: 11, color: "#8a8a8e" }}>liquidity {usd(c.liq)}</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 8, marginTop: 10, fontSize: 12 }}>
              <Cell label="Since first seen" value={c.sinceFirst == null ? "-" : `${c.sinceFirst.toFixed(2)}x`} color={c.sinceFirst == null ? undefined : c.sinceFirst >= 1 ? "#34c759" : "#ff453a"} />
              <Cell label="Highest since" value={c.peakMultiple == null ? "-" : `${c.peakMultiple.toFixed(2)}x`} />
              <Cell label="Last hour" value={pct(c.change1h)} color={col(c.change1h)} />
              <Cell label="Last 5 min" value={pct(c.change5m)} color={col(c.change5m)} />
              <Cell label="Buys / sells, 1 h" value={c.buys1h != null && c.sells1h != null ? `${Math.round(c.buys1h)} / ${Math.round(c.sells1h)}` : "-"} />
              <Cell label="Creator's first buy" value={c.devBuySol == null ? "-" : `${c.devBuySol.toFixed(2)} SOL`} />
              {c.rc && <Cell label="Holders (RugCheck)" value={c.rc.holders == null ? "-" : c.rc.holders.toLocaleString("en-US")} />}
              {c.rc && <Cell label="Largest wallet" value={c.rc.top1 == null ? "-" : `${(c.rc.top1 * 100).toFixed(1)}%`} color={c.rc.top1 != null && c.rc.top1 >= 0.2 ? "#ff9f0a" : undefined} />}
              {c.rc && <Cell label="Insider networks" value={c.rc.insPct == null ? "-" : `${(c.rc.insPct * 100).toFixed(c.rc.insPct < 0.1 ? 1 : 0)}%`} color={c.rc.insPct != null && c.rc.insPct >= 0.05 ? "#ff9f0a" : undefined} />}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 8, flexWrap: "wrap" }}>
              <div>
                {c.flags.map((f) => (
                  <span key={f} style={{ display: "inline-block", fontSize: 11, padding: "1px 7px", marginRight: 4, borderRadius: 6, border: "1px solid #2a2a2f", color: /down|serial|within 2|no longer|Mayhem|drained|empty|born|insider|one wallet|not locked/.test(f) ? "#ff9f0a" : "#b4b4c6" }}>{f}</span>
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
