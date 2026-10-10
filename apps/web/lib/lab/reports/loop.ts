/**
 * The system loop: how the system gets better without anybody reading forty tables.
 *
 *   measure     a scoreboard of four numbers, with the lab's own trend per day
 *   experiment  every idea is written down with a date and tested only on coins first seen afterwards
 *   decide      the lab raises a decision only when the evidence passes its gates; the default is "nothing needs you"
 *   repeat      it recomputes by itself, so the only rhythm a person needs is the weekly look at this card
 *
 * Nothing here changes how the Radar behaves. It only says what the evidence supports and what a change would be.
 */

import { fisherExact } from "../stats";
import { rate, type Rate } from "./common";
import type { HypothesisResult, HypothesisStatus } from "./hypotheses";
import type { LanesReport } from "./lanes";
import type { NoGoReport } from "./nogo";
import type { RuleResult } from "./rulesboard";
import type { TabsReport } from "./tabs";

export interface ScoreItem {
  id: string;
  label: string;
  about: string;
  /** 0..1 for rates, hours for coverage */
  value: number | null;
  n: number;
  k: number | null;
  format: "pct" | "hours";
  /** what to compare it with, in words and as a number */
  versus: { label: string; value: number | null } | null;
  /** which direction is better */
  good: "high" | "low" | "info";
  /** one value per day, oldest first */
  trend: Array<{ day: string; v: number }>;
}

export interface Experiment {
  id: string;
  title: string;
  status: HypothesisStatus;
  inN: number;
  outN: number;
  need: number;
  registeredAt: number;
}

export interface Decision {
  id: string;
  level: "act" | "consider";
  title: string;
  why: string;
  evidence: string;
  suggestion: string;
}

export interface LoopReport {
  scoreboard: ScoreItem[];
  experiments: Experiment[];
  decisions: Decision[];
  rhythm: string;
}

export interface HistoryPoint {
  day: string;
  v: Record<string, number | null>;
}

export interface LoopInput {
  tabs: TabsReport;
  rules: { rules: RuleResult[] };
  hypotheses: HypothesisResult[];
  lanes: LanesReport;
  /** the plain no-hoper rules searched on earlier coins and checked on later ones (optional so older callers keep working) */
  nogo?: NoGoReport;
  /** hours of the last 24 in which at least one price reading was taken, null when unknown */
  coverageH: number | null;
  history: HistoryPoint[];
}

const pct = (x: number | null | undefined, d = 0) => (x == null || !Number.isFinite(x) ? "-" : `${(x * 100).toFixed(d)}%`);
const frac = (r: Rate) => `${pct(r.p, r.p < 0.1 ? 1 : 0)} (${r.k} of ${r.n})`;

/** The numbers the scoreboard shows and the history stores, computed from the other reports. */
export function scoreValues(input: Pick<LoopInput, "tabs" | "lanes" | "coverageH">) {
  const t = input.tabs.tabs.filter((x) => x.tab_.go2.n > 0);
  const sum = (f: (x: (typeof t)[number]) => { k: number; n: number }) => t.reduce((a, x) => ({ k: a.k + f(x).k, n: a.n + f(x).n }), { k: 0, n: 0 });
  const doubled = sum((x) => x.tab_.go2);
  const halved = sum((x) => x.tab_.collapse24);
  const wmean = (f: (x: (typeof t)[number]) => number | null) => {
    let s = 0;
    let w = 0;
    for (const x of t) {
      const v = f(x);
      if (v != null) {
        s += v * x.tab_.go2.n;
        w += x.tab_.go2.n;
      }
    }
    return w ? s / w : null;
  };
  const baseDoubled = wmean((x) => x.baseline.go2);
  const baseHalved = wmean((x) => x.baseline.collapse24);
  const radar = input.lanes.groups.find((g) => g.id === "fresh");
  const away = input.lanes.groups.filter((g) => g.id === "young" || g.id === "big" || g.id === "runners");
  const awayBasis = away.reduce((a, g) => a + g.basis, 0);
  const awayHeld3 = away.reduce((a, g) => a + g.held3.k, 0);
  return { doubled, halved, baseDoubled, baseHalved, radar, awayBasis, awayHeld3, coverageH: input.coverageH };
}

export function buildLoop(input: LoopInput): LoopReport {
  const v = scoreValues(input);
  const trend = (id: string) => input.history.map((p) => ({ day: p.day, v: p.v[id] })).filter((x): x is { day: string; v: number } => x.v != null && Number.isFinite(x.v)).slice(-30);
  const radarHeld3 = v.radar?.held3 ?? null;
  const score: ScoreItem[] = [
    {
      id: "listed_doubled", label: "Radar listings that doubled", about: "Every time a coin was listed on a Radar tab: did it hold 2x within the next 3 days?",
      value: v.doubled.n >= 10 ? v.doubled.k / v.doubled.n : null, n: v.doubled.n, k: v.doubled.k, format: "pct",
      versus: { label: "the lab's other coins at the same ages", value: v.baseDoubled }, good: "high", trend: trend("listed_doubled"),
    },
    {
      id: "listed_halved", label: "Radar listings that lost half within a day", about: "Duds: listed coins that were worth half or less a day later.",
      value: v.halved.n >= 10 ? v.halved.k / v.halved.n : null, n: v.halved.n, k: v.halved.k, format: "pct",
      versus: { label: "the lab's other coins at the same ages", value: v.baseHalved }, good: "low", trend: trend("listed_halved"),
    },
    {
      id: "door_missed", label: "Coins behind the door that held 3x", about: "Coins the Radar's door turns away (too young, too big, or found on Jupiter's lists) and what share held 3x within 3 days.",
      value: v.awayBasis >= 20 ? v.awayHeld3 / v.awayBasis : null, n: v.awayBasis, k: v.awayHeld3, format: "pct",
      versus: radarHeld3 ? { label: "coins the door admits", value: radarHeld3.p } : null, good: "info", trend: trend("door_missed"),
    },
    {
      id: "coverage", label: "Hours scanned in the last 24", about: "The system only learns from what it sees. Gaps mean coins that were never watched.",
      value: v.coverageH, n: 24, k: null, format: "hours", versus: { label: "continuous", value: 24 }, good: "high", trend: trend("coverage"),
    },
  ];

  const rank: Record<HypothesisStatus, number> = { supported: 0, contradicted: 1, open: 2, collecting: 3 };
  const experiments: Experiment[] = [...input.hypotheses]
    .sort((a, b) => rank[a.status] - rank[b.status])
    .map((h) => ({ id: h.id, title: h.title, status: h.status, inN: h.forward.inGroup.n, outN: h.forward.outGroup.n, need: h.need, registeredAt: h.registeredAt }));

  const decisions: Decision[] = [];
  for (const h of input.hypotheses) {
    const inR = h.forward.inGroup.rate;
    const outR = h.forward.outGroup.rate;
    const ev = h.outcome === "ev" ? `${pct(h.forward.inGroup.ev == null ? null : h.forward.inGroup.ev - 1)} against ${pct(h.forward.outGroup.ev == null ? null : h.forward.outGroup.ev - 1)} (ladder result)` : inR && outR ? `${frac(inR)} against ${frac(outR)}` : "";
    const evidence = `${ev}${h.forward.p != null ? `, p = ${h.forward.p < 0.001 ? "<0.001" : h.forward.p.toFixed(3)}` : ""}, only coins first seen after ${new Date(h.registeredAt * 1000).toISOString().slice(0, 10)}`;
    if (h.status === "supported") decisions.push({ id: `hyp-${h.id}`, level: "act", title: `${h.title}: confirmed on new coins`, why: h.statement, evidence, suggestion: "Show it as a flag on Radar cards (information only, nothing hidden), then watch whether it keeps holding." });
    else if (h.status === "contradicted") decisions.push({ id: `hyp-${h.id}`, level: "consider", title: `${h.title}: the new coins say the opposite`, why: h.statement, evidence, suggestion: "Drop the idea. Nothing in the system depends on it." });
  }
  for (const r of input.rules.rules) {
    if (r.kind !== "gate" && r.kind !== "engine") continue;
    const c = r.later && r.later.verdict === "costly" ? r.later : r.firstLook && r.firstLook.verdict === "costly" ? r.firstLook : null;
    if (!c || c.blocked.n < 100) continue;
    decisions.push({
      id: `rule-${r.id}`, level: "consider", title: `"${r.label}" may be hiding good coins`,
      why: `${r.where}: ${r.about}`,
      evidence: `At ${c.tau === 0 ? "the first look" : `+${c.tau} h`} the coins it blocks held 2x ${frac(c.blocked.go2)} against ${frac(c.passed.go2)} for the ones it lets through.`,
      suggestion: "Keep showing these coins but mark them with the warning, instead of hiding them. Try it in shadow first, so the Radar stays as it is while the result builds up.",
    });
  }
  for (const g of input.nogo?.rules ?? []) {
    for (const c of g.candidates) {
      if (!c.validated) continue;
      decisions.push({
        id: `nogo-${g.tau}-${c.text}`, level: "consider", title: `A plain rule for no-hopers holds up on later coins (at +${g.tau} h)`, why: c.text,
        evidence: `On coins it was not fitted to it removed ${c.test.removed} (${pct(c.test.share)}); ${pct(c.test.precision.p)} of them were no-hopers against ${pct(c.test.baseNoGo)} overall, and it lost ${c.test.winnersLost} of ${c.test.winnersTotal} winners.`,
        suggestion: "Mark matching coins with a low-odds warning on Radar cards (information only, nothing hidden) and keep watching whether it still holds.",
      });
    }
  }
  const fresh = input.lanes.groups.find((g) => g.id === "fresh");
  for (const g of input.lanes.groups) {
    if (g.id === "fresh" || !fresh || g.basis < 40 || fresh.basis < 40) continue;
    const p = fisherExact(g.held2.k, g.held2.n - g.held2.k, fresh.held2.k, fresh.held2.n - fresh.held2.k);
    if (p < 0.05 && g.held2.p > fresh.held2.p + 0.08) {
      decisions.push({
        id: `lane-${g.id}`, level: "consider", title: `The door turns away coins that do better: ${g.label.toLowerCase()}`, why: g.about,
        evidence: `They held 2x ${frac(g.held2)} against ${frac(fresh.held2)} for the coins the door admits (p = ${p < 0.001 ? "<0.001" : p.toFixed(3)}).`,
        suggestion: "Widen the door for this kind of coin in shadow (list them somewhere separate), and judge it on what they do after being listed.",
      });
    }
  }
  if (input.coverageH != null && input.coverageH < 18) {
    decisions.push({
      id: "coverage", level: "act", title: `The system scanned in only ${Math.round(input.coverageH)} of the last 24 hours`,
      why: "Everything it learns has holes where nobody had a screen open, and the coins that launch in those holes are never seen at all.",
      evidence: `${Math.round(input.coverageH)} of 24 hours had at least one price reading.`,
      suggestion: "Switch on the 24/7 scan (a standing schedule, so it needs your yes). It costs about 0.7 of the 4 free CPU hours a month in a light mode.",
    });
  }
  decisions.sort((a, b) => (a.level === b.level ? 0 : a.level === "act" ? -1 : 1));

  return {
    scoreboard: score,
    experiments,
    decisions: decisions.slice(0, 3),
    rhythm: "The lab recomputes by itself every hour, but it only raises a decision when the evidence passes its gates: coins first seen after the idea was written down, enough of them on both sides, a difference bigger than chance, and the same direction in the earlier and the later half. Everything else stays on the research bench (the other views). A weekly look at this card is enough.",
  };
}

export { rate };
