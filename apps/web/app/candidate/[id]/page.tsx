import { Fragment } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getCandidate, latestRulesFor, latestFeatures, latestDecisionReason, dataQualityStatus, timeline, alertsForCandidate, stateHistory,
  getEnrichment, HELIUS_DEPENDENT_RULES, workerStatus,
  type FeatureRow, type RuleRow,
} from "../../../lib/queries";
import { byFamily } from "../../../lib/findings";
import { readinessFor } from "../../../lib/readiness";
import { describeOnChain } from "../../../lib/onchainStatus";
import { getDecisionViews } from "../../../lib/candidateView";
import { DecisionHeader } from "./DecisionHeader";
import { replayData } from "../../../lib/queries";
import { Replay } from "../../../components/Replay";
import { PriceChart } from "../../../components/PriceChart";
import { DexChart } from "../../../components/DexChart";
import { StateBadge, ResultTag } from "../../../components/Badges";
import { shortMint, usd, ago, dexUrl } from "../../../lib/format";
import type { FamilyCoverage } from "@aureus/readiness";

function FamilyCount({ c }: { c: FamilyCoverage }) {
  return (
    <span className="mono" style={{ fontSize: 11 }}>
      <span style={{ color: "var(--green)" }}>{c.pass} pass</span> · <span style={{ color: "var(--red)" }}>{c.fail} fail</span> · <span style={{ color: "var(--amber)" }}>{c.incomplete} incomplete</span>
      {c.requiredInputsTotal > 0 ? <span style={{ color: "var(--muted-2)" }}> · inputs {c.requiredInputsAvailable}/{c.requiredInputsTotal}</span> : null}
    </span>
  );
}

function RuleItem({ r }: { r: RuleRow }) {
  const missing = (r.evidence && (r.evidence as Record<string, unknown>).missing) as string[] | undefined;
  return (
    <div className="rule">
      <div className="rule-head">
        <span className="rule-id">{r.rule_id}</span>
        <ResultTag result={r.result} />
      </div>
      <div className="rule-expl">{r.explanation}</div>
      <div className="rule-inv">Changes if: {r.invalidation}</div>
      {missing && missing.length > 0 ? <div className="rule-inv">Missing: {missing.join(", ")}</div> : null}
    </div>
  );
}

function FeatureLine({ features, ids }: { features: FeatureRow[]; ids: string[] }) {
  const map = new Map(features.map((f) => [f.feature_id, f]));
  return (
    <div className="feat-list">
      {ids.map((id) => {
        const f = map.get(id);
        return (
          <Fragment key={id}>
            <div>{id}</div>
            <div className={`fs st-${f?.status ?? "MISSING"}`}>
              {f ? (f.status === "OK" && f.value != null ? Number(f.value).toPrecision(4) : f.status) : "—"}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

export default async function CandidatePage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const c = await getCandidate(params.id);
  if (!c) notFound();
  const debug = searchParams.debug === "1";

  const [rulesMap, features, reason, dq, tl, alerts, history, replay, enrichment, ws] = await Promise.all([
    latestRulesFor([c.id]),
    latestFeatures(c.id),
    latestDecisionReason(c.id),
    dataQualityStatus(c.id),
    timeline(c.id),
    alertsForCandidate(c.id),
    stateHistory(c.id),
    replayData(c.id),
    getEnrichment(c.id),
    workerStatus(),
  ]);
  // Canonical decision view — the SAME data the board and Today render.
  const decision = (await getDecisionViews()).find((d) => d.id === c.id) ?? null;
  const rules = rulesMap.get(c.id) ?? [];
  const ruleResult = (id: string) => rules.find((r) => r.rule_id === id)?.result;
  const now = Date.now();
  const incomplete = dq && dq !== "OK";
  const readiness = readinessFor(c, rules, features);
  const datasets = enrichment?.datasets ?? {};
  const dsKeys = Object.keys(datasets);
  const dsComplete = dsKeys.filter((k) => datasets[k]!.status === "OK").length;
  // Single source of truth for the on-chain banner: live Helius mode + latest
  // enrichment datasets + latest Safety family — NOT the stale snapshot dq.
  const heliusMode = String((ws?.detail as { heliusMode?: string })?.heliusMode ?? "UNKNOWN");
  const safetyRules = rules.filter((r) => r.family === "SAFETY").map((r) => r.result);
  const safetyFamily = safetyRules.length === 0 ? "NA" : safetyRules.includes("FAIL") ? "FAIL" : safetyRules.includes("INCOMPLETE") ? "INCOMPLETE" : safetyRules.includes("PASS") ? "PASS" : "NA";
  const onchain = describeOnChain(heliusMode, datasets, safetyFamily as "PASS" | "FAIL" | "INCOMPLETE" | "NA");

  return (
    <>
      <div style={{ marginBottom: 14, display: "flex", justifyContent: "space-between" }}>
        <a className="mono" href="/today" style={{ color: "var(--muted)" }}>← Today</a>
        <Link className="mono" href={debug ? `/candidate/${c.id}` : `/candidate/${c.id}?debug=1`} style={{ color: debug ? "var(--gold)" : "var(--muted)" }}>
          {debug ? "✕ exit debug mode" : "⚙ debug mode"}
        </Link>
      </div>

      {decision ? <DecisionHeader v={decision} now={now} /> : (
        <div className="banner warn">
          <b>{onchain.headline}</b> · Helius <b className={heliusMode === "LIVE" ? "tg-on" : "tg-off"}>{heliusMode}</b>. {onchain.detail}
        </div>
      )}

      {/* Both charts, directly under the coin: ours carries the plan levels and is the
          series the engine judged; Dexscreener's has the candles. Theirs is collapsed
          by default so the page does not load a third-party frame nobody asked for. */}
      {decision ? (
        <section className="detail-charts">
          <PriceChart
            points={decision.priceSeries}
            entry={decision.plan?.valid ? decision.plan.entryAreaLow : null}
            stop={decision.plan?.valid ? decision.plan.invalidation : null}
            target={decision.plan?.valid ? decision.plan.target : null}
            height={140}
          />
          <DexChart mint={decision.mint} pool={decision.pool} />
        </section>
      ) : null}

      {reason ? <div className="whystate">Why this state: {reason.reason}</div> : null}

      {readiness ? (
        <>
          <div className="readiness-head">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <b>Readiness</b>
              <span className="lmc">{c.last_meaningful_change_at ? `last meaningful change ${ago(c.last_meaningful_change_at, now)} ago` : ""}</span>
            </div>
            <div className="readiness-grid">
              <div><div className="lab">Safety coverage</div><div className="val"><FamilyCount c={readiness.safety} /></div></div>
              <div><div className="lab">Quality coverage</div><div className="val"><FamilyCount c={readiness.quality} /></div></div>
              <div><div className="lab">Entry coverage</div><div className="val"><FamilyCount c={readiness.entry} /></div></div>
              <div><div className="lab">Data completeness</div><div className="val">{readiness.dataCompleteness != null ? `${Math.round(readiness.dataCompleteness * 100)}%` : "—"}</div></div>
            </div>
          </div>

          <div className="whynot">
            <h3>Why not progressing?</h3>
            <div style={{ marginBottom: 8 }}><b>Current state:</b> {c.current_state} — {readiness.stateReason || reason?.reason}</div>
            {readiness.primaryBlocker ? <div style={{ marginBottom: 8 }}><b>Blocked by:</b> <span style={{ color: "var(--amber)" }}>{readiness.primaryBlocker}</span></div> : null}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <div className="lab" style={{ color: "var(--muted-2)", fontSize: 10, textTransform: "uppercase" }}>Already confirmed</div>
                <ul>{readiness.confirmedChecks.length ? readiness.confirmedChecks.map((x, i) => <li key={i} className="chk-ok">{x}</li>) : <li className="mono">none yet</li>}</ul>
              </div>
              <div>
                <div className="lab" style={{ color: "var(--muted-2)", fontSize: 10, textTransform: "uppercase" }}>Still missing</div>
                <ul>{readiness.missingData.length ? readiness.missingData.map((x, i) => <li key={i} className="chk-miss">{x}</li>) : <li className="mono">none</li>}</ul>
              </div>
            </div>
            {readiness.nextConditions.length ? (
              <div><div className="lab" style={{ color: "var(--muted-2)", fontSize: 10, textTransform: "uppercase" }}>Next conditions</div>
                <ul>{readiness.nextConditions.map((x, i) => <li key={i} className="chk-miss">{x}</li>)}</ul></div>
            ) : null}
            <div className="lmc">Next eligible state: {readiness.nextEligibleState ?? "— (a failure blocks progression until re-evaluation)"}</div>
          </div>
        </>
      ) : null}

      {enrichment ? (
        <div className="section" style={{ marginBottom: 16 }}>
          <h3>On-chain enrichment (Helius)</h3>
          <div className="readiness-grid" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
            <div><div className="lab">Status</div><div className={`val enr-${enrichment.status}`}>{enrichment.status.replace(/_/g, " ")}</div></div>
            <div><div className="lab">Datasets complete</div><div className="val mono">{dsKeys.length ? `${dsComplete}/${dsKeys.length}` : "—"}</div></div>
            <div><div className="lab">Monitoring tier</div><div className="val mono">{enrichment.monitoring_tier.replace("TIER", "T").replace(/_.*/, "")} · {enrichment.monitoring_tier.replace(/TIER\d_/, "")}</div></div>
            <div><div className="lab">Next scan</div><div className="val mono">{enrichment.next_scan_at ? `${ago(enrichment.next_scan_at, now)} ago→` : "—"}</div></div>
          </div>
          {enrichment.status === "NOT_REQUESTED" ? (
            <div className="rule-inv" style={{ marginTop: 8 }}>Awaiting Helius configuration — set <span className="mono">HELIUS_API_KEY</span> in .env.local. This is a <b>data wait</b>, not a rule failure.</div>
          ) : null}
          {enrichment.last_error ? <div className="rule-inv" style={{ marginTop: 8, color: "var(--red)" }}>Last error: {enrichment.last_error} (attempt {enrichment.attempts})</div> : null}
          {enrichment.last_success_at ? <div className="lmc" style={{ marginTop: 6 }}>Last successful enrichment {ago(enrichment.last_success_at, now)} ago · {enrichment.data_version}</div> : null}

          {dsKeys.length ? (
            <div className="feat-list" style={{ marginTop: 10 }}>
              {dsKeys.map((k) => (
                <Fragment key={k}>
                  <div>{k.replace(/_/g, " ")}</div>
                  <div className={`fs ${datasets[k]!.status === "OK" ? "st-OK" : "st-MISSING"}`}>{datasets[k]!.status}{datasets[k]!.reason ? <span className="mono" style={{ color: "var(--muted-2)" }}> · {datasets[k]!.reason}</span> : null}</div>
                </Fragment>
              ))}
            </div>
          ) : null}

          <h3 style={{ marginTop: 14, fontSize: 12 }}>Rules blocked by on-chain data</h3>
          <div className="feat-list">
            {HELIUS_DEPENDENT_RULES.map((rid) => {
              const res = ruleResult(rid);
              return (
                <Fragment key={rid}>
                  <div className="mono">{rid}</div>
                  <div className={`fs res-${res ?? "INCOMPLETE"}`}>{res ?? "—"}{res === "INCOMPLETE" ? <span className="mono" style={{ color: "var(--muted-2)" }}> · awaiting data</span> : null}</div>
                </Fragment>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="section" style={{ marginBottom: 16 }}>
        <h3>Replay — lifecycle</h3>
        <Replay data={replay} />
      </div>

      <div className="sections">
        <div className="section">
          <h3>Safety {readiness ? <FamilyCount c={readiness.safety} /> : null}</h3>
          {byFamily(rules, "SAFETY").map((r) => <RuleItem key={r.rule_id} r={r} />)}
          {byFamily(rules, "SAFETY").length === 0 ? <div className="mono">not evaluated yet</div> : null}
          {reason ? <div className="rule-inv" style={{ marginTop: 10 }}>Cannot progress: {reason.reason}</div> : null}
        </div>

        <div className="section">
          <h3>Quality {readiness ? <FamilyCount c={readiness.quality} /> : null}</h3>
          {byFamily(rules, "QUALITY").map((r) => <RuleItem key={r.rule_id} r={r} />)}
          <h3 style={{ marginTop: 14 }}>Feature values</h3>
          <FeatureLine features={features} ids={["unique_buyer_growth", "buyer_seller_ratio", "liquidity_retention_1h", "liquidity_retention_6h", "wallet_group_diversity", "boost_dependency"]} />
        </div>

        <div className="section">
          <h3>Entry {readiness ? <FamilyCount c={readiness.entry} /> : null}</h3>
          {byFamily(rules, "ENTRY").map((r) => <RuleItem key={r.rule_id} r={r} />)}
          <FeatureLine features={features} ids={["price_distance_from_range", "price_drawdown_from_local_high"]} />
        </div>

        <div className="section">
          <h3>Alerts</h3>
          {alerts.length === 0 ? (
            <div className="mono" style={{ color: "var(--muted)" }}>
              No alerts. Not alert-worthy yet: {reason ? reason.reason.toLowerCase() : "awaiting evaluation"}.
              {incomplete ? " On-chain confirmation is required before any entry alert." : ""}
            </div>
          ) : (
            alerts.map((a) => (
              <div key={a.id} className="rule">
                <div className="rule-head">
                  <span className={`lvl lvl-${a.level}`}>{a.level.replace(/_/g, " ")}</span>
                  <span className={`mono dstat-${a.delivery_status ?? "PENDING"}`}>{a.delivery_status ?? "—"}{a.telegram_message_id ? ` · tg#${a.telegram_message_id}` : ""}</span>
                </div>
                <div className="rule-expl">{a.state_from ?? "—"} → {a.state_to} · {ago(a.created_at, now)} ago</div>
                {a.last_error ? <div className="rule-inv">last error: {a.last_error}</div> : null}
              </div>
            ))
          )}
        </div>

        <div className="section">
          <h3>Timeline</h3>
          <ul className="timeline">
            {tl.map((t, i) => (
              <li key={i}>
                <span className="tt">{ago(t.at, now)} ago</span>
                <span className="ty">{t.type}</span>
                <span>{t.label}{t.detail ? <span className="mono"> — {t.detail}</span> : null}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {debug ? (
        <div className="section" style={{ marginTop: 14, borderColor: "var(--gold-dim)" }}>
          <h3>Debug — why this state</h3>
          <div className="rule-inv" style={{ marginBottom: 12 }}>
            Aggregates: safety=<b>{history[0]?.safety_status ?? "—"}</b> · entry=<b>{history[0]?.entry_status ?? "—"}</b> · data-quality=<b>{dq ?? "—"}</b>.
            State reducer output: <b>{c.current_state}</b> — {reason?.reason ?? "not yet evaluated"}.
          </div>

          <h3 style={{ marginTop: 10 }}>All feature values ({features.length})</h3>
          <table className="grid">
            <thead><tr><th>feature</th><th>status</th><th>value</th><th>version</th><th>evidence#</th><th>reason / explanation</th></tr></thead>
            <tbody>
              {features.map((f) => (
                <tr key={f.feature_id}>
                  <td className="mono">{f.feature_id}</td>
                  <td className={`mono st-${f.status}`}>{f.status}</td>
                  <td className="mono">{f.value != null ? Number(f.value).toPrecision(6) : "—"}</td>
                  <td className="mono">{f.version}</td>
                  <td className="mono" style={{ color: "var(--muted-2)" }}>{f.evidence_hash ?? "—"}</td>
                  <td className="mono" style={{ whiteSpace: "normal", maxWidth: 300 }}>{f.missing_reason ?? f.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ marginTop: 16 }}>All rule evaluations ({rules.length})</h3>
          <table className="grid">
            <thead><tr><th>rule</th><th>family</th><th>result</th><th>severity</th><th>evidence#</th><th>explanation</th></tr></thead>
            <tbody>
              {[...rules].sort((a, b) => a.rule_id.localeCompare(b.rule_id)).map((r) => (
                <tr key={r.rule_id}>
                  <td className="mono">{r.rule_id}</td>
                  <td className="mono">{r.family}</td>
                  <td className={`mono res-${r.result}`}>{r.result}</td>
                  <td className="mono">{r.severity}</td>
                  <td className="mono" style={{ color: "var(--muted-2)" }}>{r.evidence_hash ?? "—"}</td>
                  <td className="mono" style={{ whiteSpace: "normal", maxWidth: 280 }}>{r.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ marginTop: 16 }}>State transitions ({history.length})</h3>
          <table className="grid">
            <thead><tr><th>when</th><th>from → to</th><th>safety</th><th>entry</th><th>reason</th></tr></thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i}>
                  <td>{ago(h.at, now)} ago</td>
                  <td className="mono">{h.from_state ?? "—"} → {h.to_state}</td>
                  <td className="mono">{h.safety_status ?? "—"}</td>
                  <td className="mono">{h.entry_status ?? "—"}</td>
                  <td className="mono" style={{ whiteSpace: "normal", maxWidth: 320 }}>{h.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
