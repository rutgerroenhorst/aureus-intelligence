"use client";
import { useState } from "react";
import { dexUrl } from "../lib/format";

/**
 * The Dexscreener candlestick chart, embedded.
 *
 * Kept BESIDE our own chart rather than replacing it, because the two answer different
 * questions. Ours plots the exact series the engine judged and carries the entry, stop
 * and target lines, so the picture and the verdict cannot drift apart. This one has
 * candles, volume and depth we do not reproduce.
 *
 * Loaded on demand: an iframe per row would mean a dozen third-party frames polling in
 * the background, which is slow and hands Dexscreener a view of everything on the
 * watchlist. One click, one frame.
 */
export function DexChart({ mint, pool, defaultOpen = false }: { mint: string; pool?: string | null; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const target = pool ?? mint;
  const src = `https://dexscreener.com/solana/${target}?embed=1&theme=dark&trades=0&info=0`;

  return (
    <section className="dexc">
      <div className="dexc-bar">
        <button type="button" className="btn ghost dexc-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Verberg Dexscreener-chart" : "Toon Dexscreener-chart"}
        </button>
        <a className="dexc-out" href={dexUrl(mint, pool)} target="_blank" rel="noopener noreferrer">
          openen op dexscreener ↗
        </a>
      </div>
      {open ? (
        <div className="dexc-frame">
          <iframe
            src={src}
            title="Dexscreener chart"
            loading="lazy"
            // The frame is third-party content: no same-origin access to this page, and
            // no ability to navigate the top window out from under the user.
            sandbox="allow-scripts allow-same-origin allow-popups"
            referrerPolicy="no-referrer"
          />
        </div>
      ) : null}
    </section>
  );
}
