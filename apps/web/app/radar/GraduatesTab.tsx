"use client";
import { useMemo, useState } from "react";

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
const age = (m: number) => (m < 90 ? `${Math.round(m)} min` : m < 2880 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} d`);

type SortKey = "new" | "big" | "up";

const btn: React.CSSProperties = { padding: "6px 12px", background: "#1a1a1f", color: "#34c759", border: "1px solid #34c759", borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", textDecoration: "none" };
const chip = (on: boolean): React.CSSProperties => ({ padding: "5px 10px", fontSize: 12, borderRadius: 6, cursor: "pointer", background: on ? "#2a2a3e" : "#1a1a1f", color: on ? "#fff" : "#8a8a8e", border: `1px solid ${on ? "#4a4a66" : "#2a2a2f"}` });

/** The warnings worth a place on the card: a pool that is gone or never was, the kinds measured to end in a drain, and heavy concentration. */
const SHOW = /drained|empty|born|Mayhem|insider networks hold ([2-9]\d|100)%|one wallet holds|within 2 minutes|down more than half|no longer listed/;

export function GraduatesTab({ coins, lab, meta, entered, failedMints, onEnter }: { coins: Graduate[]; lab: { followed3d: number; held2: { p: number } } | null; meta?: GradMeta | null; entered: Set<string>; failedMints: Set<string>; onEnter: (c: Graduate) => void }) {
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
  const hiddenText = [hidden.born && `${hidden.born} born graduated`, hidden.mayhem && `${hidden.mayhem} Mayhem Mode`, hidden.empty && `${hidden.empty} empty pools`, hidden.drained && `${hidden.drained} drained`, hidden.small && `${hidden.small} pools under $5K`, hidden.gone && `${hidden.gone} no longer listed`, hidden.waiting && `${hidden.waiting} without a reading yet`].filter(Boolean).join(", ");
  return (
    <div style={{ padding: 16 }}>
      <h3 style={{ color: "#ff9f0a", marginBottom: 6 }}>🎓 Graduations ({coins.length - hidden.total} worth a look)</h3>
      <div style={{ fontSize: 12, color: "#b4b4c6", marginBottom: 8, lineHeight: 1.5 }}>
        Coins that just graduated from pump.fun, from their first minute. Most give everything back in the first hour: only the ones with a real, standing pool are shown.
        {snapAge != null && <span style={{ color: snapAge > 30 ? "#ff9f0a" : "#8a8a8e" }}> Laptop snapshot, {snapAge < 90 ? `${snapAge} min` : `${(snapAge / 60).toFixed(1)} h`} old{snapAge > 30 ? " (its stream may be off)" : ""}.</span>}
      </div>
      <details style={{ marginBottom: 10, fontSize: 12, color: "#8a8a8e", lineHeight: 1.5 }}>
        <summary style={{ cursor: "pointer", color: "#30b0c0" }}>Why are some coins hidden, and how graduations end</summary>
        <div style={{ marginTop: 6 }}>
          The Radar's door waits an hour on purpose (the first hour has ten times the downside); this tab shows that hour. {lab ? `The lab has followed ${lab.followed3d} graduations for 3 days: ${Math.round(lab.held2.p * 100)}% held 2x from the moment it first saw them.` : "The lab is following every graduation for days; its first numbers appear after three days."}
          {meta && meta.summary.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {meta.summary.map((k) => (
                <div key={k.kind} style={{ padding: "6px 0", borderTop: "1px solid #202026" }}>
                  <b style={{ color: k.kind === "born" || k.kind === "mayhem" ? "#ff9f0a" : "#ececf4" }}>{KIND[k.kind]?.title ?? k.kind}</b> <span>({k.n} coins, last 72 h)</span>
                  <div>
                    {k.empty > 0 && <>{k.empty} of {k.n} had a pool under $1,000 from the start. </>}
                    {k.realPools > 0 && <>{k.drained} of {k.realPools} real pools were drained so far. </>}
                    {k.judged1h > 0 && <>At about one hour: {k.drained1h} of {k.judged1h} drained, {k.halved1h} down by half or more, {k.above1h} above their first price. </>}
                  </div>
                  <div style={{ color: "#6a6a72" }}>{KIND[k.kind]?.about}</div>
                </div>
              ))}
              <div style={{ marginTop: 4, color: "#6a6a72" }}>"Drained" = the pool held at least $10K and later fell under 10% of that and under $5K. Descriptive, not a prediction.</div>
            </div>
          )}
        </div>
      </details>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        {judged && (
          <>
            <button onClick={() => setShowAll(false)} style={chip(!showAll)}>Worth a look ({coins.length - hidden.total})</button>
            <button onClick={() => setShowAll(true)} style={chip(showAll)}>Everything ({coins.length})</button>
            <span style={{ width: 8 }} />
          </>
        )}
        {([["new", "Newest"], ["big", "Biggest"], ["up", "Most up"]] as Array<[SortKey, string]>).map(([k, label]) => (
          <button key={k} onClick={() => setSort(k)} style={chip(sort === k)}>{label}</button>
        ))}
      </div>
      {judged && !showAll && hidden.total > 0 && <div style={{ fontSize: 11, color: "#8a8a8e", marginBottom: 10 }}>Hidden: {hiddenText}.</div>}
      {list.length === 0 ? (
        <div style={{ textAlign: "center", color: "#8a8a8e", padding: 32 }}>
          {coins.length > 0 && !showAll ? "Nothing worth a look right now: every recent graduation is one of the kinds above." : <>No graduations recorded. They come from pump.fun's event stream, which needs the laptop worker (<code>pnpm worker:start</code>) or <code>scripts/lab-daemon.ts</code> running; the hosted site shows the laptop's last snapshot.</>}
        </div>
      ) : (
        list.map((c) => {
          const warn = c.flags.filter((f) => SHOW.test(f)).slice(0, 3);
          const isEntered = entered.has(c.mint);
          const failed = failedMints.has(c.mint);
          return (
            <div key={c.mint} style={{ background: "#141418", border: "1px solid #2a2a2f", borderRadius: 8, padding: 12, marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <b style={{ color: "#fff", fontSize: 15 }}>{c.symbol ?? "?"}</b> <span style={{ color: "#8a8a8e", fontSize: 12 }}>{c.name}</span>
                  <div style={{ fontSize: 12, color: "#b4b4c6", marginTop: 3 }}>
                    graduated {age(c.ageMin)} ago
                    {c.sinceFirst != null && <> · <span style={{ color: c.sinceFirst >= 1 ? "#34c759" : "#ff453a" }}>{c.sinceFirst.toFixed(2)}x</span> since first seen</>}
                  </div>
                  {warn.length > 0 && <div style={{ fontSize: 11, color: "#ff9f0a", marginTop: 3 }}>⚠ {warn.join(" · ")}</div>}
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ color: "#fff", fontWeight: 700 }}>{usd(c.mcap)}</div>
                  <div style={{ fontSize: 11, color: "#8a8a8e" }}>liquidity {usd(c.liq)}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button onClick={() => onEnter(c)} disabled={isEntered} style={{ ...btn, background: isEntered ? "#34c759" : "#1a1a1f", color: isEntered ? "#000" : failed ? "#ff9f0a" : "#34c759", borderColor: failed ? "#ff9f0a" : "#34c759" }}>
                  {isEntered ? "✅ Entered" : failed ? "⚠ Not saved" : "✔ Enter"}
                </button>
                <a href={`https://dexscreener.com/solana/${c.mint}`} target="_blank" rel="noreferrer" style={btn}>
                  DexScreener
                </a>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
