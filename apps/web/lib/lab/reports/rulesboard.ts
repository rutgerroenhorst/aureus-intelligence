/**
 * The rule scoreboard: for every rule the system uses to hide or reject coins, what happened to the coins it blocked
 * compared with the coins it let through, judged only on what followed the moment of the check (no peeking at the future).
 *
 * "Protective" means the blocked coins did worse, so blocking them saved money. "Costly" means the blocked coins did BETTER
 * than the ones let through, so the rule throws away good coins. "Neutral" means no difference could be shown.
 */

import type { LabCoin } from "../builder";
import type { Features } from "../features";
import { bootDiffCi, fisherExact } from "../stats";
import { evOf, group, num, rowsFor, type Group, type Rate, type Row } from "./common";

export interface RuleDef {
  id: string;
  label: string;
  /** where the rule lives in the system */
  where: string;
  about: string;
  /** true = the rule blocks this coin; null = cannot be evaluated (a needed number is missing) */
  blocked: (f: Features) => boolean | null;
  /** only meaningful from this moment on (first look rules are checked at 0) */
  kind: "gate" | "engine" | "lab";
}

const sellBuy = (s: number | null, b: number | null) => (num(s) && num(b) ? s / Math.max(b, 1) : null);

/** The production gate (apps/web/app/api/safety-gate/route.ts: evaluatePair), rule by rule. */
export const RULES: RuleDef[] = [
  {
    id: "gate_dump_m5", kind: "gate", label: "Dump in the last 5 minutes",
    where: "Safety gate, every tab", about: "Hides a coin when sells outnumber buys 3-4x while the price fell 40-50%, or when it fell 70% in 5 minutes.",
    blocked: (f) => {
      if (!num(f.pc_m5)) return null;
      const r = sellBuy(f.s_m5, f.b_m5);
      if (r != null && ((r > 4 && f.pc_m5 < -50) || (r > 3 && f.pc_m5 < -40))) return true;
      return f.pc_m5 < -70;
    },
  },
  {
    id: "gate_dump_h1", kind: "gate", label: "Fell 70% in the last hour",
    where: "Safety gate, every tab", about: "Hides a coin that lost 70% in an hour (or 60% with sells outnumbering buys 3.5 to 1).",
    blocked: (f) => {
      if (!num(f.pc_h1)) return null;
      const r = sellBuy(f.s_h1, f.b_h1);
      if (r != null && r > 3.5 && f.pc_h1 < -60) return true;
      return f.pc_h1 < -70;
    },
  },
  { id: "gate_crash_h6", kind: "gate", label: "Fell 70% in 6 hours", where: "Safety gate, every tab", about: "Hides a coin that lost 70% in 6 hours (called a rug pull in the code).", blocked: (f) => (num(f.pc_h6) ? f.pc_h6 < -70 : null) },
  { id: "gate_dead_h24", kind: "gate", label: "Fell 80% in 24 hours", where: "Safety gate, every tab", about: "Hides a coin that lost 80% in a day (called a dead coin in the code).", blocked: (f) => (num(f.pc_h24) ? f.pc_h24 < -80 : null) },
  {
    id: "gate_all_dump", kind: "gate", label: "All dump rules together (what the radar does)",
    where: "Safety gate, every tab", about: "The four rules above combined, as the live gate applies them.",
    blocked: (f) => {
      const parts = ["gate_dump_m5", "gate_dump_h1", "gate_crash_h6", "gate_dead_h24"].map((id) => RULES.find((r) => r.id === id)!.blocked(f));
      if (parts.every((p) => p == null)) return null;
      return parts.some((p) => p === true);
    },
  },
  { id: "gate_liq_trap", kind: "gate", label: "Thin pool (liquidity under 0.5% of market cap)", where: "Safety gate, every tab", about: "Hides a coin whose pool is under 0.5% of its value and under $10K.", blocked: (f) => (num(f.liq_mcap) && num(f.liq) ? f.liq_mcap < 0.005 && f.liq < 10_000 : null) },
  { id: "gate_tiny", kind: "gate", label: "Under $1K market cap or liquidity", where: "Safety gate, every tab", about: "Hides micro-pennies.", blocked: (f) => (num(f.mcap) && num(f.liq) ? f.mcap < 1000 || f.liq < 1000 : null) },
  { id: "gate_top1_70", kind: "gate", label: "One wallet above 70%", where: "Safety gate, every tab", about: "Hides a coin where one wallet holds more than 70%.", blocked: (f) => (num(f.top1) ? f.top1 > 0.7 : null) },
  { id: "gate_top5_85", kind: "gate", label: "Top 5 wallets above 85%", where: "Safety gate, every tab", about: "Hides a coin where five wallets hold more than 85%.", blocked: (f) => (num(f.top5) ? f.top5 > 0.85 : null) },
  { id: "engine_one_wallet", kind: "engine", label: "One wallet at 20% or more", where: "Decision engine (safety-engine, RUG.MAX_SINGLE_HOLDER)", about: "Rejects a coin at its first look when one wallet holds 20% or more; rejected coins are then dropped.", blocked: (f) => (num(f.top1) ? f.top1 >= 0.2 : null) },
  { id: "engine_top5_60", kind: "engine", label: "Top 5 wallets at 60% or more", where: "Decision engine (safety-engine, RUG.MAX_TOP5)", about: "Rejects a coin when five wallets hold 60% or more.", blocked: (f) => (num(f.top5) ? f.top5 >= 0.6 : null) },
];

export type Verdict = "protective" | "costly" | "neutral" | "thin";

export interface Cmp {
  tau: number;
  blocked: Group;
  passed: Group;
  /** blocked minus passed ladder result, with a 90% interval */
  evDiff: { diff: number; lo: number; hi: number } | null;
  pGo2: number | null;
  pCollapse: number | null;
  verdict: Verdict;
  share: number;
}

export function compare(rows: Row[], tau: number, blockedFn: (f: Features) => boolean | null): Cmp {
  const blocked: Row[] = [];
  const passed: Row[] = [];
  for (const r of rows) {
    const b = blockedFn(r.f);
    if (b == null) continue;
    (b ? blocked : passed).push(r);
  }
  const gb = group(blocked);
  const gp = group(passed);
  const evb = evOf(blocked);
  const evp = evOf(passed);
  const evDiff = evb.length >= 15 && evp.length >= 15 ? bootDiffCi(evb, evp, 300, 11 + tau) : null;
  const fish = (a: Rate, b: Rate) => (a.n >= 15 && b.n >= 15 ? fisherExact(a.k, a.n - a.k, b.k, b.n - b.k) : null);
  const pGo2 = fish(gb.go2, gp.go2);
  const pCollapse = fish(gb.collapse24, gp.collapse24);
  let verdict: Verdict = "neutral";
  if (blocked.length < 15 || passed.length < 15) verdict = "thin";
  else if (evDiff && evDiff.hi < 0) verdict = "protective";
  else if (evDiff && evDiff.lo > 0) verdict = "costly";
  else if (pGo2 != null && pGo2 < 0.05 && gb.go2.p > gp.go2.p) verdict = "costly";
  else if (pCollapse != null && pCollapse < 0.05 && gb.collapse24.p > gp.collapse24.p && !(pGo2 != null && pGo2 < 0.05 && gb.go2.p > gp.go2.p)) verdict = "protective";
  return { tau, blocked: gb, passed: gp, evDiff, pGo2, pCollapse, verdict, share: blocked.length / Math.max(1, blocked.length + passed.length) };
}

export interface RuleResult {
  id: string;
  label: string;
  where: string;
  about: string;
  kind: string;
  byTau: Cmp[];
  /** verdict at the first look and over the later checkpoints (3 and 6 h pooled by taking the larger sample) */
  firstLook: Cmp | null;
  later: Cmp | null;
}

export const RULE_TAUS = [0, 1, 3, 6, 24];

export function buildRuleBoard(coins: LabCoin[], extra: RuleDef[] = []): { rules: RuleResult[] } {
  const rowsByTau = new Map(RULE_TAUS.map((t) => [t, rowsFor(coins, t)]));
  const out: RuleResult[] = [];
  for (const rule of [...RULES, ...extra]) {
    const byTau: Cmp[] = [];
    for (const tau of RULE_TAUS) {
      const rows = rowsByTau.get(tau)!;
      if (rows.length < 40) continue;
      const c = compare(rows, tau, rule.blocked);
      if (c.blocked.n + c.passed.n > 0) byTau.push(c);
    }
    const firstLook = byTau.find((c) => c.tau === 0) ?? null;
    const laterCands = byTau.filter((c) => c.tau === 3 || c.tau === 6);
    const later = laterCands.sort((a, b) => b.blocked.n - a.blocked.n)[0] ?? null;
    out.push({ id: rule.id, label: rule.label, where: rule.where, about: rule.about, kind: rule.kind, byTau, firstLook, later });
  }
  return { rules: out };
}
