import type { Readiness, FamilyCoverage } from "@aureus/readiness";

function pct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

/** Compact "S 0/0/4" style coverage chips (pass / fail / incomplete). */
export function CoverageChips({ r }: { r: Readiness }) {
  const fams: Array<[string, FamilyCoverage]> = [["S", r.safety], ["Q", r.quality], ["E", r.entry]];
  return (
    <div className="cov">
      {fams.map(([k, f]) => (
        <span key={k} className="covfam" title={`${k}: ${f.pass} pass / ${f.fail} fail / ${f.incomplete} incomplete`}>
          <span className="fam">{k}</span>{" "}
          <span className="p">{f.pass}</span>/<span className="f">{f.fail}</span>/<span className="i">{f.incomplete}</span>
        </span>
      ))}
      <span className="covfam"><span className="fam">Data</span> {pct(r.dataCompleteness)}</span>
    </div>
  );
}

/** Primary blocker + up to two readable blockers + remaining count (cards). */
export function BlockerLine({ r }: { r: Readiness }) {
  if (!r.primaryBlocker) return <span className="mono" style={{ color: "var(--muted-2)" }}>no active blocker</span>;
  return (
    <span className="risk">
      {r.primaryBlocker}
      {r.topBlockers.length > 0 ? (
        <span className="mono" style={{ color: "var(--muted-2)" }}>
          {" "}— {r.topBlockers.join(", ")}
          {r.blockerRemaining > 0 ? ` +${r.blockerRemaining} ${r.blockerRemainingLabel}` : ""}
        </span>
      ) : null}
    </span>
  );
}

export function StrongestPositive({ r }: { r: Readiness }) {
  if (!r.strongestPositive) return <span className="mono">none yet</span>;
  return <span className="pos">{r.strongestPositive.label} ✓</span>;
}
