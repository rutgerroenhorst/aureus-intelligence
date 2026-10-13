"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckButton, CheckPanel, useCoinCheck } from "./CoinCheck";
import { CoinName } from "./parts";
import { CHAIN_BY_ID, dexUrl } from "@/lib/chains";
import type { Resolved } from "@/lib/pasteCoin";
import { brand } from "@/lib/brand";

const usd = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "-";
  const a = Math.abs(v);
  return a >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${v.toFixed(0)}`;
};
const age = (h: number | null) => (h == null ? null : h < 1 ? "under an hour old" : h < 48 ? `${Math.round(h)} h old` : h < 24 * 90 ? `${Math.round(h / 24)} d old` : `${(h / 24 / 365).toFixed(1)} y old`);

const btn: React.CSSProperties = { padding: "6px 12px", background: "#1a1a1f", color: brand.blueText, border: `1px solid ${brand.blue}`, borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", textDecoration: "none", display: "inline-block" };

/** The coin that was pasted: the same buttons as a card on a tab, and the Check runs by itself because that is why it was pasted. */
function PastedCoin({ coin, onClose }: { coin: Resolved; onClose: () => void }) {
  const check = useCoinCheck(coin.mint, coin.chain, "pasted", coin.symbol);
  const [entered, setEntered] = useState(false);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void check.run();
  }, [check]);
  const solana = coin.chain === "solana";
  const enter = async () => {
    try {
      const res = await fetch("/api/my-trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: coin.symbol, mint: coin.mint, chain: coin.chain, entryMcap: coin.mcap, tab: "pasted", action: "add-entry" }),
      });
      if (!res.ok) throw new Error(`my-trades ${res.status}`);
      setEntered(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };
  return (
    <>
      <div style={{ background: "#141418", border: "1px solid #2a2a2f", borderRadius: 8, padding: 12, margin: "10px 0 8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <CoinName mint={coin.mint} chain={coin.chain}>{coin.symbol}</CoinName> <span style={{ color: "#8a8a8e", fontSize: 12 }}>{coin.name}</span>
            {!solana && <span style={{ marginLeft: 6, fontSize: 9, color: brand.blueText, border: `1px solid ${brand.blueText}`, borderRadius: 3, padding: "0 3px" }}>{CHAIN_BY_ID.get(coin.chain)?.label ?? coin.chain}</span>}
            <div style={{ fontSize: 12, color: "#b4b4c6", marginTop: 3 }}>{age(coin.ageH) ? `${age(coin.ageH)} · ` : ""}the coin you pasted</div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ color: "#fff", fontWeight: 700 }}>{usd(coin.mcap)}</div>
            <div style={{ fontSize: 11, color: "#8a8a8e" }}>liquidity {usd(coin.liq)}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={() => void enter()} disabled={entered} style={{ ...btn, background: entered ? brand.blue : "#1a1a1f", color: entered ? brand.fg : failed ? "#ff9f0a" : brand.blueText, borderColor: failed ? "#ff9f0a" : brand.blue }}>
            {entered ? "✓ Entered" : failed ? "⚠ Not saved" : "Enter"}
          </button>
          <a href={dexUrl(coin.chain, coin.pair || coin.mint)} target="_blank" rel="noreferrer" style={{ ...btn, border: `1px solid ${brand.blueLine}` }}>
            DexScreener
          </a>
          {solana && (
            <Link href={`/coin/${coin.mint}`} style={{ ...btn, border: `1px solid ${brand.blueLine}` }}>
              Dossier
            </Link>
          )}
          <CheckButton state={check} fontSize={12} />
          <button onClick={onClose} aria-label="Close" style={{ marginLeft: "auto", background: "none", border: "none", color: "#8a8a8e", fontSize: 18, lineHeight: 1, cursor: "pointer", padding: "0 4px" }}>
            ×
          </button>
        </div>
      </div>
      <CheckPanel state={check} />
    </>
  );
}

/**
 * "Paste a coin": for the coins that are on no tab (found on X, in the FOMO app, from a friend). An address or a link in, and the same Check as on a card out, before the buy.
 * Of the coins this system never saw, every one of the 20 that were bought lost at least half (docs/WALLET_REVIEW.md): this is the second opinion for exactly those.
 */
export function PasteCheck({ initial, autoRun, hideForm }: { initial?: string; autoRun?: boolean; hideForm?: boolean } = {}) {
  const [text, setText] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [coin, setCoin] = useState<Resolved | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canRead, setCanRead] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setCanRead(typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function");
  }, []);

  const look = async (value: string) => {
    const t = value.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    setCoin(null);
    try {
      const res = await fetch("/api/resolve-coin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.coin) throw new Error(j?.error ?? `lookup ${res.status}`);
      setCoin(j.coin as Resolved);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };
  const started = useRef(false);
  useEffect(() => {
    if (autoRun && initial && !started.current) {
      started.current = true;
      void look(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      setText(t);
      await look(t);
    } catch {
      input.current?.focus();
      setError("Your browser did not let me read the clipboard. Paste into the box instead.");
    }
  };
  const close = () => {
    setCoin(null);
    setError(null);
    setText("");
  };

  return (
    <div className="paste-check" style={{ marginBottom: 12 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void look(text);
        }}
        style={{ display: hideForm ? "none" : "flex", gap: 8 }}
      >
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const t = e.clipboardData.getData("text");
            if (t) {
              e.preventDefault();
              setText(t);
              void look(t);
            }
          }}
          placeholder="Paste a coin to check"
          aria-label="Paste a coin address or link"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          style={{ flex: 1, minWidth: 0, height: 40, padding: "0 12px", background: "#141418", color: brand.fg, border: "1px solid #2a2a2f", borderRadius: 8, fontSize: 16 }}
        />
        {canRead && !text && (
          <button type="button" onClick={() => void paste()} disabled={busy} style={{ ...btn, height: 40, padding: "0 14px", border: `1px solid ${brand.blueLine}` }}>
            Paste
          </button>
        )}
        <button type="submit" disabled={busy || !text.trim()} style={{ height: 40, padding: "0 16px", background: brand.blue, color: brand.fg, border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy || !text.trim() ? "default" : "pointer", opacity: busy || !text.trim() ? 0.55 : 1 }}>
          {busy ? "Looking…" : "Check"}
        </button>
      </form>
      {error && <div style={{ marginTop: 8, fontSize: 12, color: "#ff9f0a" }}>{error}</div>}
      {coin && <PastedCoin key={`${coin.chain}:${coin.mint}`} coin={coin} onClose={close} />}
    </div>
  );
}
