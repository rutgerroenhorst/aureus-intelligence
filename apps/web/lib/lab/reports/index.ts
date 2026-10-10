import { loadLabCoins, type LabCoin, type Queryable } from "../builder";
import { fmtValue, FEATURE_BY_KEY } from "../features";
import { buildHypotheses, HYPOTHESES } from "./hypotheses";
import { buildInsights, type InsightsReport } from "./insights";
import { buildLifecycle } from "./lifecycle";
import { buildLive } from "./live";
import { buildModels } from "./model";
import { buildNoGo } from "./nogo";
import { buildOverview } from "./overview";
import { buildRuleBoard } from "./rulesboard";
import { buildTabs } from "./tabs";

export type ReportMap = Record<string, unknown>;

export interface Headline {
  kind: "finding" | "warning" | "info";
  text: string;
}

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

/** Register each hypothesis once, with the date it was written down; return the dates. */
async function registerHypotheses(db: Queryable): Promise<Map<string, number>> {
  for (const h of HYPOTHESES) {
    await db.query(
      `INSERT INTO lab_hypotheses (id, title, statement, definition, note) VALUES ($1, $2, $3, $4::jsonb, $5) ON CONFLICT (id) DO NOTHING`,
      [h.id, h.title, h.statement, JSON.stringify({ unit: h.unit, tau: h.tau ?? null, outcome: h.outcome, claim: h.claim, minPerGroup: h.minPerGroup }), h.basis],
    );
  }
  const { rows } = await db.query(`SELECT id, EXTRACT(EPOCH FROM registered_at)::float8 AS t FROM lab_hypotheses`);
  return new Map(rows.map((r: { id: string; t: number }) => [r.id, r.t]));
}

function headlinesOf(reports: Record<string, any>): Headline[] {
  const out: Headline[] = [];
  const ov = reports.overview;
  const lc = reports.lifecycle;
  if (ov?.coins?.total) {
    const h = ov.held;
    out.push({
      kind: "info",
      text: `${ov.coins.total} coins followed${ov.firstSeen ? ` over ${ov.firstSeen.days.toFixed(0)} days` : ""}. Of the ${h.basis} followed for the full 3 days, ${pct(h.x2.p, 1)} held 2x, ${pct(h.x3.p, 1)} held 3x and ${pct(h.x10.p, 1)} held 10x of their first price.`,
    });
  }
  const ins = reports.insights as InsightsReport | undefined;
  const strong = ins?.headlines.filter((h) => h.tier === "strong") ?? [];
  if (strong.length) {
    for (const h of strong.slice(0, 4)) {
      const m = FEATURE_BY_KEY.get(h.key);
      out.push({ kind: "finding", text: `${h.target === "go2" ? "Doubling" : "Losing half within a day"} at +${h.tau} h, ${m?.label.toLowerCase() ?? h.key}: ${h.sentence}.` });
    }
  } else if (ins?.taus.length) {
    out.push({ kind: "warning", text: `Of ${ins.tests} feature tests, none is strong enough yet (it has to survive a correction for the number of tests and point the same way in the earlier and the later coins). The suggestive ones are listed under "Why coins go".` });
  }
  for (const r of (reports.rules?.rules ?? []) as any[]) {
    const c = r.later ?? r.firstLook;
    if (!c || c.verdict === "thin" || c.verdict === "neutral") continue;
    const where = c.tau === 0 ? "at the first look" : `at +${c.tau} h`;
    out.push({
      kind: c.verdict === "costly" ? "warning" : "finding",
      text: `${c.verdict === "costly" ? "Costly rule" : "Protective rule"}: "${r.label}" blocks ${pct(c.share)} of coins ${where} (${c.blocked.n} coins). Blocked coins did ${c.verdict === "costly" ? "better" : "worse"} than the ones let through.`,
    });
  }
  const evals = (reports.models?.evals ?? []) as any[];
  const good = evals.filter((e) => e.valid);
  out.push({
    kind: good.length ? "finding" : "warning",
    text: good.length
      ? `${good.length} of ${evals.length} odds models beat chance on later coins they never saw (best AUC ${Math.max(...good.map((e) => e.auc.auc)).toFixed(2)}).`
      : `No odds model yet beats chance on later coins it never saw (${evals.length} checked), so no numeric odds are shown.`,
  });
  const rulesFound = (reports.nogo?.rules ?? []).flatMap((r: any) => r.candidates);
  if (rulesFound.length) {
    const v = rulesFound.filter((c: any) => c.validated);
    out.push({
      kind: v.length ? "finding" : "info",
      text: v.length ? `${v.length} of ${rulesFound.length} candidate no-hoper rules held up on later coins.` : `${rulesFound.length} candidate no-hoper rules were fitted on earlier coins; none held up clearly on later ones.`,
    });
  }
  if (lc?.product) {
    const p = lc.product;
    out.push({ kind: "info", text: `Coins with an AI or tool name: ${pct(p.inGroup.held3.p, 1)} held 3x against ${pct(p.outGroup.held3.p, 1)} for the rest (${p.inGroup.n} and ${p.outGroup.n} coins). Registered as a hypothesis; only coins seen from now on count as evidence.` });
  }
  return out;
}

export async function computeReports(db: Queryable): Promise<ReportMap> {
  const coins: LabCoin[] = await loadLabCoins(db);
  const nowS = Date.now() / 1000;
  const registered = await registerHypotheses(db);
  const overview = buildOverview(coins);
  const insights = buildInsights(coins);
  const rules = buildRuleBoard(coins);
  const { report: models, trained } = buildModels(coins);
  const nogo = buildNoGo(coins, insights);
  const lifecycle = buildLifecycle(coins);
  const hypotheses = buildHypotheses(coins, registered, nowS);
  const live = buildLive(coins, trained, models, nowS);
  const tabs = await buildTabs(db, coins);
  const reports: Record<string, unknown> = {
    overview,
    insights,
    rules,
    models: { evals: models.evals },
    nogo,
    lifecycle,
    hypotheses: { items: hypotheses },
    live,
    tabs,
  };
  reports.headlines = headlinesOf(reports);
  reports.meta = { asOf: new Date().toISOString(), coins: coins.length, finals: coins.filter((c) => c.status === "final").length };
  return reports;
}

/** Five significant digits are plenty for a report and keep the stored JSON small. */
const compact = (_k: string, v: unknown) => (typeof v === "number" && Number.isFinite(v) && !Number.isInteger(v) ? Number(v.toPrecision(5)) : v);

export async function saveReports(db: Queryable, reports: ReportMap): Promise<void> {
  const n = (reports.meta as { coins: number }).coins;
  for (const [kind, payload] of Object.entries(reports)) {
    await db.query(
      `INSERT INTO lab_reports (kind, computed_at, n_coins, payload) VALUES ($1, now(), $2, $3::jsonb)
       ON CONFLICT (kind) DO UPDATE SET computed_at = now(), n_coins = EXCLUDED.n_coins, payload = EXCLUDED.payload`,
      [kind, n, JSON.stringify(payload, compact)],
    );
  }
}

export interface StoredReports {
  computedAt: string | null;
  reports: Record<string, unknown>;
}

export async function loadReports(db: Queryable): Promise<StoredReports> {
  const { rows } = await db.query(`SELECT kind, computed_at, payload FROM lab_reports`);
  const reports: Record<string, unknown> = {};
  let latest = 0;
  for (const r of rows) {
    reports[r.kind] = r.payload;
    latest = Math.max(latest, new Date(r.computed_at).getTime());
  }
  return { computedAt: latest ? new Date(latest).toISOString() : null, reports };
}

export { fmtValue };
