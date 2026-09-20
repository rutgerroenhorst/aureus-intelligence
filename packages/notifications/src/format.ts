import type { AlertProposal } from "@aureus/alert-engine";
import { escapeHtml } from "./telegram.js";

export interface MessageFacts {
  symbol: string | null;
  liquidityUsd: number | null;
  fdvUsd: number | null;
  volumeUsd: number | null;
  pairAgeLabel: string;
  dexUrl: string;
  aureusUrl: string;
  invalidation: string[];
  risks: string[];
  heliusDegraded: boolean;
}

const EMOJI: Record<string, string> = { WATCH: "🟡", HIGH_PRIORITY: "🟠", ENTRY_READY: "🟢", RISK: "🔴", INFO: "⚪", SYSTEM: "⚙️" };
const money = (v: number | null) => (v == null ? "n/a" : v >= 1_000_000 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${v.toFixed(2)}`);
const bullets = (items: string[]) => items.map((i) => `• ${escapeHtml(i)}`).join("\n");

/** Render an alert to safe Telegram HTML. All dynamic tokens are escaped. */
export function renderMessage(p: AlertProposal, f: MessageFacts): string {
  const sym = escapeHtml(f.symbol ? `$${f.symbol}` : "unknown");
  const head = `${EMOJI[p.level] ?? "•"} <b>AUREUS ${p.level.replace(/_/g, " ")}</b> — ${sym}`;
  const lines: string[] = [head, ""];

  if (p.level === "RISK") {
    lines.push(`Previous state: ${escapeHtml(p.stateFrom ?? "—")}`);
    lines.push(`New state: ${escapeHtml(p.stateTo)}`);
    lines.push("");
    lines.push("<b>Reason:</b>");
    lines.push(bullets(p.riskReasons.length ? p.riskReasons : p.reasons));
  } else {
    lines.push(`State: ${escapeHtml(p.stateTo)}`);
    lines.push(`Liquidity: ${money(f.liquidityUsd)}   FDV: ${money(f.fdvUsd)}`);
    if (f.volumeUsd != null) lines.push(`24h volume: ${money(f.volumeUsd)}`);
    lines.push(`Pair age: ${escapeHtml(f.pairAgeLabel)}`);
    lines.push("");
    if (p.positives.length) { lines.push("<b>Positive:</b>"); lines.push(bullets(p.positives)); lines.push(""); }
    if (p.level === "ENTRY_READY") {
      if (f.invalidation.length) { lines.push("<b>Invalidation:</b>"); lines.push(bullets(f.invalidation)); lines.push(""); }
      if (f.risks.length) { lines.push("<b>Risks:</b>"); lines.push(bullets(f.risks)); lines.push(""); }
      lines.push("<i>Not financial advice.</i>");
    } else if (p.missing.length) {
      lines.push("<b>Still needed:</b>");
      lines.push(bullets(f.heliusDegraded ? ["On-chain confirmation unavailable — not entry ready", ...p.missing] : p.missing));
      lines.push("");
    }
  }
  lines.push("");
  lines.push(`<a href="${escapeHtml(f.dexUrl)}">Dex Screener</a> · <a href="${escapeHtml(f.aureusUrl)}">Aureus</a>`);
  return lines.join("\n");
}
