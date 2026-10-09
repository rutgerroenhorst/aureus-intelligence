export const dynamic = "force-dynamic";
import Link from "next/link";
import { fetchResearchRows, ruleAttribution } from "../../../lib/validation";
import { pctRet, pct } from "../../../lib/format";

export default async function RuleAttributionPage() {
  const rows = await fetchResearchRows();
  const attr = ruleAttribution(rows);

  return (
    <>
      <h1 className="page-title">Rule attribution</h1>
      <p className="page-sub">For each rule: how often it PASS/FAILs, the mean peak run-up of each group, rug rates, and whether the PASS↔FAIL difference is statistically distinguishable. A rule with no measurable difference adds no proven edge (yet).</p>

      <div className="nav" style={{ position: "static", background: "none", border: "none", marginBottom: 8 }}>
        <div className="nav-inner" style={{ padding: "0 0 8px" }}>
          <Link className="link" href="/validation">Overview</Link>
          <Link className="link active" href="/validation/rules">Rule attribution</Link>
          <Link className="link" href="/validation/research">Research mode</Link>
        </div>
      </div>

      <div className="banner warn">
        With Helius disabled, most SAFETY/QUALITY rules are <b>all-INCOMPLETE</b> (no on-chain data) — they have no PASS/FAIL variance, so their predictive value <b>cannot be measured yet</b>. Only rules driven by price/liquidity data (liquidity stability, overextension, freshness) currently split into PASS/FAIL. This is itself the key finding: attribution needs the on-chain inputs to be present.
      </div>

      <table className="grid">
        <thead>
          <tr><th>Rule</th><th>n</th><th>PASS</th><th>FAIL</th><th>INCOMPLETE</th><th>mean peak (PASS)</th><th>mean peak (FAIL)</th><th>rug% PASS</th><th>rug% FAIL</th><th>Δ / significance</th><th>Verdict</th></tr>
        </thead>
        <tbody>
          {attr.map((a) => (
            <tr key={a.ruleId}>
              <td className="mono">{a.label}</td>
              <td className="mono">{a.n}</td>
              <td className="mono" style={{ color: "var(--green)" }}>{a.pass}</td>
              <td className="mono" style={{ color: "var(--red)" }}>{a.fail}</td>
              <td className="mono" style={{ color: "var(--amber)" }}>{a.incomplete}</td>
              <td className="mono">{pctRet(a.meanPeakPass)}</td>
              <td className="mono">{pctRet(a.meanPeakFail)}</td>
              <td className="mono">{pct(a.rugPctPass)}</td>
              <td className="mono">{pct(a.rugPctFail)}</td>
              <td className="mono" style={{ whiteSpace: "normal", maxWidth: 200 }}>
                {a.significance.diff != null ? `Δ ${pctRet(a.significance.diff)} · ` : ""}{a.significance.note}
              </td>
              <td className="mono" style={{ color: a.verdict === "edge" ? "var(--green)" : a.verdict === "no measurable edge" ? "var(--red)" : "var(--muted-2)" }}>
                {a.verdict === "no measurable edge" ? "⚑ no edge" : a.verdict}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
