/**
 * The coins being followed right now, with the lab's odds for each: the chance it doubles, the chance it loses half within a
 * day, which of four zones it sits in, and plain-language flags. Odds are only shown when the model behind them has been
 * checked on coins it never saw; otherwise the coin is listed with its flags and no number.
 */

import type { LabCoin } from "../builder";
import type { Features } from "../features";
import { RULES } from "./rulesboard";
import { binOf, median, quantileEdges } from "../stats";
import { isStanding, num, rate, rowsFor, type Rate, type Row } from "./common";
import { crossFit, MODEL_TAUS, predict, type ModelsReport, type ModelTarget, type Trained } from "./model";

export interface LiveCoin {
  mint: string;
  symbol: string | null;
  name: string | null;
  ageH: number;
  mcap: number | null;
  liq: number | null;
  mult: number | null;
  dd: number | null;
  /** what happened to coins the model scored like this one (on coins it had not seen); null = no checked model for this age */
  go2: Rate | null;
  collapse24: Rate | null;
  zone: "steady" | "burner" | "knife" | "zombie" | "fallen" | null;
  flags: string[];
  tags: string[];
  /** the decision moment (hours) whose checked model produced the odds */
  oddsAt: { go2: number | null; collapse24: number | null };
}

export interface LiveReport {
  coins: LiveCoin[];
  /** which models back the numbers: false = no model for that target beat chance on later coins, so no odds are shown */
  trusted: { go2: boolean; collapse24: boolean };
  /** the decision moments at which a model beat chance on later coins */
  checkedAt: { go2: number[]; collapse24: number[] };
  note: string;
}

/** A coin's age picks the nearest checked moment, but only within a factor of two: a model for 6 h says nothing about a 20 h coin. */
export function pickTau(ageH: number, taus: number[]): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const t of taus) {
    const d = Math.abs(Math.log(ageH / t));
    if (d <= Math.log(2) && d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

export interface Calib {
  edges: number[];
  bins: Rate[];
}

/**
 * Turns a model score into what really happened to coins with a similar score, so that the number shown cannot be
 * more extreme than anything observed: scores come from models that never saw the coin they scored (time blocks), cut into
 * five equal groups, with the outcome rate of each group.
 */
export function calibrate(rows: Row[], target: ModelTarget, tau: number): Calib | null {
  const pairs = [...crossFit(rows, target, tau).entries()].map(([r, p]) => ({ p, y: r.y[target] ? 1 : 0 }));
  if (pairs.length < 60) return null;
  const edges = quantileEdges(pairs.map((x) => x.p), 5);
  const k = new Array<number>(edges.length + 1).fill(0);
  const n = new Array<number>(edges.length + 1).fill(0);
  for (const x of pairs) {
    const b = binOf(x.p, edges);
    n[b]!++;
    k[b]! += x.y;
  }
  return { edges, bins: n.map((nn, i) => rate(k[i]!, nn)) };
}

const gateRule = RULES.find((r) => r.id === "gate_all_dump")!;
const oneWallet = RULES.find((r) => r.id === "engine_one_wallet")!;

export function buildLive(coins: LabCoin[], trained: Trained[], models: ModelsReport, nowS: number): LiveReport {
  const checkedAt = {
    go2: models.evals.filter((e) => e.target === "go2" && e.valid).map((e) => e.tau),
    collapse24: models.evals.filter((e) => e.target === "collapse24" && e.valid).map((e) => e.tau),
  };
  const trusted = { go2: checkedAt.go2.length > 0, collapse24: checkedAt.collapse24.length > 0 };
  const modelFor = (target: ModelTarget, tau: number) => trained.find((t) => t.tau === tau && t.target === target);
  // calibration only for the moments whose model beat chance on later coins
  const calib = new Map<string, Calib>();
  for (const target of ["go2", "collapse24"] as const) {
    for (const tau of checkedAt[target]) {
      const c = calibrate(rowsFor(coins, tau, { standing: true }), target, tau);
      if (c) calib.set(`${target}:${tau}`, c);
    }
  }
  // zone cut points: the medians of the models' own predictions over the coins they were fitted on
  const cuts = new Map<number, { o: number; r: number }>();
  for (const tau of MODEL_TAUS) {
    const g = modelFor("go2", tau);
    const c = modelFor("collapse24", tau);
    if (!g || !c) continue;
    const rows = rowsFor(coins, tau, { standing: true });
    if (rows.length < 50) continue;
    cuts.set(tau, { o: median(rows.map((r) => predict(g, r.f))), r: median(rows.map((r) => predict(c, r.f))) });
  }
  const oddsOf = (target: ModelTarget, tau: number | null, f: Features): Rate | null => {
    if (tau == null) return null;
    const m = modelFor(target, tau);
    const c = calib.get(`${target}:${tau}`);
    if (!m || !c) return null;
    return c.bins[binOf(predict(m, f), c.edges)] ?? null;
  };
  const out: LiveCoin[] = [];
  for (const coin of coins) {
    const now = coin.outcome.now;
    if (!now || coin.status !== "open" || nowS - now.ts > 6 * 3600 || now.ageH > 96) continue;
    const f = now.f;
    const standing = isStanding(f);
    // The models were fitted on coins that still stand; for a coin that already fell apart they say nothing.
    const tauG = standing ? pickTau(now.ageH, checkedAt.go2.filter((t) => calib.has(`go2:${t}`))) : null;
    const tauC = standing ? pickTau(now.ageH, checkedAt.collapse24.filter((t) => calib.has(`collapse24:${t}`))) : null;
    const go2 = oddsOf("go2", tauG, f);
    const col = oddsOf("collapse24", tauC, f);
    // the kind needs both models at the same moment
    const cut = tauG != null && tauG === tauC ? cuts.get(tauG) : undefined;
    const g = tauG != null ? modelFor("go2", tauG) : undefined;
    const c = tauC != null ? modelFor("collapse24", tauC) : undefined;
    const zone = !standing ? "fallen" : cut && g && c ? (predict(c, f) >= cut.r ? (predict(g, f) >= cut.o ? "burner" : "knife") : predict(g, f) >= cut.o ? "steady" : "zombie") : null;
    const flags: string[] = [];
    if (num(f.vol_decay) && f.vol_decay < 0.05) flags.push("volume has dried up");
    if (num(f.dd) && f.dd >= 0.99) flags.push("standing at its own high");
    if (num(f.dd) && f.dd <= 0.3) flags.push("more than 70% below its high");
    if (num(f.pc_h24) && f.pc_h24 <= -74 && num(f.trades_h1) && f.trades_h1 < 62) flags.push("down 74%+ in a day and barely traded");
    if (num(f.liq_mcap) && f.liq_mcap < 0.15) flags.push("thin pool for its value");
    if (gateRule.blocked(f) === true) flags.push("the radar's dump gate hides it");
    if (oneWallet.blocked(f) === true) flags.push("one wallet holds 20%+");
    if (f.tag_product === 1) flags.push("AI or tool name");
    out.push({
      mint: coin.mint, symbol: coin.symbol, name: coin.name, ageH: now.ageH, mcap: f.mcap ?? null, liq: f.liq ?? null,
      mult: f.mult ?? null, dd: f.dd ?? null, go2, collapse24: col, zone, flags, tags: coin.tags, oddsAt: { go2: go2 ? tauG : null, collapse24: col ? tauC : null },
    });
  }
  const odds = (r: Rate | null) => (r ? r.p : -1);
  out.sort((a, b) => odds(b.go2) - odds(a.go2) || a.ageH - b.ageH);
  const at = (t: number[]) => (t.length ? t.map((x) => `${x} h`).join(", ") : "none");
  return {
    coins: out.slice(0, 80),
    trusted,
    checkedAt,
    note: trusted.go2 || trusted.collapse24
      ? `Each number is what happened to coins the model scored the same way, on coins it had not seen (a model per age; doubling is checked at ${at(checkedAt.go2)}, losing half at ${at(checkedAt.collapse24)}). A coin whose age fits no checked moment gets no number. They are frequencies, not promises.`
      : "No model has yet beaten chance on coins it had not seen, so no odds are shown; only the plain flags.",
  };
}
