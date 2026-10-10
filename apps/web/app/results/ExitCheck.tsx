"use client";
import { planCheck } from "@/lib/exitPlan";

interface Trade {
  id?: string;
  symbol: string;
  status: "active" | "exited";
  multiplier: number;
  peakMultiple: number;
  lowMultiple: number;
}

const x = (v: number) => `${v >= 10 ? v.toFixed(0) : v.toFixed(2)}x`;

/**
 * What a fixed example plan would have done with each open trade, next to just holding. It is a comparison tool, not a
 * recommendation: it shows how much of a gain the trade offered and what was left of it, using only the highest, lowest and
 * latest points the journal saved. See lib/exitPlan.ts for the plan and its two assumptions.
 */
export function ExitCheck({ trades }: { trades: Trade[] }) {
  const open = trades.filter((t) => t.status === "active");
  if (!open.length) return null;
  const rows = open.map((t) => ({ t, c: planCheck(t.peakMultiple, t.lowMultiple, t.multiplier) }));
  const mean = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
  const hold = mean((r) => r.c.holdValue);
  const plan = mean((r) => r.c.planValue);
  return (
    <div style={{ background: "#0f1116", border: "1px solid #2a2a2f", borderRadius: 8, padding: 16, marginBottom: 24 }}>
      <h3 style={{ margin: "0 0 4px", color: "#fff", fontSize: 15 }}>Your open trades against an example exit plan</h3>
      <div style={{ fontSize: 12, color: "#8a8a8e", lineHeight: 1.5, marginBottom: 12 }}>
        The example plan sells a quarter at 2x, 5x and 10x, stops out at -50% until the first sale and 40% below the highest point after it. It is not advice and not a promise: it only shows what the plan would have kept from the gain each trade offered. Based on the highest, lowest and latest market caps the journal saved (checked while Aureus is open); a stop is assumed to fill at its level, which on a thin pool can be worse.
      </div>
      <div style={{ fontSize: 13, color: "#ececf4", marginBottom: 12 }}>
        Across your {rows.length} open trade{rows.length === 1 ? "" : "s"}, equal stakes: holding is worth <b>{x(hold)}</b> a stake now, the example plan would have been worth <b style={{ color: plan >= hold ? "#34c759" : "#ff9f0a" }}>{x(plan)}</b>.
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {rows.map(({ t, c }, i) => (
          <div key={t.id ?? i} style={{ display: "grid", gridTemplateColumns: "minmax(80px, 1fr) repeat(3, minmax(70px, 1fr))", gap: 8, alignItems: "baseline", fontSize: 12, borderTop: i ? "1px solid #1a1a1f" : "none", paddingTop: i ? 8 : 0 }}>
            <div>
              <b style={{ color: "#fff" }}>{t.symbol}</b>
              <div style={{ color: "#8a8a8e", fontSize: 11 }}>
                peak {x(t.peakMultiple)} · now {x(t.multiplier)}
                {t.peakMultiple > 1.05 ? ` · ${Math.round((1 - t.multiplier / t.peakMultiple) * 100)}% below its peak` : ""}
              </div>
            </div>
            <div>
              <div style={{ color: "#8a8a8e", fontSize: 10.5, textTransform: "uppercase" }}>Sales hit</div>
              <div style={{ color: "#ececf4" }}>{c.rungsHit.length ? c.rungsHit.map((r) => `${r}x`).join(", ") : "none"}</div>
            </div>
            <div>
              <div style={{ color: "#8a8a8e", fontSize: 10.5, textTransform: "uppercase" }}>Stop</div>
              <div style={{ color: c.stopped ? "#ff9f0a" : "#ececf4" }}>{c.stopped ? `passed (${x(c.stopLevel)})` : `at ${x(c.stopLevel)}`}</div>
            </div>
            <div>
              <div style={{ color: "#8a8a8e", fontSize: 10.5, textTransform: "uppercase" }}>Hold / plan</div>
              <div style={{ color: "#ececf4" }}>{x(c.holdValue)} / <b style={{ color: c.planValue >= c.holdValue ? "#34c759" : "#ff9f0a" }}>{x(c.planValue)}</b></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
