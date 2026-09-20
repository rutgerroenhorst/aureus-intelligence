export const dynamic = "force-dynamic";
import Link from "next/link";
import { fetchResearchRows, researchQuery } from "../../../lib/validation";
import { pctRet, pct, usd } from "../../../lib/format";

export default async function ResearchModePage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const rows = await fetchResearchRows();
  const metric = (searchParams.metric as "peak" | "h4" | "final") ?? "peak";
  const minPct = searchParams.min ? Number(searchParams.min) / 100 : 1.0; // default +100%
  const res = researchQuery(rows, metric, minPct);

  return (
    <>
      <h1 className="page-title">Research mode</h1>
      <p className="page-sub">Ask factual questions of the data. E.g. &quot;which coins ran ≥300%, and what did they have in common?&quot; No AI conclusions — only counts from the database.</p>

      <div className="nav" style={{ position: "static", background: "none", border: "none", marginBottom: 8 }}>
        <div className="nav-inner" style={{ padding: "0 0 8px" }}>
          <Link className="link" href="/validation">Overview</Link>
          <Link className="link" href="/validation/rules">Rule attribution</Link>
          <Link className="link active" href="/validation/research">Research mode</Link>
        </div>
      </div>

      <form className="filters" method="get">
        <label>Metric
          <select name="metric" defaultValue={metric}>
            <option value="peak">Peak run-up (any time)</option>
            <option value="h4">4h return</option>
            <option value="final">Final return</option>
          </select>
        </label>
        <label>Minimum %
          <input name="min" type="number" defaultValue={searchParams.min ?? "100"} placeholder="100" />
        </label>
        <button className="btn primary" type="submit">Run query</button>
        <Link className="btn" href="/validation/research?metric=peak&min=300">≥300% preset</Link>
      </form>

      <p className="page-sub"><b>{res.matched.length}</b> candidates with {metric} return ≥ {pctRet(minPct)}.</p>

      <div className="sections">
        <div className="section">
          <h3>Rules they shared (fraction PASS)</h3>
          {res.commonRulesPass.length === 0 ? <div className="mono">no PASS rules in this set</div> : (
            <div className="feat-list">
              {res.commonRulesPass.map((x) => (<><div key={x.ruleId}>{x.label}</div><div key={x.ruleId + "v"} className="fs">{pct(x.passFraction)}</div></>))}
            </div>
          )}
        </div>
        <div className="section">
          <h3>Strongest features (fraction available)</h3>
          <div className="feat-list">
            {res.strongestFeatures.slice(0, 12).map((x) => (<><div key={x.featureId}>{x.label}</div><div key={x.featureId + "v"} className={`fs ${x.okFraction > 0.5 ? "st-OK" : ""}`}>{pct(x.okFraction)}</div></>))}
          </div>
        </div>
      </div>

      <div className="section" style={{ marginTop: 14 }}>
        <h3>Blockers that never occurred in this set</h3>
        {res.blockersNeverPresent.length ? <div className="mono">{res.blockersNeverPresent.join(" · ")}</div> : <div className="mono">— (or no safety data)</div>}
      </div>

      <h3 style={{ marginTop: 20 }}>Matched candidates</h3>
      <table className="grid">
        <thead><tr><th>Token</th><th>Peak</th><th>4h</th><th>Final</th><th>Liq disc.</th><th>Rug</th><th>State</th></tr></thead>
        <tbody>
          {res.matched.sort((a, b) => (b.peak_return_pct ?? 0) - (a.peak_return_pct ?? 0)).map((r) => (
            <tr key={r.candidate_id}>
              <td><Link href={`/candidate/${r.candidate_id}`} style={{ color: "var(--gold)" }}>{r.symbol_label ?? "—"}</Link></td>
              <td className="mono" style={{ color: "var(--green)" }}>{pctRet(r.peak_return_pct)}</td>
              <td className="mono">{pctRet(r.h4_return)}</td>
              <td className="mono">{pctRet(r.final_return_pct)}</td>
              <td className="mono">{usd(r.discovery_liquidity_usd)}</td>
              <td>{r.is_rug ? "🔴" : ""}</td>
              <td className="mono">{r.current_state}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
