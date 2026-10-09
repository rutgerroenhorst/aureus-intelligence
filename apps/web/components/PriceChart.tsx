"use client";

/**
 * Price chart drawn from OUR OWN observations — the same series the engine judged.
 *
 * Deliberately not an embedded third-party widget. A Dexscreener iframe would show a
 * prettier chart of a slightly different dataset, and the moment the picture and the
 * verdict disagree the user has no way to tell which one is lying. This renders what
 * we actually measured, gaps and all.
 */
export function PriceChart({
  points, entry, stop, target, height = 96,
}: {
  points: Array<{ t: number; p: number }>;
  entry?: number | null;
  stop?: number | null;
  target?: number | null;
  height?: number;
}) {
  // Two points is a line between two dots, not a chart. Say so rather than drawing
  // something that implies a trend we never observed.
  if (points.length < 3) {
    return (
      <div className="chart-empty" style={{ height }}>
        {points.length === 0 ? "nog geen metingen" : `${points.length} meting${points.length > 1 ? "en" : ""} — te weinig voor een grafiek`}
      </div>
    );
  }

  const W = 600;
  const H = height;
  const PAD = 4;
  const ts = points.map((d) => d.t);
  const ps = points.map((d) => d.p);
  // Levels share the price axis, so they must share its bounds — otherwise a stop
  // below every observed price silently clips to the floor and looks like it was hit.
  const levels = [entry, stop, target].filter((v): v is number => typeof v === "number" && v > 0);
  const lo = Math.min(...ps, ...levels);
  const hi = Math.max(...ps, ...levels);
  const span = hi - lo || hi || 1;
  const t0 = Math.min(...ts);
  const tSpan = Math.max(...ts) - t0 || 1;

  const x = (t: number) => PAD + ((t - t0) / tSpan) * (W - PAD * 2);
  const y = (p: number) => PAD + (1 - (p - lo) / span) * (H - PAD * 2);

  const line = points.map((d, i) => `${i === 0 ? "M" : "L"}${x(d.t).toFixed(1)},${y(d.p).toFixed(1)}`).join(" ");
  const area = `${line} L${x(ts[ts.length - 1]!).toFixed(1)},${H - PAD} L${x(t0).toFixed(1)},${H - PAD} Z`;
  const first = ps[0]!;
  const last = ps[ps.length - 1]!;
  const up = last >= first;
  const changePct = ((last - first) / first) * 100;

  const level = (v: number | null | undefined, cls: string, label: string) => {
    if (typeof v !== "number" || !(v > 0)) return null;
    const yy = y(v);
    return (
      <g key={label}>
        <line className={`lvl ${cls}`} x1={PAD} x2={W - PAD} y1={yy} y2={yy} />
        {/* Left-anchored: the line always ENDS on the right, so a right-aligned label
            sits exactly on top of the current price — the one point you most need to
            read. The left edge is the oldest observation and is usually clear. */}
        <text className={`lvl-t ${cls}`} x={PAD + 2} y={yy - 3} textAnchor="start">{label}</text>
      </g>
    );
  };

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
           aria-label={`Prijs over ${Math.round(tSpan / 60000)} minuten, ${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%`}>
        <defs>
          <linearGradient id={up ? "cg-up" : "cg-dn"} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={up ? "var(--up)" : "var(--down)"} stopOpacity="0.28" />
            <stop offset="100%" stopColor={up ? "var(--up)" : "var(--down)"} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="chart-area" d={area} fill={`url(#${up ? "cg-up" : "cg-dn"})`} />
        <path className={`chart-line${up ? " up" : " dn"}`} d={line} />
        {level(target, "tg", "doel")}
        {level(entry, "en", "koop")}
        {level(stop, "st", "stop")}
        <circle className={`chart-dot${up ? " up" : " dn"}`} cx={x(ts[ts.length - 1]!)} cy={y(last)} r="3" />
      </svg>
      <div className="chart-foot">
        <span>{points.length} metingen · {Math.round(tSpan / 60000)} min</span>
        <span className={up ? "up" : "dn"}>{changePct >= 0 ? "+" : ""}{changePct.toFixed(1)}%</span>
      </div>
    </div>
  );
}
