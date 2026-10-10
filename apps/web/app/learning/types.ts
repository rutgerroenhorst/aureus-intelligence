import type { OverviewReport } from "@/lib/lab/reports/overview";
import type { InsightsReport } from "@/lib/lab/reports/insights";
import type { RuleResult } from "@/lib/lab/reports/rulesboard";
import type { ModelEval } from "@/lib/lab/reports/model";
import type { NoGoReport } from "@/lib/lab/reports/nogo";
import type { LifecycleReport } from "@/lib/lab/reports/lifecycle";
import type { HypothesisResult } from "@/lib/lab/reports/hypotheses";
import type { LiveReport } from "@/lib/lab/reports/live";
import type { TabsReport } from "@/lib/lab/reports/tabs";
import type { Headline } from "@/lib/lab/reports";

/** What /api/lab returns: the stored analyses plus how much each collector has gathered. */
export interface LabData {
  computedAt: string | null;
  overview?: OverviewReport;
  insights?: InsightsReport;
  rules?: { rules: RuleResult[] };
  models?: { evals: ModelEval[] };
  nogo?: NoGoReport;
  lifecycle?: LifecycleReport;
  hypotheses?: { items: HypothesisResult[] };
  live?: LiveReport;
  tabs?: TabsReport;
  headlines?: Headline[];
  meta?: { asOf: string; coins: number; finals: number };
  collectors?: Array<{ source: string; rows: number; coins: number; last: string | null }>;
}
