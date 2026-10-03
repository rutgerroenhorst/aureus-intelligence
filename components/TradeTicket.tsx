"use client";
import { usd, dexUrl, shortMint } from "../lib/format";
import { PriceChart } from "./PriceChart";
import { PotentialGauge, HolderBar } from "./VisualsStub";
import { DexChart } from "./DexChart";

/**
 * The order slip.
 *
 * Everything needed to place the trade and nothing else. The board it replaces led
 * with blockers, chips and gate names — true, but not what someone about to spend
 * money needs on screen. Levels come from observed structure; when a level is
 * missing it stays blank rather than being filled with a plausible number.
 */

const px = (v: number | null | undefined) => (v == null ? "—" : usd(v));
const pct = (v: number | null | undefined, dp = 1) =>
  v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(dp)}%`;

/** Position sized to the pool, then floored to something a person actually types. */
function suggestedSize(maxPositionUsd: number | null, defaultSize: number): number | null {
  if (maxPositionUsd == null || !Number.isFinite(maxPositionUsd)) return null;
  return Math.max(5, Math.min(defaultSize, Math.floor(maxPositionUsd)));
}

export function TradeTicket({
  v, live, defaultSizeUsd = 10,
}: { v: any; live: boolean; defaultSizeUsd?: number }) {
  const p = v.plan;
  const size = suggestedSize(p?.maxPositionUsd ?? null, defaultSizeUsd);
  const risk = p?.invalidation != null && v.priceUsd != null && v.priceUsd > 0
    ? (v.priceUsd - p.invalidation) / v.priceUsd : null;
  const reward = p?.target != null && v.priceUsd != null && v.priceUsd > 0
    ? (p.target - v.priceUsd) / v.priceUsd : null;

  return (
    <article className={`ticket ${live ? "is-live" : "is-wait"}`}>
      <header className="tk-head">
        <div className="tk-id">
          <span className="tk-sym">{v.symbol ?? "Unknown"}</span>
          <span className="tk-mint mono">{shortMint(v.mint)}</span>
        </div>
        <div className="tk-price">
          <span className="tk-now">{px(v.priceUsd)}</span>
          <span className="tk-lbl">nu</span>
          {v.runSinceFound != null && v.marketCapFirstSeen != null ? (
            <span className={`tk-run${v.runSinceFound >= 2 ? " hot" : ""}`}>
              {v.runSinceFound >= 1.15
                ? `${v.runSinceFound.toFixed(1)}× sinds wij hem vonden op ${usd(v.marketCapFirstSeen)}`
                : `gevonden op ${usd(v.marketCapFirstSeen)}`}
            </span>
          ) : null}
        </div>
      </header>

      {/* Levels are passed only when the plan is valid. Drawing a "koop" line from a
          plan the engine rejected would put a number on the chart that the ticket
          below refuses to show — the picture and the verdict must say one thing. */}
      <PriceChart
        points={v.priceSeries}
        entry={p?.valid ? p.entryAreaLow : null}
        stop={p?.valid ? p.invalidation : null}
        target={p?.valid ? p.target : null}
      />

      <div className="tk-pot-wrap">
        <PotentialGauge value={v.potential} lift={v.potentialLift} />
        <div className="tk-pot-why">
          {[...v.potentialHelps.slice(0, 2), ...v.potentialHurts.slice(0, 2)]
            .map((f) => f.label).join(" · ") || "geen uitgesproken factoren"}
        </div>
      </div>

      {/* Holder safety sits ABOVE the plan, because it is the thing you check first and
          it is most useful exactly when no plan exists yet. It used to live inside the
          `plan.valid` branch, so a coin still being assessed showed nothing at all. */}
      <div className={`tk-safety s-${(v.rugVerdict ?? "unknown").toLowerCase()}`}>
        <span className="tk-safety-k">Holders</span>
        <span>grootste <b>{v.largestHolderPct != null ? `${(v.largestHolderPct * 100).toFixed(1)}%` : "—"}</b></span>
        <span className="dim">top-5 {v.top5Pct != null ? `${(v.top5Pct * 100).toFixed(0)}%` : "—"}</span>
        <span className="tk-safety-v">
          {v.rugVerdict === "CLEAN" ? "geen rug-signaal"
            : v.rugVerdict === "WATCH" ? (v.rugConcerns[0] ?? "let op")
            : v.rugVerdict === "DANGER" ? "rug-risico"
            : v.holderTop10 != null ? "deels gemeten — rug-check nog niet rond"
            : "nog niet gecontroleerd"}
        </span>
      </div>

      <HolderBar
        largest={v.largestHolderPct != null ? v.largestHolderPct * 100 : null}
        top5={v.top5Pct != null ? v.top5Pct * 100 : null}
        top10={v.holderTop10 != null ? v.holderTop10 * 100 : null}
      />

      {v.rugVerdict === "DANGER" ? (
        <div className="tk-danger">
          <div className="tk-danger-h">Niet kopen — rug-risico</div>
          <ul>{v.rugBlocking.slice(0, 3).map((b, i) => <li key={i}>{b}</li>)}</ul>
        </div>
      ) : p && p.valid ? (
        <>
          <div className="tk-grid">
            <div className="tk-cell buy">
              <div className="tk-k">Koop tussen</div>
              <div className="tk-v">{px(p.entryAreaLow)} – {px(p.entryAreaHigh)}</div>
            </div>
            <div className="tk-cell">
              <div className="tk-k">Inzet</div>
              <div className="tk-v">{size != null ? `$${size}` : "—"}</div>
              <div className="tk-sub">deze pool draagt max ${p.maxPositionUsd != null ? Math.round(p.maxPositionUsd) : "—"}</div>
            </div>
            <div className="tk-cell stop">
              <div className="tk-k">Stop</div>
              <div className="tk-v">{px(p.invalidation)}</div>
              <div className="tk-sub">{risk != null ? `−${pct(risk, 0)} risico` : "geen niveau"}</div>
            </div>
            <div className="tk-cell target">
              <div className="tk-k">Doel</div>
              <div className="tk-v">{px(p.target)}</div>
              <div className="tk-sub">{reward != null ? `+${pct(reward, 0)}` : "—"}</div>
            </div>
          </div>

          <div className="tk-rules">
            <div className="tk-rule">
              <span className="tk-rk">Niet kopen boven</span>
              <b>{px(p.maxChase)}</b>
            </div>
            <div className="tk-rule">
              <span className="tk-rk">Kosten heen+terug</span>
              <b className={p.targetViable ? "ok" : "bad"}>{pct(p.roundTripCost)}</b>
              <span className="dim">break-even +{pct(p.breakevenMove, 0)}</span>
            </div>
            {risk != null && reward != null && risk > 0 ? (
              <div className="tk-rule">
                <span className="tk-rk">Verhouding</span>
                <b>{(reward / risk).toFixed(1)} : 1</b>
              </div>
            ) : null}
          </div>

          {p.exit ? (
            <div className="tk-exit">
              <span className="tk-exit-k">Uitstap</span>
              <span>neem <b>{Math.round(p.exit.firstTakePct * 100)}%</b> op <b>{px(p.exit.firstTakeAt)}</b></span>
              <span className="dim">stop dan naar {px(p.exit.stopAfterFirst)}</span>
              <span className="dim">· rest sluiten na {p.exit.timeStopMin} min</span>
            </div>
          ) : null}

          {!live ? (
            <div className="tk-wait">
              <span className="tk-wait-k">Wacht op</span>
              {p.requiredConfirmation}
            </div>
          ) : null}
        </>
      ) : (
        <div className="tk-noplan">
          Nog geen bruikbare niveaus — {p?.invalidReasons[0] ?? "structuur ontbreekt"}.
        </div>
      )}

      <footer className="tk-foot">
        <a className="tk-btn" href={dexUrl(v.mint, v.pool)} target="_blank" rel="noreferrer">
          Openen op Dexscreener ↗
        </a>
        <a className="tk-btn ghost" href={`/candidate/${v.id}`}>Details</a>
      </footer>

      <DexChart mint={v.mint} pool={v.pool} />
    </article>
  );
}
