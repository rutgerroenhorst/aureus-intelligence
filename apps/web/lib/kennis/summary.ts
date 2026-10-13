import type { ApiTrade } from "../my-trades";
import type { Facts } from "./types";

const median = (v: number[]): number | null => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** The journal in numbers. Pure, so it can be tested: nothing leaves it but aggregates. */
export function journalFacts(trades: ApiTrade[]): NonNullable<Facts["journal"]> {
  const withSize = trades.filter((t) => t.sizeUsd != null && t.sizeUsd > 0);
  const held = trades.filter((t) => t.status === "active" && t.sizeUsd != null).reduce((a, t) => a + (t.sizeUsd as number) * t.multiplier * (1 - (t.soldFraction ?? 0)), 0);
  const lost = (t: ApiTrade) => t.multiplier <= 0.5;
  const via = trades.filter((t) => t.tab != null);
  const outside = trades.filter((t) => t.tab == null);
  const active = trades.filter((t) => t.status === "active");
  return {
    coins: trades.length,
    putUsd: withSize.reduce((a, t) => a + (t.sizeUsd as number), 0),
    outUsd: trades.reduce((a, t) => a + (t.soldUsd ?? 0), 0),
    heldUsd: held,
    lostHalf: trades.filter(lost).length,
    touched2x: trades.filter((t) => t.peakMultiple >= 2).length,
    gaveBack: active.filter((t) => t.peakMultiple >= 2 && t.multiplier < 1).length,
    medianSizeUsd: median(withSize.map((t) => t.sizeUsd as number)),
    viaRadar: { n: via.length, lostHalf: via.filter(lost).length },
    outsideRadar: { n: outside.length, lostHalf: outside.filter(lost).length },
    sources: { wallet: trades.filter((t) => t.source === "wallet").length, radar: trades.filter((t) => t.source === "radar").length, manual: trades.filter((t) => t.source === "manual").length },
  };
}

/** The lab's base rates and its own headline sentences, from the stored reports (two small rows, no recomputation). */
export function labFacts(overview: any, headlines: any): Facts["lab"] {
  const h = overview?.held;
  if (!h || typeof h.basis !== "number" || !h.x2) return null;
  const p = (x: any): number => (typeof x?.p === "number" ? x.p : 0);
  const lines: string[] = Array.isArray(headlines) ? headlines.map((x: any) => (typeof x === "string" ? x : x?.text)).filter((x: unknown): x is string => typeof x === "string") : [];
  return { followed: h.basis, held: { x2: p(h.x2), x3: p(h.x3), x5: p(h.x5), x10: p(h.x10) }, headlines: lines.slice(0, 12) };
}
