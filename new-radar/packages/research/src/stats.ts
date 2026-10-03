/** Deterministic descriptive statistics for the research reports. No modeling. */

export function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Fraction of values strictly greater than `threshold` (default 0 = "up"). */
export function winrate(xs: number[], threshold = 0): number | null {
  if (xs.length === 0) return null;
  return xs.filter((x) => x > threshold).length / xs.length;
}

export function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[idx]!;
}

function variance(xs: number[], m: number): number {
  if (xs.length < 2) return 0;
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
}

export interface SignificanceResult {
  nA: number;
  nB: number;
  meanA: number | null;
  meanB: number | null;
  diff: number | null;
  t: number | null;
  /** true only when both samples are large enough AND |t| clears the ~p<0.05 bar. */
  significant: boolean;
  note: string;
}

/**
 * Welch's t-statistic between two return samples. We deliberately do NOT emit a
 * probability/p-value; we report the statistic and a conservative significance
 * flag (both n >= MIN_N and |t| > 2). Small or degenerate samples are labelled
 * "insufficient" rather than over-interpreted.
 */
export function welchSignificance(a: number[], b: number[], minN = 20): SignificanceResult {
  const nA = a.length;
  const nB = b.length;
  const mA = mean(a);
  const mB = mean(b);
  if (nA < 2 || nB < 2 || mA == null || mB == null) {
    return { nA, nB, meanA: mA, meanB: mB, diff: mA != null && mB != null ? mA - mB : null, t: null, significant: false, note: "insufficient sample" };
  }
  const vA = variance(a, mA);
  const vB = variance(b, mB);
  const se = Math.sqrt(vA / nA + vB / nB);
  const t = se === 0 ? null : (mA - mB) / se;
  const enough = nA >= minN && nB >= minN;
  const significant = enough && t != null && Math.abs(t) > 2;
  return {
    nA, nB, meanA: mA, meanB: mB, diff: mA - mB, t,
    significant,
    note: !enough ? `insufficient sample (need ≥${minN} per group)` : t == null ? "no variance" : significant ? "difference clears |t|>2" : "no measurable difference",
  };
}
