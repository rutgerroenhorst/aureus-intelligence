"use client";

import { POTENTIAL_BASE_RATE } from "@aureus/watch-engine";

/**
 * The measured potential, drawn against the base rate rather than against 100%.
 *
 * A bar that fills toward 100 invites reading 40% as "not great". The number that
 * matters is how it compares to an average coin (20%), so the base rate is marked on
 * the track and the bar is scaled to 3x it. Above that the bar pins and the label
 * carries the value — a chart that keeps stretching would imply precision we do not
 * have at the tail.
 */
export function PotentialGauge({ value, lift }: { value: number | null; lift: number | null }) {
  if (value == null) {
    return <div className="gauge unk" title="te weinig meetbare factoren voor een schatting">geen schatting</div>;
  }
  const max = POTENTIAL_BASE_RATE * 3;
  const pct = Math.min(100, (value / max) * 100);
  const basePct = (POTENTIAL_BASE_RATE / max) * 100;
  const tone = value >= 0.35 ? "good" : value <= 0.12 ? "poor" : "mid";
  return (
    <div className="gauge">
      <div className="gauge-head">
        <span className={`gauge-val ${tone}`}>{Math.round(value * 100)}%</span>
        {lift != null ? (
          <span className="gauge-lift">
            {lift.toFixed(2)}× het gemiddelde van {Math.round(POTENTIAL_BASE_RATE * 100)}%
          </span>
        ) : null}
      </div>
      <div className="gauge-track" role="img" aria-label={`${Math.round(value * 100)} procent, gemiddelde ${Math.round(POTENTIAL_BASE_RATE * 100)} procent`}>
        <div className={`gauge-fill ${tone}`} style={{ width: `${pct}%` }} />
        <div className="gauge-base" style={{ left: `${basePct}%` }} title="gemiddelde coin" />
      </div>
    </div>
  );
}

/**
 * Wallet concentration. Thresholds are the rug-risk engine's, not invented here, so the
 * colour and the verdict can never disagree.
 */
export function HolderBar({ largest, top5, top10 }: { largest: number | null; top5: number | null; top10: number | null }) {
  const rows: Array<[string, number | null, number]> = [
    ["grootste", largest, 10],
    ["top 5", top5, 30],
    ["top 10", top10, 50],
  ];
  if (rows.every(([, v]) => v == null)) {
    return <div className="holders-unk">holderverdeling nog niet gemeten</div>;
  }
  return (
    <div className="holders">
      {rows.map(([label, v, limit]) => (
        <div className="hrow" key={label}>
          <span className="hlab">{label}</span>
          <div className="htrack">
            {v != null ? <div className={`hfill${v > limit ? " over" : ""}`} style={{ width: `${Math.min(100, (v / limit) * 100)}%` }} /> : null}
            <div className="hlimit" title={`grens ${limit}%`} />
          </div>
          <span className={`hval${v != null && v > limit ? " over" : ""}`}>{v != null ? `${v.toFixed(1)}%` : "—"}</span>
        </div>
      ))}
    </div>
  );
}

/** Round-trip cost against the move needed to break even — the thing that kills small trades. */
export function CostBar({ roundTrip, breakeven }: { roundTrip: number | null; breakeven: number | null }) {
  if (roundTrip == null) return null;
  const pct = roundTrip * 100;
  // 10% round trip is the point past which the cost model refuses the size.
  const tone = pct >= 10 ? "poor" : pct >= 5 ? "mid" : "good";
  return (
    <div className="costbar">
      <span className="clab">heen en terug</span>
      <div className="ctrack">
        <div className={`cfill ${tone}`} style={{ width: `${Math.min(100, (pct / 10) * 100)}%` }} />
      </div>
      <span className={`cval ${tone}`}>{pct.toFixed(1)}%</span>
      {breakeven != null ? <span className="cnote">+{(breakeven * 100).toFixed(1)}% om quitte te staan</span> : null}
    </div>
  );
}
