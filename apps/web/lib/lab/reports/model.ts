/**
 * Two small models per decision moment: how likely is this coin to double (go2), and how likely is it to lose half within a
 * day (collapse24)? Plain logistic regression on a dozen features, judged ONLY on coins that appeared after the ones it was
 * trained on. When it cannot beat chance on those coins the page says so and the odds are not used for anything.
 */

import type { LabCoin } from "../builder";
import { FEATURES, modelValue, type Features } from "../features";
import { aucTest, calibration, fitLogistic, median, predictLogistic, type LogisticModel } from "../stats";
import { num, rowsFor, splitTime, type Row } from "./common";

export type ModelTarget = "go2" | "collapse24";
export const MODEL_TAUS = [1, 3, 6, 12, 24];

const MODEL_FEATURES = FEATURES.filter((f) => f.model);

export interface Spec {
  /** columns in order: a transformed value, or a 0/1 "was missing" indicator */
  cols: Array<{ key: string; kind: "value" | "missing"; transform?: "log10" | "slog" | "id"; median?: number }>;
}

export interface Trained {
  tau: number;
  target: ModelTarget;
  spec: Spec;
  model: LogisticModel;
  n: number;
  positives: number;
}

function buildSpec(rows: Row[]): Spec {
  const cols: Spec["cols"] = [];
  for (const f of MODEL_FEATURES) {
    const vals = rows.map((r) => r.f[f.key]).filter(num);
    if (vals.length < rows.length * 0.5 || vals.length < 40) continue; // mostly unknown: leave it out
    const t = f.model!.transform;
    cols.push({ key: f.key, kind: "value", transform: t, median: median(vals.map((v) => modelValue(t, v))) });
    if (f.model!.usesMissing && vals.length < rows.length) cols.push({ key: f.key, kind: "missing" });
  }
  return { cols };
}

export function vectorOf(spec: Spec, f: Features): number[] {
  return spec.cols.map((c) => {
    const v = f[c.key];
    if (c.kind === "missing") return num(v) ? 0 : 1;
    return num(v) ? modelValue(c.transform!, v) : c.median!;
  });
}

export function fitModel(rows: Row[], target: ModelTarget, tau: number, l2 = 3): Trained | null {
  const use = rows.filter((r) => r.y[target] != null);
  const positives = use.filter((r) => r.y[target] === true).length;
  if (use.length < 80 || positives < 12 || use.length - positives < 12) return null;
  const spec = buildSpec(use);
  if (spec.cols.length < 3) return null;
  const X = use.map((r) => vectorOf(spec, r.f));
  const y: number[] = use.map((r) => (r.y[target] ? 1 : 0));
  const model = fitLogistic(X, y, { l2 });
  if (!model) return null;
  return { tau, target, spec, model, n: use.length, positives };
}

export const predict = (m: Trained, f: Features): number => predictLogistic(m.model, vectorOf(m.spec, f));

export interface ModelEval {
  tau: number;
  target: ModelTarget;
  nTrain: number;
  nTest: number;
  positivesTest: number;
  baseTest: number;
  auc: { auc: number; lo: number; hi: number; p: number } | null;
  /** the best 20% by predicted probability, on the test coins: how often the target happened there vs overall */
  top20: { n: number; rate: number; lift: number } | null;
  calibration: Array<{ meanPred: number; observed: number; n: number }>;
  coefs: Array<{ key: string; label: string; coef: number }>;
  valid: boolean;
  note: string;
}

const labelOf = (key: string) => FEATURES.find((f) => f.key === key)?.label ?? key;

export function evaluateModel(rows: Row[], target: ModelTarget, tau: number): ModelEval | null {
  const use = rows.filter((r) => r.y[target] != null);
  const [train, test] = splitTime(use, 0.6);
  const tr = fitModel(train, target, tau);
  if (!tr || test.length < 30) return null;
  const preds = test.map((r) => predict(tr, r.f));
  const ys: number[] = test.map((r) => (r.y[target] ? 1 : 0));
  const pos = preds.filter((_, i) => ys[i] === 1);
  const neg = preds.filter((_, i) => ys[i] === 0);
  const a = aucTest(pos, neg, 8);
  const base = ys.reduce((s, v) => s + v, 0) / ys.length;
  const order = preds.map((_, i) => i).sort((i, j) => preds[j]! - preds[i]!);
  const k = Math.max(10, Math.floor(test.length * 0.2));
  const top = order.slice(0, k);
  const topRate = top.reduce((s, i) => s + ys[i]!, 0) / top.length;
  const coefs = tr.spec.cols
    .map((c, i) => ({ key: c.kind === "missing" ? `${c.key} (unknown)` : c.key, label: c.kind === "missing" ? `${labelOf(c.key)} unknown` : labelOf(c.key), coef: tr.model.coef[i]! }))
    .sort((x, y) => Math.abs(y.coef) - Math.abs(x.coef));
  const valid = !!a && a.lo > 0.55 && pos.length >= 12;
  return {
    tau, target, nTrain: train.length, nTest: test.length, positivesTest: pos.length, baseTest: base,
    auc: a ? { auc: a.auc, lo: a.lo, hi: a.hi, p: a.p } : null,
    top20: { n: top.length, rate: topRate, lift: base > 0 ? topRate / base : 0 },
    calibration: calibration(preds, ys, 5),
    coefs: coefs.slice(0, 10),
    valid,
    note: !a ? "Not enough coins on the test side." : valid ? "Beats chance on coins it never saw." : a.lo <= 0.5 ? "Not better than chance on coins it never saw." : "Slightly better than chance, but the interval is too wide to rely on.",
  };
}

export interface ModelsReport {
  evals: ModelEval[];
  /** trained on every coin, for the live view; stored compactly */
  final: Array<{ tau: number; target: ModelTarget; spec: Spec; model: LogisticModel; n: number; positives: number }>;
}

export function buildModels(coins: LabCoin[]): { report: ModelsReport; trained: Trained[] } {
  const evals: ModelEval[] = [];
  const trained: Trained[] = [];
  for (const tau of MODEL_TAUS) {
    const rows = rowsFor(coins, tau, { standing: true });
    for (const target of ["go2", "collapse24"] as const) {
      const e = evaluateModel(rows, target, tau);
      if (e) evals.push(e);
      const t = fitModel(rows, target, tau);
      if (t) trained.push(t);
    }
  }
  return { report: { evals, final: trained.map((t) => ({ tau: t.tau, target: t.target, spec: t.spec, model: t.model, n: t.n, positives: t.positives })) }, trained };
}

/**
 * Predictions for every row from models that never saw that row's time block: the coins are cut into time blocks, and each
 * block is predicted by a model fitted on the others. Used where a table needs odds for the whole sample (zones, filters).
 */
export function crossFit(rows: Row[], target: ModelTarget, tau: number, folds = 5): Map<Row, number> {
  const use = rows.filter((r) => r.y[target] != null).sort((a, b) => a.t0 - b.t0);
  const out = new Map<Row, number>();
  const size = Math.ceil(use.length / folds);
  for (let k = 0; k < folds; k++) {
    const hold = use.slice(k * size, (k + 1) * size);
    const rest = [...use.slice(0, k * size), ...use.slice((k + 1) * size)];
    const m = fitModel(rest, target, tau);
    if (!m) continue;
    for (const r of hold) out.set(r, predict(m, r.f));
  }
  return out;
}
