import { brand, WORDMARK_FONT } from "@/lib/brand";

// The mark: a heavy A without its crossbar, leaning forward, with a coin where the bar would be.
// The lean is applied to the points (not as a skew), so the coin stays a true circle.
// The same geometry as brand/auriga/make_auriga.py, which draws the logo sheets and the app icons.
const LEAN = 0.18;
const POINTS: Array<[number, number]> = [[-90, 80], [0, -86], [90, 80], [58, 80], [0, -30], [-58, 80]];
const LEGS = "M" + POINTS.map(([x, y]) => `${(x + LEAN * (80 - y)).toFixed(1)} ${y}`).join(" L") + "Z";
const COIN = { cx: Number((2.5 + LEAN * (80 - 47)).toFixed(1)), cy: 47, r: 23 };
const BOX = { x: -96, y: -92, w: 192, h: 178 };

/** The mark alone. `size` is its height in px. */
export function AurigaMark({ size = 28, leg = brand.fg, coin = brand.blue }: { size?: number; leg?: string; coin?: string }) {
  return (
    <svg viewBox={`${BOX.x} ${BOX.y} ${BOX.w} ${BOX.h}`} width={(size * BOX.w) / BOX.h} height={size} xmlns="http://www.w3.org/2000/svg" role="img" aria-label={brand.name}>
      <path d={LEGS} fill={leg} stroke={leg} strokeWidth={3} strokeLinejoin="round" />
      <circle cx={COIN.cx} cy={COIN.cy} r={COIN.r} fill={coin} />
    </svg>
  );
}

/** AURIGA in wide-tracked Jost Bold. `size` is the font size in px. */
export function AurigaWordmark({ size = 15, color = brand.fg }: { size?: number; color?: string }) {
  return <span style={{ fontFamily: WORDMARK_FONT, fontWeight: 700, fontSize: size, letterSpacing: "0.14em", color, lineHeight: 1 }}>AURIGA</span>;
}
