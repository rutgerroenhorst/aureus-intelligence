export const dynamic = "force-dynamic";
import Link from "next/link";
import { fetchResearchRows, aggregate, compareCohorts } from "../../lib/validation";
import { pctRet, pct, usd } from "../../lib/format";

/**
 * Cached for a minute.
 *
 * This page aggregates forward outcomes across every candidate ever tracked, and the
 * feature_values scan behind it takes ~3.8s — it was returning 500s against the 10s
 * query timeout whenever the worker was also busy. Unlike /today, nothing here changes
 * minute to minute: these are settled research outcomes, not a live entry decision.
 *
 * Caching is the right answer for THIS page specifically. It would be the wrong answer
 * for the board, where a stale price is a bad trade.
 */

function AggCells({ a }: { a: ReturnType<typeof aggregate> }) {
  return (
    <>
      <td className="mono">{a.n}</td>
      <td className="mono">{pct(a.winrateFinal)}</td>
      <td className="mono">{pctRet(a.meanPeak)}</td>
      <td className="mono">{pctRet(a.medianPeak)}</td>
      <td className="mono">{pctRet(a.meanFinal)}</td>
      <td className="mono" style={{ color: "var(--red)" }}>{pctRet(a.meanDrawdown)}</td>
      <td className="mono" style={{ color: "var(--red)" }}>{pct(a.rugPct)}</td>
    </>
  );
}

export default async function ValidationPage() {
  const rows = await fetchResearchRows();
  const all = aggregate(rows);
  const { cohorts } = compareCohorts(rows);
  const byPeak = [...rows].sort((a, b) => (b.peak_return_pct ?? -1) - (a.peak_return_pct ?? -1));
  const top10 = byPeak.slice(0, 10);
  const bottom10 = [...rows].sort((a, b) => (a.final_return_pct ?? 1) - (b.final_return_pct ?? 1)).slice(0, 10);

  return (
    <>
      <h1 className="page-title">Validation Lab</h1>
      <p className="page-sub">Fact-based paper-tracking over every candidate. No trading, no predictions — only measured outcomes from the collected price/liquidity series.</p>

      <div className="banner warn">
        <b>Window coverage:</b> {rows.length} candidates. 24h+ horizons are still incomplete (the scanner has not run continuously for a full day), so 24h/3d/7d returns are not reported as final. Peak run-up, drawdown, and short-horizon (≤8h) returns are measured. Rug = liquidity fell below 10% of discovery.
      </div>

      <div className="nav" style={{ position: "static", background: "none", border: "none", marginBottom: 8 }}>
        <div className="nav-inner" style={{ padding: "0 0 8px" }}>
          <Link className="link active" href="/validation">Overview</Link>
          <Link className="link" href="/validation/rules">Rule attribution</Link>
          <Link className="link" href="/validation/research">Research mode</Link>
        </div>
      </div>

      <div className="tiles" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <div className="tile accent"><div className="n">{all.n}</div><div className="l">Candidates</div></div>
        <div className="tile"><div className="n">{pctRet(all.meanPeak)}</div><div className="l">Avg peak run-up</div></div>
        <div className="tile"><div className="n">{pctRet(all.medianFinal)}</div><div className="l">Median final return</div></div>
        <div className="tile"><div className="n">{pct(all.winrateFinal)}</div><div className="l">Winrate (final &gt; 0)</div></div>
        <div className="tile"><div className="n" style={{ color: "var(--red)" }}>{pct(all.rugPct)}</div><div className="l">Rug rate</div></div>
        <div className="tile"><div className="n">{all.avgLifespanH != null ? `${all.avgLifespanH.toFixed(1)}h` : "—"}</div><div className="l">Avg lifespan</div></div>
        <div className="tile"><div className="n">{pctRet(all.avgLiqGrowth)}</div><div className="l">Avg liquidity growth</div></div>
        <div className="tile"><div className="n" style={{ color: "var(--red)" }}>{pctRet(all.meanDrawdown)}</div><div className="l">Avg drawdown</div></div>
      </div>

      <h2 className="page-title" style={{ fontSize: 16, marginTop: 24 }}>Compare engine — cohort vs the rest</h2>
      <p className="page-sub">Does a rule/filter add edge? Compare candidates that meet each condition against those that don&apos;t.</p>
      <table className="grid">
        <thead><tr><th>Cohort</th><th>n</th><th>winrate</th><th>mean peak</th><th>median peak</th><th>mean final</th><th>mean DD</th><th>rug%</th></tr></thead>
        <tbody>
          <tr style={{ borderBottom: "2px solid var(--border)" }}><td><b>ALL candidates</b></td><AggCells a={all} /></tr>
          {cohorts.map(({ cohort, cohortAgg, restAgg }) => (
            <>
              <tr key={cohort.id}><td style={{ color: "var(--gold)" }}>{cohort.label}</td><AggCells a={cohortAgg} /></tr>
              <tr key={cohort.id + "-rest"} style={{ opacity: 0.6 }}><td className="mono" style={{ paddingLeft: 18, color: "var(--muted-2)" }}>↳ rest (not in cohort)</td><AggCells a={restAgg} /></tr>
            </>
          ))}
        </tbody>
      </table>

      <div className="sections" style={{ marginTop: 24 }}>
        <div className="section">
          <h3>Top 10 by peak run-up</h3>
          <table className="grid">
            <thead><tr><th>Token</th><th>Peak</th><th>Final</th><th>DD</th><th>Rug</th></tr></thead>
            <tbody>{top10.map((r) => (
              <tr key={r.candidate_id}><td><Link href={`/candidate/${r.candidate_id}`} style={{ color: "var(--gold)" }}>{r.symbol_label ?? "—"}</Link></td>
                <td className="mono" style={{ color: "var(--green)" }}>{pctRet(r.peak_return_pct)}</td>
                <td className="mono">{pctRet(r.final_return_pct)}</td>
                <td className="mono" style={{ color: "var(--red)" }}>{pctRet(r.max_drawdown_pct)}</td>
                <td>{r.is_rug ? "🔴" : ""}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div className="section">
          <h3>Bottom 10 by final return</h3>
          <table className="grid">
            <thead><tr><th>Token</th><th>Final</th><th>Peak</th><th>Liq disc.</th><th>Rug</th></tr></thead>
            <tbody>{bottom10.map((r) => (
              <tr key={r.candidate_id}><td><Link href={`/candidate/${r.candidate_id}`} style={{ color: "var(--gold)" }}>{r.symbol_label ?? "—"}</Link></td>
                <td className="mono" style={{ color: "var(--red)" }}>{pctRet(r.final_return_pct)}</td>
                <td className="mono">{pctRet(r.peak_return_pct)}</td>
                <td className="mono">{usd(r.discovery_liquidity_usd)}</td>
                <td>{r.is_rug ? "🔴" : ""}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </>
  );
}
