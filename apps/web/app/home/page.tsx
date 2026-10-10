"use client";
import { useMemo, useState } from "react";
import { usePolling } from "@/lib/usePolling";
import { MarketStrip } from "@/components/MarketStrip";
import { planCheck } from "@/lib/exitPlan";

interface Trade { id?: string; symbol: string; mint?: string; status: "active" | "exited"; multiplier: number; peakMultiple: number; lowMultiple: number }
interface Runner { mint: string; symbol: string | null; mcap: number | null; change24h: number | null; via: string; organic: number | null; holders: number | null; seenHoursAgo: number; flags: string[] }
interface Grad { mint: string; symbol: string | null; ageMin: number; mcap: number | null; liq?: number | null; sinceFirst: number | null; flags: string[]; kind?: string; healthy?: boolean; hiddenWhy?: string | null; empty?: boolean; drained?: boolean }
interface Loop { scoreboard: Array<{ id: string; label: string; value: number | null; n: number; format: "pct" | "hours" }>; decisions: Array<{ id: string; level: string; title: string; suggestion: string }>; }

const usd = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "-";
  const a = Math.abs(v);
  return a >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${v.toFixed(0)}`;
};
const x = (v: number) => `${v >= 10 ? v.toFixed(0) : v.toFixed(2)}x`;
const card: React.CSSProperties = { background: "#141418", border: "1px solid #2a2a2f", borderRadius: 10, padding: 14, minWidth: 0 };
const h: React.CSSProperties = { margin: "0 0 8px", color: "#fff", fontSize: 14, fontWeight: 700 };
const dim: React.CSSProperties = { color: "#8a8a9e", fontSize: 12, lineHeight: 1.5 };

/** One screen for a phone: the market, what needs a decision, your open trades, the runners and fresh graduations. */
export default function HomePage() {
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [runners, setRunners] = useState<Runner[] | null>(null);
  const [grads, setGrads] = useState<Grad[] | null>(null);
  const [gradAsOf, setGradAsOf] = useState<string | null>(null);
  const [loop, setLoop] = useState<Loop | null>(null);
  usePolling(async () => {
    const get = async (u: string) => {
      try {
        const r = await fetch(u, { cache: "no-store" });
        return r.ok ? await r.json() : null;
      } catch {
        return null;
      }
    };
    const [t, r, g, l] = await Promise.all([get("/api/my-trades"), get("/api/runners"), get("/api/graduates"), get("/api/lab/loop")]);
    if (t) setTrades(t.myTrades ?? []);
    if (r) setRunners(r.candidates ?? []);
    if (g) {
      setGrads(g.candidates ?? []);
      setGradAsOf(g.source === "laptop" ? g.asOf ?? null : null);
    }
    if (l) setLoop(l.loop ?? null);
  }, 60_000);

  const open = (trades ?? []).filter((t) => t.status === "active");
  const mean = useMemo(() => {
    if (!open.length) return null;
    const rows = open.map((t) => planCheck(t.peakMultiple, t.lowMultiple, t.multiplier));
    return { hold: rows.reduce((a, r) => a + r.holdValue, 0) / rows.length, plan: rows.reduce((a, r) => a + r.planValue, 0) / rows.length };
  }, [open]);
  const givingBack = open.filter((t) => t.peakMultiple >= 2 && t.multiplier < 0.6 * t.peakMultiple).sort((a, b) => b.peakMultiple / Math.max(0.01, b.multiplier) - a.peakMultiple / Math.max(0.01, a.multiplier)).slice(0, 4);
  const healthy = (runners ?? []).filter((r) => r.via !== "too_big").sort((a, b) => (b.organic ?? 0) - (a.organic ?? 0)).slice(0, 5);
  const recent = (grads ?? []).filter((g) => g.ageMin <= 90);
  const fresh = recent.filter((g) => g.healthy !== false && (g.sinceFirst == null || g.sinceFirst >= 0.7)).slice(0, 5);
  const skipped = recent.filter((g) => g.healthy === false);
  const label: Record<string, string> = { drained: "drained", empty: "empty pools", born: "born graduated", mayhem: "Mayhem Mode", gone: "no longer listed", small: "pools under $5K", waiting: "without a reading yet" };
  const skippedWhy = Object.entries(skipped.reduce<Record<string, number>>((a, g) => ((a[g.hiddenWhy ?? "small"] = (a[g.hiddenWhy ?? "small"] ?? 0) + 1), a), {})).map(([k, n]) => `${n} ${label[k] ?? k}`).join(", ");
  const gradAge = gradAsOf ? Math.max(0, Math.round((Date.now() - new Date(gradAsOf).getTime()) / 60_000)) : null;
  const link = (href: string, text: string) => <a href={href} style={{ color: "#30b0c0", fontSize: 12, fontWeight: 600, textDecoration: "none" }}>{text}</a>;

  return (
    <div style={{ padding: "18px 16px 90px", color: "#ececf4", maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 700 }}>Home</h1>
      <p style={{ ...dim, margin: "0 0 14px" }}>The few things worth a look today. Everything here is information, nothing is advice.</p>
      <MarketStrip />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
        <div style={card}>
          <h3 style={h}>Needs you</h3>
          {!loop ? <div style={dim}>Loading…</div> : loop.decisions.length === 0 ? (
            <div style={dim}>Nothing needs a decision. The lab keeps collecting; experiments are still gathering coins.</div>
          ) : loop.decisions.map((d) => (
            <div key={d.id} style={{ marginBottom: 8 }}>
              <div style={{ color: d.level === "act" ? "#ff9f0a" : "#b4b4c6", fontWeight: 600, fontSize: 13 }}>{d.title}</div>
              <div style={dim}>{d.suggestion}</div>
            </div>
          ))}
          <div style={{ marginTop: 6 }}>{link("/learning", "Open the system loop →")}</div>
        </div>

        <div style={card}>
          <h3 style={h}>Your open trades</h3>
          {trades == null ? <div style={dim}>Loading…</div> : open.length === 0 ? <div style={dim}>No open trades. Press Enter on a coin in the Radar to start a journal.</div> : (
            <>
              <div style={{ fontSize: 13 }}>
                {open.length} open · holding is worth <b>{mean ? x(mean.hold) : "-"}</b> a stake, the example exit plan would have been <b style={{ color: mean && mean.plan >= mean.hold ? "#34c759" : "#ff9f0a" }}>{mean ? x(mean.plan) : "-"}</b>
              </div>
              {givingBack.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ ...dim, marginBottom: 4 }}>Giving back a gain:</div>
                  {givingBack.map((t) => (
                    <div key={t.id ?? t.symbol} style={{ fontSize: 12 }}><b>{t.symbol}</b> peaked {x(t.peakMultiple)}, now {x(t.multiplier)} ({Math.round((1 - t.multiplier / t.peakMultiple) * 100)}% below its peak)</div>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 8 }}>{link("/results", "Open My Trades →")}</div>
            </>
          )}
        </div>

        <div style={card}>
          <h3 style={h}>Runners worth a look</h3>
          <div style={{ ...dim, marginBottom: 6 }}>Healthy, established coins from Jupiter's lists (the kind HOTBOT was), best organic score first. They are already up.</div>
          {runners == null ? <div style={dim}>Loading…</div> : healthy.length === 0 ? <div style={dim}>None on the list right now.</div> : healthy.map((r) => (
            <div key={r.mint} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, padding: "3px 0" }}>
              <a href={`/coin/${r.mint}`} style={{ color: "#fff", textDecoration: "none", fontWeight: 600 }}>{r.symbol ?? "?"}</a>
              <span style={{ color: "#8a8a9e" }}>{usd(r.mcap)} · organic {r.organic != null ? Math.round(r.organic) : "-"} · {r.change24h != null ? `${r.change24h >= 0 ? "+" : "−"}${Math.abs(r.change24h).toFixed(0)}% 24 h` : ""}</span>
            </div>
          ))}
          <div style={{ marginTop: 6 }}>{link("/radar", "All runners in the Radar →")}</div>
        </div>

        <div style={card}>
          <h3 style={h}>Fresh graduations</h3>
          <div style={{ ...dim, marginBottom: 6 }}>Graduated from pump.fun in the last 90 minutes, with a real pool, not down more than 30% yet. Coins the lab has measured to end in an emptied pool (born graduated, Mayhem Mode) are left out.</div>
          {gradAge != null && <div style={{ ...dim, marginBottom: 6, color: gradAge > 30 ? "#ff9f0a" : "#8a8a9e" }}>Snapshot from the laptop, {gradAge < 90 ? `${gradAge} min` : `${(gradAge / 60).toFixed(1)} h`} old{gradAge > 30 ? " (its stream may be off)" : ""}.</div>}
          {grads == null ? <div style={dim}>Loading…</div> : fresh.length === 0 ? <div style={dim}>{grads.length === 0 ? "No graduations recorded (the stream runs on the laptop)." : recent.length === 0 ? "No graduation in the last 90 minutes." : `None worth a look right now: ${recent.length} graduated in the last 90 minutes${skippedWhy ? ` (${skippedWhy})` : ""}.`}</div> : fresh.map((g) => (
            <div key={g.mint} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, padding: "3px 0" }}>
              <a href={`/coin/${g.mint}`} style={{ color: "#fff", textDecoration: "none", fontWeight: 600 }}>{g.symbol ?? "?"}</a>
              <span style={{ color: "#8a8a9e" }}>{Math.round(g.ageMin)} min · {usd(g.mcap)} · liquidity {usd(g.liq)}</span>
            </div>
          ))}
          <div style={{ marginTop: 6 }}>{link("/radar", "All graduations in the Radar →")}</div>
        </div>
      </div>

      {loop && (
        <div style={{ ...card, marginTop: 12 }}>
          <h3 style={h}>Scoreboard</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 28px" }}>
            {loop.scoreboard.map((s) => (
              <div key={s.id} style={{ minWidth: 140 }}>
                <div style={{ color: "#8a8a9e", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4 }}>{s.label}</div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{s.value == null ? "collecting" : s.format === "hours" ? `${Math.round(s.value)} of 24 h` : `${Math.round(s.value * 100)}%`}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
