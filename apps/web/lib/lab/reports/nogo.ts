/**
 * The "will this coin go anywhere?" view, built to be honest about the trade-off. Three tables per decision moment:
 *
 *  1. Zones: the models' odds of doubling and of losing half sort coins into four groups (steady climbers, hot movers,
 *     falling knives, zombies), each with what really happened to them.
 *  2. A filter simulator: drop the least promising (or the riskiest) 10-50% of coins and see exactly how many future
 *     winners go with them, how many crashes are avoided, and what the exit ladder earned on what is kept.
 *  3. A search for plain rules ("volume dried up AND few trades") fitted on the earlier coins and checked on the later ones.
 *     A rule only counts as validated when, on coins it never saw, it removed clearly more no-hopers than chance and few winners.
 */

import type { LabCoin } from "../builder";
import { FEATURES, fmtValue } from "../features";
import { bootDiffCi, mean, quantile, wilson } from "../stats";
import { evOf, group, num, rate, rateOf, rowsFor, splitTime, type Group, type Rate, type Row } from "./common";
import type { InsightsReport } from "./insights";
import { crossFit } from "./model";

export interface Zone {
  id: "steady" | "burner" | "knife" | "zombie";
  label: string;
  about: string;
  group: Group;
}

export interface FilterRow {
  /** share of coins taken out, 0.1 = 10% */
  share: number;
  removed: Group;
  kept: Group;
  /** of all coins that went on to double, the share that sat in the removed part */
  winnersLost: Rate;
  /** of all coins that lost half within a day, the share in the removed part */
  crashesAvoided: Rate;
}

export interface NoGoTau {
  tau: number;
  n: number;
  base: Group;
  zones: Zone[];
  byOpportunity: FilterRow[];
  byRisk: FilterRow[];
}

export interface Cond {
  key: string;
  op: "le" | "ge" | "eq";
  value: number;
  text: string;
}

export interface RuleCandidate {
  text: string;
  conds: Cond[];
  train: { removed: number; noGo: number; wins: number };
  test: { removed: number; share: number; precision: Rate; baseNoGo: number; winnersLost: number; winnersTotal: number; evRemoved: number | null; evKept: number | null };
  validated: boolean;
  why: string;
}

export interface NoGoReport {
  taus: NoGoTau[];
  rules: Array<{ tau: number; baseNoGo: number; candidates: RuleCandidate[] }>;
}

const SHARES = [0.1, 0.2, 0.3, 0.4, 0.5];

const ZONE_TEXT: Record<Zone["id"], { label: string; about: string }> = {
  steady: { label: "Steady climbers", about: "Below-median chance of crashing, above-median chance of doubling." },
  burner: { label: "Hot movers", about: "Likely to crash AND relatively likely to double: the coins that do both." },
  knife: { label: "Falling knives", about: "Likely to crash and unlikely to double." },
  zombie: { label: "Zombies", about: "Unlikely to crash, unlikely to double: nothing happens. Safe to ignore." },
};

function zonesAndFilters(rows: Row[], tau: number): NoGoTau | null {
  const go = crossFit(rows, "go2", tau);
  const cr = crossFit(rows, "collapse24", tau);
  const both = rows.filter((r) => go.has(r) && cr.has(r));
  if (both.length < 80) return null;
  const O = both.map((r) => go.get(r)!);
  const R = both.map((r) => cr.get(r)!);
  const oMed = quantile(O, 0.5);
  const rMed = quantile(R, 0.5);
  const zoneRows: Record<Zone["id"], Row[]> = { steady: [], burner: [], knife: [], zombie: [] };
  both.forEach((r, i) => {
    const hiR = R[i]! >= rMed;
    const hiO = O[i]! >= oMed;
    zoneRows[hiR ? (hiO ? "burner" : "knife") : hiO ? "steady" : "zombie"].push(r);
  });
  const zones: Zone[] = (Object.keys(zoneRows) as Zone["id"][]).map((id) => ({ id, ...ZONE_TEXT[id], group: group(zoneRows[id]) }));

  const totalWins = both.filter((r) => r.y.go2 === true).length;
  const totalCrashes = both.filter((r) => r.y.collapse24 === true).length;
  const sim = (score: (r: Row) => number): FilterRow[] =>
    SHARES.map((share) => {
      const order = [...both].sort((a, b) => score(a) - score(b)); // lowest score is removed first
      const cut = Math.floor(both.length * share);
      const removed = order.slice(0, cut);
      const kept = order.slice(cut);
      return {
        share,
        removed: group(removed),
        kept: group(kept),
        winnersLost: rate(removed.filter((r) => r.y.go2 === true).length, totalWins),
        crashesAvoided: rate(removed.filter((r) => r.y.collapse24 === true).length, totalCrashes),
      };
    });
  return {
    tau, n: both.length, base: group(both), zones,
    byOpportunity: sim((r) => go.get(r)!),
    byRisk: sim((r) => -cr.get(r)!),
  };
}

// ── rule search ───────────────────────────────────────────────────────────────────────────────────────────────

const metaOf = (key: string) => FEATURES.find((f) => f.key === key)!;

function condText(key: string, op: Cond["op"], value: number): string {
  const m = metaOf(key);
  if (m.fmt === "bool") return `${m.label.toLowerCase()}: ${value >= 0.5 ? "yes" : "no"}`;
  return `${m.label.toLowerCase()} ${op === "le" ? "at most" : "at least"} ${fmtValue(m.fmt, value)}`;
}

const holds = (c: Cond, r: Row): boolean => {
  const v = r.f[c.key];
  if (!num(v)) return false;
  return c.op === "le" ? v <= c.value : c.op === "ge" ? v >= c.value : v === c.value;
};

function searchRules(rows: Row[], tau: number, insights: InsightsReport): { tau: number; baseNoGo: number; candidates: RuleCandidate[] } | null {
  const use = rows.filter((r) => r.y.go15 != null && r.y.go2 != null);
  const [train, test] = splitTime(use, 0.6);
  if (train.length < 150 || test.length < 100) return null;
  const ti = insights.taus.find((t) => t.tau === tau);
  if (!ti) return null;
  const keys = ti.features
    .filter((f) => f.nonNull >= 120 && (f.go2 || f.collapse24))
    .sort((a, b) => Math.max(Math.abs((b.go2?.auc ?? 0.5) - 0.5), Math.abs((b.collapse24?.auc ?? 0.5) - 0.5)) - Math.max(Math.abs((a.go2?.auc ?? 0.5) - 0.5), Math.abs((a.collapse24?.auc ?? 0.5) - 0.5)))
    .slice(0, 10)
    .map((f) => f.key);
  const conds: Cond[] = [];
  for (const key of keys) {
    const vals = train.map((r) => r.f[key]).filter(num);
    if (new Set(vals).size <= 2) {
      for (const v of new Set(vals)) conds.push({ key, op: "eq", value: v, text: condText(key, "eq", v) });
      continue;
    }
    for (const q of [0.2, 0.4, 0.6, 0.8]) {
      const v = quantile(vals, q);
      conds.push({ key, op: "le", value: v, text: condText(key, "le", v) });
      conds.push({ key, op: "ge", value: v, text: condText(key, "ge", v) });
    }
  }
  const sat = conds.map((c) => train.map((r) => holds(c, r)));
  const isWin = train.map((r) => r.y.go2 === true);
  const isNoGo = train.map((r) => r.y.go15 === false);
  const totalWins = isWin.filter(Boolean).length;
  const maxWinsLost = Math.max(1, Math.floor(totalWins * 0.1));
  interface Cand { idx: number[]; removed: number; noGo: number; wins: number; score: number }
  const cands: Cand[] = [];
  const consider = (idx: number[], flags: boolean[]) => {
    let removed = 0;
    let noGo = 0;
    let wins = 0;
    for (let i = 0; i < flags.length; i++) {
      if (!flags[i]) continue;
      removed++;
      if (isNoGo[i]) noGo++;
      if (isWin[i]) wins++;
    }
    if (removed < train.length * 0.08 || wins > maxWinsLost) return;
    cands.push({ idx, removed, noGo, wins, score: noGo - 4 * wins });
  };
  for (let a = 0; a < conds.length; a++) {
    consider([a], sat[a]!);
    for (let b = a + 1; b < conds.length; b++) {
      if (conds[a]!.key === conds[b]!.key) continue;
      consider([a, b], sat[a]!.map((x, i) => x && sat[b]![i]!));
    }
  }
  cands.sort((x, y) => y.score - x.score);
  const picked: Cand[] = [];
  for (const c of cands) {
    const sig = c.idx.map((i) => conds[i]!.text).sort().join(" & ");
    if (picked.some((p) => p.idx.map((i) => conds[i]!.text).sort().join(" & ") === sig)) continue;
    // a near-copy of a rule already picked adds nothing: skip rules that share a condition with a better one
    if (picked.some((p) => p.idx.some((i) => c.idx.includes(i)))) continue;
    picked.push(c);
    if (picked.length >= 4) break;
  }
  const testNoGo = test.filter((r) => r.y.go15 === false).length;
  const baseNoGo = testNoGo / test.length;
  const testWins = test.filter((r) => r.y.go2 === true).length;
  const candidates: RuleCandidate[] = picked.map((c) => {
    const cs = c.idx.map((i) => conds[i]!);
    const hit = (r: Row) => cs.every((cd) => holds(cd, r));
    const removed = test.filter(hit);
    const kept = test.filter((r) => !hit(r));
    const noGoRemoved = removed.filter((r) => r.y.go15 === false).length;
    const winsLost = removed.filter((r) => r.y.go2 === true).length;
    const prec = wilson(noGoRemoved, removed.length);
    const evR = evOf(removed);
    const evK = evOf(kept);
    const diff = evR.length >= 15 && evK.length >= 15 ? bootDiffCi(evR, evK, 300, 31) : null;
    const validated = removed.length >= 20 && prec.lo > baseNoGo && winsLost <= Math.max(1, Math.ceil(testWins * 0.12)) && (diff == null || diff.hi < 0.05);
    let why: string;
    if (removed.length < 20) why = `Only ${removed.length} later coins match, too few to judge.`;
    else if (prec.lo <= baseNoGo) why = `On later coins ${(prec.p * 100).toFixed(0)}% of the removed were no-hopers against ${(baseNoGo * 100).toFixed(0)}% for coins in general: not clearly better than chance.`;
    else if (winsLost > Math.max(1, Math.ceil(testWins * 0.12))) why = `It also removed ${winsLost} of ${testWins} later winners.`;
    else if (diff && diff.hi >= 0.05) why = `The removed coins did not clearly do worse on the exit ladder.`;
    else why = `Held up on later coins: ${(prec.p * 100).toFixed(0)}% of the removed were no-hopers (coins in general: ${(baseNoGo * 100).toFixed(0)}%), ${winsLost} of ${testWins} later winners lost.`;
    return {
      text: cs.map((x) => x.text).join(" and "),
      conds: cs,
      train: { removed: c.removed, noGo: c.noGo, wins: c.wins },
      test: {
        removed: removed.length, share: removed.length / test.length,
        precision: { k: noGoRemoved, n: removed.length, p: prec.p, lo: prec.lo, hi: prec.hi },
        baseNoGo, winnersLost: winsLost, winnersTotal: testWins,
        evRemoved: evR.length ? mean(evR) : null, evKept: evK.length ? mean(evK) : null,
      },
      validated, why,
    };
  });
  return { tau, baseNoGo, candidates };
}

export const NOGO_TAUS = [1, 3, 6, 12, 24];
export const RULE_SEARCH_TAUS = [3, 6];

export function buildNoGo(coins: LabCoin[], insights: InsightsReport): NoGoReport {
  const taus: NoGoTau[] = [];
  const rules: NoGoReport["rules"] = [];
  for (const tau of NOGO_TAUS) {
    const rows = rowsFor(coins, tau, { standing: true });
    if (rows.length < 100) continue;
    const z = zonesAndFilters(rows, tau);
    if (z) taus.push(z);
    if (RULE_SEARCH_TAUS.includes(tau)) {
      const r = searchRules(rows, tau, insights);
      if (r) rules.push(r);
    }
  }
  return { taus, rules };
}

export { rateOf };
