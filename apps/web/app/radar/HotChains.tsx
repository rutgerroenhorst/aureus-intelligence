"use client";
import { useMemo, useState } from "react";
import { dexUrl } from "@/lib/chains";
import { CheckBadge, CheckButton, CheckPanel, useCoinCheck, type CheckNote } from "./CoinCheck";
import type { HotChain, HotPool } from "@/lib/hotChains";
import { brand } from "@/lib/brand";
import { CoinName, TabIntro } from "./parts";

export interface HotClient {
  at: string;
  ageMin: number;
  chains: HotChain[];
  pools: Record<string, HotPool[]>;
  note: string;
}

const usd = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "-";
  const a = Math.abs(v);
  return a >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${v.toFixed(0)}`;
};
const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "-" : `${v >= 0 ? "+" : "−"}${Math.abs(v) >= 100 ? Math.abs(v).toFixed(0) : Math.abs(v).toFixed(1)}%`);
const col = (v: number | null | undefined) => (v == null ? "#b4b4c6" : v >= 0 ? "#34c759" : "#ff453a");
const age = (h: number | null) => (h == null ? null : h < 48 ? `${Math.max(1, Math.round(h))} h` : h < 24 * 90 ? `${Math.round(h / 24)} d` : `${(h / 24 / 365).toFixed(1)} y`);

const btn: React.CSSProperties = { padding: "6px 12px", background: "#1a1a1f", color: brand.blueText, border: `1px solid ${brand.blue}`, borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", textDecoration: "none" };
const chip = (on: boolean): React.CSSProperties => ({ padding: "5px 10px", fontSize: 12, borderRadius: 6, cursor: "pointer", background: on ? "#2a2a3e" : "#1a1a1f", color: on ? "#fff" : "#8a8a8e", border: `1px solid ${on ? "#4a4a66" : "#2a2a2f"}` });

/** New or exploding, small, with a pool that can be traded: the coins worth a look rather than the blue chips that trend every day. */
export const isNewSmall = (p: HotPool) => (p.mcap == null || p.mcap <= 300e6) && ((p.ageH ?? 1e9) <= 720 || (p.ch24 ?? 0) >= 100) && (p.liq ?? 0) >= 10_000 && (p.vol24 ?? 0) >= 10_000;

/** The networks from the hottest down, one line. Tapping one shows what is trending on it. */
export function HotChainsBar({ hot, selected, onSelect }: { hot: HotClient | null; selected: string | null; onSelect: (id: string) => void }) {
  if (!hot) return <div style={{ fontSize: 12, color: "#8a8a8e", marginBottom: 12 }}>Ranking the networks…</div>;
  const sel = hot.chains.find((c) => c.id === selected) ?? hot.chains[0];
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, scrollbarWidth: "none" }}>
        {hot.chains.map((c) => {
          const on = c.id === sel?.id;
          return (
            <button key={c.id} onClick={() => onSelect(c.id)} style={{ flex: "0 0 auto", minWidth: 96, textAlign: "left", padding: "7px 10px", borderRadius: 8, cursor: "pointer", background: on ? brand.blueSoft : "#141418", border: `1px solid ${on ? brand.blue : "#2a2a2f"}`, color: "#fff" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 13, fontWeight: 700 }}>
                <span style={{ color: c.rank === 1 ? "#ff9f0a" : "#8a8a8e", fontSize: 12 }}>{c.rank}</span>
                <span>{c.label}</span>
                {c.fomo && <span title="Supported by the FOMO app" style={{ fontSize: 9, color: brand.blueText, border: `1px solid ${brand.blueText}`, borderRadius: 3, padding: "0 3px" }}>FOMO</span>}
              </div>
              <div style={{ height: 3, borderRadius: 2, background: "#2a2a2f", marginTop: 6 }}>
                <div style={{ height: 3, borderRadius: 2, width: `${Math.max(4, c.heat)}%`, background: c.heat >= 66 ? "#ff9f0a" : c.heat >= 33 ? "#34c759" : "#4a4a66" }} />
              </div>
            </button>
          );
        })}
      </div>
      {sel && (
        <div style={{ fontSize: 11.5, color: "#8a8a8e", lineHeight: 1.5 }}>
          <b style={{ color: "#b4b4c6" }}>{sel.label}:</b> {sel.why}. <span title={hot.note}>Updated {hot.ageMin < 1 ? "just now" : `${hot.ageMin} min ago`}.</span>
        </div>
      )}
    </div>
  );
}

/** One trending pool: its own component because the Check button keeps state per coin. */
function HotCard({ p, entered, failed, onEnter, note }: { p: HotPool; entered: boolean; failed: boolean; onEnter: (p: HotPool) => void; note?: CheckNote }) {
  const check = useCoinCheck(p.address, p.chain, "hot", p.symbol);
  return (
    <>
      <div style={{ background: "#141418", border: "1px solid #2a2a2f", borderRadius: 8, padding: 12, marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <CoinName mint={p.address} chain={p.chain}>{p.symbol}</CoinName> <span style={{ color: "#8a8a8e", fontSize: 12 }}>{p.name}</span>
            <div style={{ fontSize: 12, color: "#b4b4c6", marginTop: 3 }}>
              {age(p.ageH) ? `${age(p.ageH)} old · ` : ""}1 h <span style={{ color: col(p.ch1) }}>{pct(p.ch1)}</span> · 6 h <span style={{ color: col(p.ch6) }}>{pct(p.ch6)}</span> · 24 h <span style={{ color: col(p.ch24) }}>{pct(p.ch24)}</span>
            </div>
            <CheckBadge note={note} />
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ color: "#fff", fontWeight: 700 }}>{usd(p.mcap)}</div>
            <div style={{ fontSize: 11, color: "#8a8a8e" }}>liquidity {usd(p.liq)}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button onClick={() => onEnter(p)} disabled={entered} style={{ ...btn, background: entered ? brand.blue : "#1a1a1f", color: entered ? brand.fg : failed ? "#ff9f0a" : brand.blueText, borderColor: failed ? "#ff9f0a" : brand.blue }}>
            {entered ? "✓ Entered" : failed ? "⚠ Not saved" : "Enter"}
          </button>
          <a href={dexUrl(p.chain, p.pair)} target="_blank" rel="noreferrer" style={{ ...btn, border: `1px solid ${brand.blueLine}` }}>
            DexScreener
          </a>
          <CheckButton state={check} fontSize={12} />
        </div>
      </div>
      <CheckPanel state={check} />
    </>
  );
}

/** What is trending on the chosen network, with the same Enter and DexScreener buttons as every other tab. */
export function HotTab({ hot, chain, entered, failedMints, onEnter, notes }: { hot: HotClient | null; chain: string | null; entered: Set<string>; failedMints: Set<string>; onEnter: (p: HotPool) => void; notes?: Map<string, CheckNote> }) {
  const [all, setAll] = useState(false);
  const c = hot?.chains.find((x) => x.id === chain) ?? hot?.chains[0] ?? null;
  const pools = useMemo(() => (c ? hot?.pools[c.id] ?? [] : []), [hot, c]);
  const shown = useMemo(() => (all ? pools : pools.filter(isNewSmall)), [pools, all]);
  if (!hot || !c) return <div style={{ padding: 16, color: "#8a8a8e" }}>Ranking the networks…</div>;
  return (
    <div style={{ padding: 16 }}>
      <TabIntro title={<>Hot on {c.label} ({shown.length})</>} color="#ff9f0a">
        What is trending on {c.label} right now, most trending first. Networks are ranked above, hottest first; the other tabs are Solana only.
      </TabIntro>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        <button onClick={() => setAll(false)} style={chip(!all)}>New and small ({pools.filter(isNewSmall).length})</button>
        <button onClick={() => setAll(true)} style={chip(all)}>All trending ({pools.length})</button>
      </div>
      {c.stats.error ? (
        <div style={{ textAlign: "center", color: "#ff9f0a", padding: 24 }}>{c.label} could not be read this time. It is tried again within a few minutes.</div>
      ) : shown.length === 0 ? (
        <div style={{ textAlign: "center", color: "#8a8a8e", padding: 24 }}>
          {pools.length === 0 ? `Nothing is trending on ${c.label} right now.` : `Nothing new and small is trending on ${c.label} right now: only older or larger coins. "All trending" shows them.`}
        </div>
      ) : (
        shown.map((p) => <HotCard key={p.pair} p={p} entered={entered.has(p.address)} failed={failedMints.has(p.address)} onEnter={onEnter} note={notes?.get(`hot|${p.address}`)} />)
      )}
    </div>
  );
}
