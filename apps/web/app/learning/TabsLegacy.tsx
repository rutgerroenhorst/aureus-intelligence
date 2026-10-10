"use client";
import { useState } from "react";
import s from "./lab.module.css";
import { Badge, Empty, Note, Section } from "./parts";
import { evText, pct, pctS } from "./format";
import { usePolling } from "@/lib/usePolling";
import type { LabData } from "./types";

interface Legacy {
  per_tab: Record<string, { tab_name: string; total_coins: number; winners: number; mega_winners: number; rugpulls: number; dead_coins: number; losers: number; pending: number; win_rate: number; avg_return: number }>;
  suggestions: Array<{ tab_name: string; age_bucket_min: number; age_bucket_max: number; metric_name: string; suggested_threshold: number; suggested_direction: string; confidence_score: number; win_rate_with_suggestion: number; win_rate_without_suggestion: number; sample_size: number; status: string }>;
  analysis_summary: { total_coins_tracked: number; total_graded: number; total_pending: number; last_tracked_at: string | null };
  rules?: { winner: string; rugpull: string; loser: string; dead: string; watch_hours: number };
}

const fmtAge = (h: number) => (h >= 1000 ? "any age" : h >= 48 ? `${Math.round(h / 24)} d` : `${h} h`);
const TAB: Record<string, string> = { cate: "CATE", buy_signals: "Buy signals", ultra_momentum: "Ultra momentum", elite: "Elite", incubation: "Incubation" };

export function TabsLegacy({ d }: { d: LabData }) {
  const [legacy, setLegacy] = useState<Legacy | null>(null);
  usePolling(async () => {
    try {
      const res = await fetch("/api/learning-analysis", { cache: "no-store" });
      if (res.ok) setLegacy(await res.json());
    } catch {
      /* the lab above does not depend on this */
    }
  }, 60_000);
  const tabs = d.tabs?.tabs ?? [];
  return (
    <>
      <Section title="How each Radar tab did" lede="Every time a coin was listed on a tab, the lab reads what the next 3 days held for it and compares it with the lab's other coins of the same age. A tab only beats the rest when the difference is larger than chance, which with the few coins listed so far it rarely is yet.">
        {tabs.length === 0 ? (
          <Empty>No coin has been listed on a tab since tracking began.</Empty>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Tab</th>
                  <th className={s.num}>Listings</th>
                  <th className={s.num}>Matched</th>
                  <th className={s.num}>Doubled</th>
                  <th className={s.num}>Other coins</th>
                  <th className={s.num}>Lost half</th>
                  <th className={s.num}>Ladder</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {tabs.map((t) => (
                  <tr key={t.tab}>
                    <td style={{ fontWeight: 600 }}>{TAB[t.tab] ?? t.tab}</td>
                    <td className={s.num}>{t.listed}</td>
                    <td className={s.num}>{t.matched}</td>
                    <td className={s.num}>{t.tab_.go2.n ? `${pctS(t.tab_.go2.p)} (${t.tab_.go2.k}/${t.tab_.go2.n})` : "–"}</td>
                    <td className={s.num}>{t.baseline.go2 == null ? "–" : pctS(t.baseline.go2)}</td>
                    <td className={s.num}>{t.tab_.collapse24.n ? pctS(t.tab_.collapse24.p) : "–"}</td>
                    <td className={s.num}>{evText(t.tab_.ev.mean)}</td>
                    <td><Badge kind={t.verdict === "better" ? "protective" : t.verdict === "worse" ? "costly" : t.verdict}>{t.verdict === "thin" ? "too few coins" : t.verdict === "same" ? "no difference" : t.verdict}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={s.small} style={{ marginTop: 6 }}>{d.tabs?.note}</p>
      </Section>

      {legacy && legacy.analysis_summary.total_coins_tracked > 0 && (
        <Section title="The Self-Optimizer (original tab grading)" lede="The earlier grading: coins on a tab are watched for 6 hours and labelled by one check. Kept for reference; the lab above supersedes it, because it only knows coins that were on a tab and calls a winner on a single reading.">
          <Note>
            {legacy.analysis_summary.total_coins_tracked} coins tracked · {legacy.analysis_summary.total_graded} graded · {legacy.analysis_summary.total_pending} still being watched.
            {legacy.rules && <> A <b>winner</b> reaches 2x its market cap at any check; a <b>rugpull</b> falls below 0.5x or loses its liquidity; a <b>loser</b> is still between 0.5x and 2x after {legacy.rules.watch_hours} hours.</>}
          </Note>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr><th>Tab</th><th className={s.num}>Coins</th><th className={s.num}>Winners</th><th className={s.num}>Rugpulls</th><th className={s.num}>Dead</th><th className={s.num}>Pending</th><th className={s.num}>Win rate</th></tr>
              </thead>
              <tbody>
                {Object.values(legacy.per_tab).map((t) => (
                  <tr key={t.tab_name}>
                    <td style={{ fontWeight: 600 }}>{TAB[t.tab_name] ?? t.tab_name}</td>
                    <td className={s.num}>{t.total_coins}</td>
                    <td className={s.num}>{t.winners}</td>
                    <td className={s.num}>{t.rugpulls}</td>
                    <td className={s.num}>{t.dead_coins}</td>
                    <td className={s.num}>{t.pending}</td>
                    <td className={s.num}>{t.total_coins === t.pending ? "–" : `${t.win_rate.toFixed(0)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {legacy.suggestions.length > 0 && (
            <>
              <h3 style={{ margin: "16px 0 8px", fontSize: 14 }}>Suggested filter changes (advice only; nothing is applied automatically)</h3>
              <div className={s.grid2}>
                {legacy.suggestions.slice(0, 8).map((x, i) => (
                  <div key={i} className={s.card}>
                    <div style={{ fontWeight: 600 }}>{TAB[x.tab_name] ?? x.tab_name}: {x.metric_name.replace(/_/g, " ")}</div>
                    <div className={s.small}>
                      Coins aged {fmtAge(x.age_bucket_min)} to {fmtAge(x.age_bucket_max)}: try {x.suggested_direction === "increase" ? "at least" : "at most"} {Number(x.suggested_threshold).toFixed(2)}. Win rate {Number(x.win_rate_without_suggestion).toFixed(0)}% without, {Number(x.win_rate_with_suggestion).toFixed(0)}% with (n = {x.sample_size}, confidence {Number(x.confidence_score).toFixed(0)}%).
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Section>
      )}
    </>
  );
}

export { pct };
