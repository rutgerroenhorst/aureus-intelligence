"use client";
import { useState } from "react";
import { usePolling } from "@/lib/usePolling";
import { brand } from "@/lib/brand";

interface Msg {
  id: number;
  sent_at: string;
  kind: "alert" | "welcome" | "test";
  ok: boolean;
  symbol: string | null;
  level: number | null;
  multiple: number | null;
  body: string;
  error: string | null;
}
interface Data {
  messages: Msg[];
  total: number;
  sent: number;
  lastSentAt: string | null;
  /** when the site's own exit check last ran, and what it saw; null before the first run */
  check: { at: string; positions: number | null; priced: number | null; sent: number | null } | null;
}

const card: React.CSSProperties = { background: "#141418", border: "1px solid #2a2a2f", borderRadius: 10, padding: 14, minWidth: 0 };
const dim: React.CSSProperties = { color: "#8a8a9e", fontSize: 12, lineHeight: 1.5 };
const KIND: Record<Msg["kind"], { label: string; color: string }> = {
  alert: { label: "Alert", color: "#ff9f0a" },
  welcome: { label: "Welcome", color: "#34c759" },
  test: { label: "Test", color: brand.blueText },
};

const when = (iso: string) => new Date(iso).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return min < 1 ? "just now" : min < 90 ? `${min} min ago` : min < 2880 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} d ago`;
};

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** The text of a message with its links made clickable. Lines indented by two spaces are the aligned table of an alert: drawn in a monospace font, as Telegram does. */
function Body({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div style={{ wordBreak: "break-word", color: "#e5e5e7", fontSize: 13, lineHeight: 1.55 }}>
      {lines.map((line, li) => {
        const mono = line.startsWith("  ");
        const parts = line.split(/(https?:\/\/\S+)/g);
        return (
          <div key={li} style={{ whiteSpace: "pre-wrap", ...(mono ? { fontFamily: MONO, fontSize: 12.5, color: "#c9c9d6", background: "#101014", padding: "0 8px" } : {}) }}>
            {line === "" ? "\u00a0" : parts.map((p, i) =>
              /^https?:\/\//.test(p) ? (
                <a key={i} href={p} target="_blank" rel="noreferrer" style={{ color: "#35DCFF" }}>
                  {p.replace(/^https?:\/\//, "")}
                </a>
              ) : (
                <span key={i}>{p}</span>
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}

/** What the system sent to Telegram: the exit alerts (a coin you hold reached 2x or 5x), the welcome message and tests, newest first. */
export default function TelegramPage() {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [only, setOnly] = useState<"all" | "alert">("all");
  usePolling(async () => {
    try {
      const res = await fetch("/api/telegram-messages", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setData(await res.json());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, 60_000);

  const shown = (data?.messages ?? []).filter((m) => only === "all" || m.kind === "alert");
  const alerts = (data?.messages ?? []).filter((m) => m.kind === "alert" && m.ok).length;
  const chip = (on: boolean): React.CSSProperties => ({ padding: "5px 10px", fontSize: 12, borderRadius: 6, cursor: "pointer", background: on ? "#2a2a3e" : "#1a1a1f", color: on ? "#fff" : "#8a8a8e", border: `1px solid ${on ? "#4a4a66" : "#2a2a2f"}` });

  return (
    <div style={{ padding: 16, maxWidth: 760, margin: "0 auto" }}>
      <h2 style={{ margin: "0 0 4px", color: "#fff", fontSize: 20 }}>Telegram</h2>
      <p style={{ ...dim, margin: "0 0 12px" }}>
        What the system sent to your Telegram: an alert when a coin you hold reaches <b>2×</b> or <b>5×</b> what you paid for what you still hold, the welcome message and tests. The site checks by itself every 2 minutes, day and night; the laptop does not need to be on and no screen needs to be open.
      </p>

      {(() => {
        const at = data?.check?.at ?? null;
        const min = at ? Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000)) : null;
        // the clock ticks every 2 minutes: more than 8 without a heartbeat means something is wrong
        const late = data != null && (min == null || min > 8);
        // the check ran but no coin came back with a price (DexScreener not answering): it would see nothing
        const blind = data?.check != null && (data.check.positions ?? 0) > 0 && data.check.priced === 0;
        const warn = late || blind;
        return (
          <div style={{ ...card, marginBottom: 12, borderColor: warn ? "#6a4a1a" : "#2a2a2f", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ width: 9, height: 9, borderRadius: 9, background: !data ? "#5a5a6e" : warn ? "#ff9f0a" : "#34c759", flex: "none" }} />
            <span style={{ color: "#e5e5e7", fontSize: 13 }}>
              {!data
                ? "Reading the site's check…"
                : !at
                  ? "The site has not run its check yet."
                  : `The site's check ran ${ago(at)}${data.check?.positions != null ? ` · watching ${data.check.positions} position${data.check.positions === 1 ? "" : "s"}` : ""}${data.check?.priced != null ? ` · ${data.check.priced} priced` : ""}`}
            </span>
            {late && at && <span style={{ color: "#ff9f0a", fontSize: 12 }}>Later than expected: a message can be late until it runs again.</span>}
            {blind && !late && <span style={{ color: "#ff9f0a", fontSize: 12 }}>No prices came back at the last check: a message can be late until they do.</span>}
          </div>
        );
      })()}

      <div style={{ ...card, display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={{ color: "#fff", fontSize: 20, fontWeight: 700 }}>{data ? data.sent : "–"}</div>
          <div style={dim}>sent</div>
        </div>
        <div>
          <div style={{ color: "#fff", fontSize: 20, fontWeight: 700 }}>{data ? alerts : "–"}</div>
          <div style={dim}>alerts (of the last 100)</div>
        </div>
        <div>
          <div style={{ color: "#fff", fontSize: 20, fontWeight: 700 }}>{data ? ago(data.lastSentAt) : "–"}</div>
          <div style={dim}>last message</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <button onClick={() => setOnly("all")} style={chip(only === "all")}>All ({data?.messages.length ?? 0})</button>
        <button onClick={() => setOnly("alert")} style={chip(only === "alert")}>Alerts only</button>
      </div>

      {failed && !data ? (
        <div style={{ ...card, color: "#ff9f0a" }}>The messages could not be read. Try again in a minute.</div>
      ) : !data ? (
        <div style={{ ...card, ...dim }}>Loading…</div>
      ) : shown.length === 0 ? (
        <div style={{ ...card, ...dim }}>
          {only === "alert" ? "No alert has been sent yet." : "Nothing has been sent yet."} An alert comes when a coin you hold reaches 2× or 5× what you paid for what you still hold, with two checks in a row and a real pool behind it.
        </div>
      ) : (
        shown.map((m) => (
          <div key={m.id} style={{ ...card, marginBottom: 8, borderColor: m.ok ? "#2a2a2f" : "#5a2a2a" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: KIND[m.kind].color, border: `1px solid ${KIND[m.kind].color}`, borderRadius: 4, padding: "1px 6px" }}>{KIND[m.kind].label}</span>
              <span style={{ ...dim }}>{when(m.sent_at)}</span>
              <span style={{ ...dim, marginLeft: "auto", color: m.ok ? "#34c759" : "#ff453a" }}>{m.ok ? "✓ sent" : "✗ not sent"}</span>
            </div>
            <Body text={m.body} />
            {!m.ok && m.error && <div style={{ marginTop: 8, color: "#ff9f0a", fontSize: 12 }}>Telegram said: {m.error}</div>}
          </div>
        ))
      )}
    </div>
  );
}
