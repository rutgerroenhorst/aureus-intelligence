import { freshnessBand, ago } from "../lib/format";

const STATE_CLASS: Record<string, string> = {
  REJECTED: "b-red",
  UNRESOLVED: "b-amber",
  RESEARCHING: "b-neutral",
  STRUCTURE_WATCH: "b-blue",
  QUALITY_CONFIRMED: "b-green",
  ENTRY_WATCH: "b-amber",
  ENTRY_READY: "b-green",
  OVEREXTENDED: "b-amber",
  POSITION_RISK: "b-red",
  EXPIRED: "b-neutral",
};

export function StateBadge({ state }: { state: string }) {
  return <span className={`badge ${STATE_CLASS[state] ?? "b-neutral"}`}>{state.replace(/_/g, " ")}</span>;
}

export function Freshness({ at }: { at: string | null | undefined }) {
  const band = freshnessBand(at);
  const label = band === "none" ? "no data" : ago(at);
  return <span className={`mono fresh-${band}`}>{label === "no data" ? "no data" : `${label} ago`}</span>;
}

export function ResultTag({ result }: { result: string }) {
  return <span className={`mono res-${result}`}>{result}</span>;
}
