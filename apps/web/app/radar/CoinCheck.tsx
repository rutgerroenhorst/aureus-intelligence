"use client";
import { useState } from "react";

/** What the site answered when a coin was checked (lib/coinCheck.ts judgeCoin, plus when). */
export interface CheckAnswer {
  verdict: "agree" | "disagree" | "unclear";
  dead: boolean | null;
  flags: string[];
  lines: string[];
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

export function useCoinCheck(mint: string, chain: string | undefined, tab: string | undefined, symbol?: string | null) {
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<CheckAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const run = async () => {
    if (busy || !tab) return;
    setBusy(true);
    setOpen(true);
    setError(null);
    try {
      const res = await fetch("/api/coin-check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mint, chain: chain ?? "solana", tab, symbol: symbol ?? undefined }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? `check ${res.status}`);
      setAnswer(j as CheckAnswer);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, answer, error, open, run, close: () => setOpen(false), enabled: Boolean(tab) };
}
export type CoinCheckState = ReturnType<typeof useCoinCheck>;

const TONE = { agree: "#ff9f0a", disagree: "#34c759", unclear: "#8a8a8e" } as const;
const HEAD = { agree: "you are right", disagree: "I do not agree", unclear: "not sure" } as const;

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
      title="Dead, or not where it belongs? The site looks at the coin again right now and tells you what it finds. It does not just agree."
      style={{ padding: "4px 8px", background: "#1a1a1f", color: state.answer ? TONE[state.answer.verdict] : "#b4b4c6", border: "1px solid #3a3a46", borderRadius: "4px", fontSize, fontWeight: 600, cursor: state.busy ? "default" : "pointer", whiteSpace: "nowrap" }}
    >
      {state.busy ? "Checking…" : state.answer ? "🔍 Checked" : "🔍 Check"}
    </button>
  );
}

/** What the check found, under the card. */
export function CheckPanel({ state }: { state: CoinCheckState }) {
  if (!state.open) return null;
  const a = state.answer;
  return (
    <div style={{ background: "#12141a", border: "1px solid #2a2a2f", borderLeft: `3px solid ${a ? TONE[a.verdict] : "#4a4a56"}`, borderRadius: 6, padding: "8px 10px", margin: "-2px 0 10px", fontSize: 12, lineHeight: 1.55, color: "#d4d4de" }}>
      {state.busy && !a ? (
        <span style={{ color: "#8a8a8e" }}>Looking at the coin again…</span>
      ) : state.error ? (
        <span style={{ color: "#ff9f0a" }}>{state.error}</span>
      ) : a ? (
        <>
          <div style={{ fontWeight: 700, color: TONE[a.verdict], marginBottom: 2 }}>Check: {HEAD[a.verdict]}</div>
          {a.lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
          <div style={{ marginTop: 4, fontSize: 11, color: "#6a6a72" }}>
            Measures the coin itself (and the Hot tab's own rule); the other tabs' rules are not re-run. Kept, so Learning can grade your doubts against how coins end.
            {a.repeated ? " (Same check as a moment ago.)" : ""}
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
    <div style={{ marginTop: 5, fontSize: 11, lineHeight: 1.4, color: note.returned ? "#30b0c0" : "#8a8a8e" }} title="From your earlier Check of this coin on this tab">
      {note.returned ? "↩ Back on this tab" : "🔍 Checked"} · {ago(note.at)} ({said}){note.returned ? ": the tab listed it again" : ""}
    </div>
  );
}
