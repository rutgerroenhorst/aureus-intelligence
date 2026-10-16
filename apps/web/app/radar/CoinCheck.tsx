"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { FLAG_WORD, type FlagCode } from "@/lib/redFlags";
import type { CheckLine } from "@/lib/coinCheck";
import { AWAY_HOURS } from "@/lib/checkAway";
import { brand } from "@/lib/brand";
import { IconSearch } from "./parts";
import Link from "next/link";
import { CHECK_LINE_ENTRY } from "@/lib/kennis/checkLinks";

/** What the site answered when a coin was checked (lib/coinCheck.ts judgeCoin, plus when). */
export interface CheckAnswer {
  verdict: "agree" | "disagree" | "unclear";
  dead: boolean | null;
  flags: string[];
  lines: string[];
  /** every check that was looked at, with its result (absent in checks made before they were itemised) */
  checks?: CheckLine[];
  at: string;
  /** the same coin on the same tab was checked less than a minute ago: this is that answer */
  repeated?: boolean;
}

/** An earlier check of a coin that is listed on the tab now (GET /api/coin-checks). */
export interface CheckNote {
  mint: string;
  tab: string;
  at: string;
  verdict: "agree" | "disagree" | "unclear";
  /** the tab listed the coin again after the check */
  returned: boolean;
}

/**
 * Lets a card tell the page what its check did, so the page can leave a coin out of the list the moment the site agrees (and keep it while the answer is open).
 * The cards are in different files and some are deep in other components, so this goes through a context instead of through every list.
 */
export interface CheckHub {
  /** a check just came back on this screen (the saved list only knows it after the next refresh) */
  answered(tab: string, mint: string, a: CheckAnswer): void;
  /** the answer under a card was opened or closed */
  opened(tab: string, mint: string, open: boolean): void;
}
export const CheckHubContext = createContext<CheckHub | null>(null);

export function useCoinCheck(mint: string, chain: string | undefined, tab: string | undefined, symbol?: string | null) {
  const hub = useContext(CheckHubContext);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<CheckAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // a card that goes away (another tab, a refresh that dropped the coin) must not leave its answer pinned open
  useEffect(
    () => () => {
      if (tab) hub?.opened(tab, mint, false);
    },
    [hub, tab, mint],
  );
  const run = async () => {
    if (busy || !tab) return;
    setBusy(true);
    setOpen(true);
    hub?.opened(tab, mint, true);
    setError(null);
    try {
      const res = await fetch("/api/coin-check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mint, chain: chain ?? "solana", tab, symbol: symbol ?? undefined }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? `check ${res.status}`);
      setAnswer(j as CheckAnswer);
      hub?.answered(tab, mint, j as CheckAnswer);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    setOpen(false);
    if (tab) hub?.opened(tab, mint, false);
  };
  return { busy, answer, error, open, run, close, enabled: Boolean(tab) };
}
export type CoinCheckState = ReturnType<typeof useCoinCheck>;

const TONE = { agree: "#ff9f0a", disagree: "#34c759", unclear: "#8a8a8e" } as const;
const HEAD = { agree: "you are right", disagree: "I do not agree", unclear: "not sure" } as const;
const MARK = { ok: { sign: "✓", color: "#34c759" }, warn: { sign: "⚠", color: "#ff9f0a" }, bad: { sign: "✗", color: "#ff453a" }, skip: { sign: "–", color: "#6a6a72" }, note: { sign: "ℹ", color: "#8a8a8e" } } as const;

/** A small quiet button next to Enter and DexScreener. */
export function CheckButton({ state, fontSize = 10 }: { state: CoinCheckState; fontSize?: number }) {
  if (!state.enabled) return null;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        void state.run();
      }}
      disabled={state.busy}
      title="Dead, or not where it belongs? The site looks at the coin again right now (the market, a test sale, the holders, the creator, its own history) and tells you what it finds. It does not just agree."
      style={{ padding: "4px 8px", background: "#1a1a1f", color: state.answer ? TONE[state.answer.verdict] : "#b4b4c6", border: "1px solid #3a3a46", borderRadius: "4px", fontSize, fontWeight: 600, cursor: state.busy ? "default" : "pointer", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }}
    >
      {state.busy ? "Checking…" : (<><IconSearch /> {state.answer ? "Checked" : "Check"}</>)}
    </button>
  );
}

/** What the check found, under the card: every check with its result, then what the site concludes. */
export function CheckPanel({ state }: { state: CoinCheckState }) {
  if (!state.open) return null;
  const a = state.answer;
  return (
    <div style={{ background: "#12141a", border: "1px solid #2a2a2f", borderLeft: `3px solid ${a ? TONE[a.verdict] : "#4a4a56"}`, borderRadius: 6, padding: "8px 10px", margin: "-2px 0 10px", fontSize: 12, lineHeight: 1.55, color: "#d4d4de" }}>
      {state.busy && !a ? (
        <span style={{ color: "#8a8a8e" }}>Looking at the coin again: the market, a test sale, the holders, the creator…</span>
      ) : state.error ? (
        <span style={{ color: "#ff9f0a" }}>{state.error}</span>
      ) : a ? (
        <>
          <div style={{ fontWeight: 700, color: TONE[a.verdict], marginBottom: 3 }}>Check: {HEAD[a.verdict]}</div>
          {a.checks?.length ? (
            <>
              <div style={{ margin: "0 0 4px" }}>
                {a.checks.map((c) => (
                  <div key={c.key} style={{ display: "flex", gap: 6 }}>
                    <span style={{ color: MARK[c.state].color, width: 12, flexShrink: 0, textAlign: "center", fontWeight: 700 }}>{MARK[c.state].sign}</span>
                    <span style={{ color: c.state === "skip" || c.state === "note" ? "#8a8a8e" : "#d4d4de" }}>{c.text}</span>
                    {CHECK_LINE_ENTRY[c.key] && (
                      <Link href={`/kennis?e=${CHECK_LINE_ENTRY[c.key]}`} className="info-btn info-btn-sm" title="Wat betekent dit?" aria-label="Uitleg bij deze regel" style={{ flexShrink: 0 }}>
                        ?
                      </Link>
                    )}
                  </div>
                ))}
              </div>
              {a.lines.slice(1).map((l, i) => (
                <div key={i} style={{ fontWeight: 600 }}>
                  {l}
                </div>
              ))}
            </>
          ) : (
            a.lines.map((l, i) => <div key={i}>{l}</div>)
          )}
          <div style={{ marginTop: 4, fontSize: 11, color: "#6a6a72" }}>
            Looks at the coin itself (the market, a test sale on Jupiter, RugCheck, the creator, this system's own record), not at the tab's own rules; only the Hot tab's simple rule is applied. Kept, so Learning can grade your doubts against how coins end.
            {a.repeated ? " (Same check as a moment ago.)" : ""}
            {a.verdict === "agree" ? ` When you close this, the coin leaves the tab for ${AWAY_HOURS} hours (or until the tab lists it again).` : ""}
          </div>
        </>
      ) : null}
      <button onClick={state.close} style={{ marginTop: 6, background: "none", border: "none", color: "#6a6a72", fontSize: 11, cursor: "pointer", padding: 0 }}>
        close
      </button>
    </div>
  );
}

const ago = (iso: string) => {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return min < 90 ? `${Math.max(1, min)} min ago` : min < 2880 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} d ago`;
};

/** On a card whose coin was checked before: when, what the site said, and whether the tab has listed the coin again since. */
export function CheckBadge({ note }: { note: CheckNote | undefined }) {
  if (!note) return null;
  const said = note.verdict === "agree" ? "you doubted it, the site agreed" : note.verdict === "disagree" ? "you doubted it, the site did not agree" : "you doubted it, the site was unsure";
  return (
    <div style={{ marginTop: 5, fontSize: 11, lineHeight: 1.4, color: note.returned ? brand.blueText : "#8a8a8e" }} title="From your earlier Check of this coin on this tab">
      {note.returned ? "↩ Back on this tab" : "Checked"} · {ago(note.at)} ({said}){note.returned ? ": the tab listed it again" : ""}
    </div>
  );
}

/** Above a list: how many coins the user's checks took off it, and the switch to see them. Nothing is shown when no coin was taken off. */
/** The coins a list left out because of a severe red flag as they look now (lib/redFlags.ts, docs/RED_FLAGS.md): how many, why, and a way to look at them anyway. */
export function FlaggedLine({ coins, shown, onToggle }: { coins: Array<{ symbol?: string | null; redFlags?: Array<{ code: string; text: string }> }>; shown: boolean; onToggle: () => void }) {
  if (!coins.length) return null;
  const words = new Map<string, number>();
  for (const c of coins) {
    const w = FLAG_WORD[(c.redFlags?.[0]?.code ?? "") as FlagCode] ?? "flagged";
    words.set(w, (words.get(w) ?? 0) + 1);
  }
  const why = [...words.entries()].sort((a, b) => b[1] - a[1]).map(([w, n]) => `${n} ${w}`).join(", ");
  const names = coins.slice(0, 5).map((c) => `${c.symbol ?? "?"} (${(c.redFlags?.[0]?.text ?? "").replace(/^(collapsed|pool drained|no trading|being dumped|pump that turned): ?/, "").slice(0, 44) || "red flag"})`);
  return (
    <div style={{ padding: "10px 16px 0", fontSize: 12, lineHeight: 1.5, color: "#8a8a8e" }}>
      {coins.length} coin{coins.length === 1 ? "" : "s"} left out for red flags as {coins.length === 1 ? "it looks" : "they look"} right now ({why}): {names.join(", ")}
      {coins.length > 5 ? `, and ${coins.length - 5} more` : ""}.{" "}
      <button onClick={onToggle} style={{ background: "none", border: "none", color: brand.blueText, cursor: "pointer", padding: 0, fontSize: 12, textDecoration: "underline" }}>
        {shown ? "Leave them out again" : "Show them"}
      </button>
    </div>
  );
}

export function AwayLine({ count, shown, onToggle }: { count: number; shown: boolean; onToggle: () => void }) {
  if (!count) return null;
  return (
    <div style={{ padding: "10px 16px 0", fontSize: 12, lineHeight: 1.5, color: "#8a8a8e" }}>
      {count} coin{count === 1 ? "" : "s"} left out because you checked {count === 1 ? "it" : "them"} and the site agreed (dead, or a serious problem). They come back after {AWAY_HOURS} hours, or when the tab lists them again.{" "}
      <button onClick={onToggle} style={{ background: "none", border: "none", color: brand.blueText, cursor: "pointer", padding: 0, fontSize: 12, textDecoration: "underline" }}>
        {shown ? "Leave them out again" : "Show them"}
      </button>
    </div>
  );
}
