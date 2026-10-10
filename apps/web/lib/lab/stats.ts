/**
 * Statistics for the Learning Lab. Pure functions, no I/O, so every number the page shows can be tested.
 *
 * The lab works with rare events (a few percent of coins ever hold 3x), so almost everything here is about not
 * fooling ourselves: intervals next to every rate, exact tests for small counts, a false-discovery correction across the
 * many things the lab looks at, and a model that is judged only on coins it was not trained on.
 */

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, absolute error below 1e-7). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/** Deterministic random numbers (mulberry32): the same data always gives the same report. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Linear-interpolated quantile, q in [0,1]. */
export function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** Wilson score interval for a rate. z = 1.645 gives a 90% interval. */
export function wilson(k: number, n: number, z = 1.645): { p: number; lo: number; hi: number } {
  if (n <= 0) return { p: NaN, lo: NaN, hi: NaN };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const a = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { p, lo: Math.max(0, (c - a) / d), hi: Math.min(1, (c + a) / d) };
}

const logFactCache: number[] = [0, 0];
function logFact(n: number): number {
  for (let i = logFactCache.length; i <= n; i++) logFactCache[i] = logFactCache[i - 1]! + Math.log(i);
  return logFactCache[n]!;
}
const logChoose = (n: number, k: number) => logFact(n) - logFact(k) - logFact(n - k);

/** Two-sided Fisher exact test for [[a, b], [c, d]]. */
export function fisherExact(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d;
  const r1 = a + b;
  const c1 = a + c;
  if (n === 0) return 1;
  const lp = (x: number) => logChoose(r1, x) + logChoose(n - r1, c1 - x) - logChoose(n, c1);
  const obs = lp(a);
  let p = 0;
  for (let x = Math.max(0, c1 - (n - r1)); x <= Math.min(r1, c1); x++) {
    const v = lp(x);
    if (v <= obs + 1e-9) p += Math.exp(v);
  }
  return Math.min(1, p);
}

export interface AucResult {
  auc: number;
  n1: number;
  n0: number;
  /** two-sided normal-approximation p-value against AUC = 0.5 */
  p: number;
  lo: number;
  hi: number;
}

/**
 * Area under the ROC curve = the chance a random positive scores higher than a random negative (ties count half),
 * from ranks. The interval is Hanley-McNeil's, the p-value the Mann-Whitney normal approximation. null when either
 * side has fewer than `minSide` rows: too few to say anything.
 */
export function aucTest(pos: number[], neg: number[], minSide = 5, z = 1.645): AucResult | null {
  const n1 = pos.length;
  const n0 = neg.length;
  if (n1 < minSide || n0 < minSide) return null;
  const all = [...pos.map((v) => ({ v, y: 1 })), ...neg.map((v) => ({ v, y: 0 }))].sort((a, b) => a.v - b.v);
  let rankSum = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j < all.length && all[j]!.v === all[i]!.v) j++;
    const avg = (i + j + 1) / 2;
    for (let k = i; k < j; k++) if (all[k]!.y === 1) rankSum += avg;
    i = j;
  }
  const auc = (rankSum - (n1 * (n1 + 1)) / 2) / (n1 * n0);
  const q1 = auc / (2 - auc);
  const q2 = (2 * auc * auc) / (1 + auc);
  const se = Math.sqrt((auc * (1 - auc) + (n1 - 1) * (q1 - auc * auc) + (n0 - 1) * (q2 - auc * auc)) / (n1 * n0));
  const se0 = Math.sqrt((n1 + n0 + 1) / (12 * n1 * n0));
  const zs = (auc - 0.5) / se0;
  return { auc, n1, n0, p: Math.min(1, 2 * (1 - normalCdf(Math.abs(zs)))), lo: Math.max(0, auc - z * se), hi: Math.min(1, auc + z * se) };
}

/** Benjamini-Hochberg false-discovery-rate adjustment. Returns q-values in the input order. */
export function bhFdr(ps: number[]): number[] {
  const m = ps.length;
  const order = ps.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const q = new Array<number>(m);
  let prev = 1;
  for (let k = m - 1; k >= 0; k--) {
    const v = Math.min(prev, (order[k]!.p * m) / (k + 1));
    q[order[k]!.i] = Math.min(1, v);
    prev = v;
  }
  return q;
}

/** Bootstrap interval for a mean (resampling coins, not observations). z-free: the 5th and 95th percentile. */
export function bootMeanCi(values: number[], B = 400, seed = 1): { mean: number; lo: number; hi: number } {
  const n = values.length;
  if (n === 0) return { mean: NaN, lo: NaN, hi: NaN };
  const rand = rng(seed);
  const means: number[] = [];
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += values[Math.floor(rand() * n)]!;
    means.push(s / n);
  }
  means.sort((a, b) => a - b);
  return { mean: mean(values), lo: means[Math.floor(0.05 * B)]!, hi: means[Math.min(B - 1, Math.floor(0.95 * B))]! };
}

/** Bootstrap interval for the difference of two means (a - b). */
export function bootDiffCi(a: number[], b: number[], B = 400, seed = 2): { diff: number; lo: number; hi: number } {
  if (!a.length || !b.length) return { diff: NaN, lo: NaN, hi: NaN };
  const rand = rng(seed);
  const diffs: number[] = [];
  for (let k = 0; k < B; k++) {
    let sa = 0;
    let sb = 0;
    for (let i = 0; i < a.length; i++) sa += a[Math.floor(rand() * a.length)]!;
    for (let i = 0; i < b.length; i++) sb += b[Math.floor(rand() * b.length)]!;
    diffs.push(sa / a.length - sb / b.length);
  }
  diffs.sort((x, y) => x - y);
  return { diff: mean(a) - mean(b), lo: diffs[Math.floor(0.05 * B)]!, hi: diffs[Math.min(B - 1, Math.floor(0.95 * B))]! };
}

// ── Logistic regression ───────────────────────────────────────────────────────────────────────────────────────

export interface LogisticModel {
  /** weights on the standardised features */
  coef: number[];
  intercept: number;
  means: number[];
  sds: number[];
  iterations: number;
  converged: boolean;
}

const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

/** Solve A x = b for a small dense system (Gaussian elimination with partial pivoting). */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    if (Math.abs(M[piv]![c]!) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv]!, M[c]!];
    for (let r = c + 1; r < n; r++) {
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r]![n]!;
    for (let k = r + 1; k < n; k++) s -= M[r]![k]! * x[k]!;
    x[r] = s / M[r]![r]!;
  }
  return x;
}

/** Ridge-penalised logistic regression by IRLS. Features are standardised inside; rows must be complete numbers. */
export function fitLogistic(X: number[][], y: number[], opts: { l2?: number; maxIter?: number } = {}): LogisticModel | null {
  const n = X.length;
  const p = n ? X[0]!.length : 0;
  if (n < 20 || p === 0) return null;
  const l2 = opts.l2 ?? 1;
  const means = Array.from({ length: p }, (_, j) => mean(X.map((r) => r[j]!)));
  const sds = Array.from({ length: p }, (_, j) => {
    const m = means[j]!;
    const v = X.reduce((s, r) => s + (r[j]! - m) ** 2, 0) / n;
    return Math.sqrt(v) || 1;
  });
  const Z = X.map((r) => [1, ...r.map((v, j) => (v - means[j]!) / sds[j]!)]);
  const d = p + 1;
  let beta = new Array<number>(d).fill(0);
  let converged = false;
  let it = 0;
  for (; it < (opts.maxIter ?? 30); it++) {
    const g = new Array<number>(d).fill(0);
    const H = Array.from({ length: d }, () => new Array<number>(d).fill(0));
    for (let i = 0; i < n; i++) {
      let eta = 0;
      for (let j = 0; j < d; j++) eta += Z[i]![j]! * beta[j]!;
      const pr = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(eta)));
      const w = pr * (1 - pr);
      const r = y[i]! - pr;
      for (let j = 0; j < d; j++) {
        g[j]! += Z[i]![j]! * r;
        for (let k = j; k < d; k++) H[j]![k]! += w * Z[i]![j]! * Z[i]![k]!;
      }
    }
    for (let j = 1; j < d; j++) {
      g[j]! -= l2 * beta[j]!;
      H[j]![j]! += l2;
    }
    for (let j = 0; j < d; j++) for (let k = 0; k < j; k++) H[j]![k] = H[k]![j]!;
    const step = solve(H, g);
    if (!step) break;
    let maxStep = 0;
    beta = beta.map((b, j) => {
      maxStep = Math.max(maxStep, Math.abs(step[j]!));
      return b + step[j]!;
    });
    if (maxStep < 1e-6) {
      converged = true;
      it++;
      break;
    }
  }
  return { coef: beta.slice(1), intercept: beta[0]!, means, sds, iterations: it, converged };
}

export function predictLogistic(m: LogisticModel, x: number[]): number {
  let eta = m.intercept;
  for (let j = 0; j < m.coef.length; j++) eta += m.coef[j]! * ((x[j]! - m.means[j]!) / m.sds[j]!);
  return sigmoid(eta);
}

/** Predicted-probability bins against what really happened, equal-count bins. */
export function calibration(pred: number[], y: number[], bins = 5): Array<{ meanPred: number; observed: number; n: number }> {
  const idx = pred.map((p, i) => i).sort((a, b) => pred[a]! - pred[b]!);
  const out: Array<{ meanPred: number; observed: number; n: number }> = [];
  for (let b = 0; b < bins; b++) {
    const seg = idx.slice(Math.floor((b * idx.length) / bins), Math.floor(((b + 1) * idx.length) / bins));
    if (!seg.length) continue;
    out.push({ meanPred: mean(seg.map((i) => pred[i]!)), observed: mean(seg.map((i) => y[i]!)), n: seg.length });
  }
  return out;
}

/** Equal-count bin edges for a numeric column: k bins need k-1 inner edges. */
export function quantileEdges(values: number[], k: number): number[] {
  const edges: number[] = [];
  for (let i = 1; i < k; i++) {
    const e = quantile(values, i / k);
    if (!edges.length || e > edges[edges.length - 1]!) edges.push(e);
  }
  return edges;
}

/** Which bin (0-based) a value falls in, given inner edges. */
export function binOf(v: number, edges: number[]): number {
  let b = 0;
  while (b < edges.length && v >= edges[b]!) b++;
  return b;
}
