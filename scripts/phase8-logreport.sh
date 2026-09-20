#!/usr/bin/env bash
# Phase 8 — worker-log analyzer (READ-ONLY). Reconciles the enriched counter against
# raw job traces and derives the log-only metrics (latency, retries, dead-letters, 429s,
# queue depth min/max/end, duplicates prevented).
#
# Usage — point it at ~20 min of worker JSON logs:
#   docker logs --since 20m aureus_worker 2>&1 | ./scripts/phase8-logreport.sh
#   # or from a saved file:  ./scripts/phase8-logreport.sh worker.log
#
# Requires: jq. Every log line the worker emits is one JSON object.
set -euo pipefail
IN="${1:-/dev/stdin}"

# Keep only JSON lines (skip any non-JSON noise).
LOGS="$(grep -E '^\{' "$IN" || true)"

jq -rn --slurpfile _ <(printf '%s\n' "$LOGS" | jq -c '.') '
  # ISO-8601 → epoch seconds, tolerating fractional milliseconds (.NNN).
  def iso: (sub("\\.[0-9]+Z$";"Z") | fromdateiso8601)
           + ((capture("\\.(?<f>[0-9]+)Z$") | .f | ("0."+.) | tonumber) // 0);
  ($_ ) as $rows
  | ($rows | map(select(.msg=="job")))        as $jobs
  | ($rows | map(select(.msg=="cycle done"))) as $cycles

  # --- counter reconciliation (the enriched=0 question) ---
  | ($jobs | map(select(.stage=="acked"      and .job_type=="HELIUS_ENRICHMENT")) | length) as $ackedEnrich
  | ($jobs | map(select(.stage=="reevaluated"))                                    | length) as $reevaledJobs
  | ($cycles | map(.enriched // 0) | add // 0) as $sumEnriched
  | ($cycles | map(.reeval   // 0) | add // 0) as $sumReeval

  # --- enrichment -> reevaluation latency (pair reevaluated with prior enriched, same candidate) ---
  | ( reduce ($jobs | sort_by(.t)[]) as $j ({last:{}, lat:[]};
        if $j.stage=="enriched" then .last[$j.candidate_id] = $j.t
        elif $j.stage=="reevaluated" and (.last[$j.candidate_id] != null)
          then .lat += [ (($j.t|iso) - (.last[$j.candidate_id]|iso)) ] | .last[$j.candidate_id]=null
        else . end)
    ) as $L
  | ($L.lat | sort) as $lat
  | (if ($lat|length)>0 then ($lat|add)/($lat|length) else null end) as $avgLat
  | (if ($lat|length)>0 then $lat[(($lat|length)/2|floor)] else null end) as $medLat

  # --- queue depth / oldest age ---
  | ($cycles | map(.queueDepth // 0)) as $depths
  | ($cycles | map(.oldestJobAgeMs) | map(select(.!=null))) as $ages

  # --- reliability counters (cumulative stats on the last cycle) ---
  | ($cycles | map(.stats) | map(select(.!=null)) | last) as $lastStats
  | ($jobs | map(select(.stage=="error"  and (.error|tostring|test("429")))) | length) as $c429
  | ($jobs | map(select(.stage=="retried")) | length) as $retriedTraces
  | ($jobs | map(select(.stage=="error"  and (.outcome=="deadlettered"))) | length) as $deadTraces

  | "======================================================================",
    " PHASE 8 — 20-MINUTE LOG REPORT",
    "======================================================================",
    "cycles observed .......... \($cycles|length)",
    "",
    "-- totals --",
    "total enrichments ........ \($sumEnriched)   (job:acked HELIUS traces = \($ackedEnrich))",
    "total reevaluations ...... \($sumReeval)   (job:reevaluated traces = \($reevaledJobs))",
    "",
    "-- COUNTER RECONCILIATION (enriched=0 question) --",
    (if $sumEnriched==$ackedEnrich and $sumReeval==$reevaledJobs
       then "OK: Σ cycle.enriched == job:acked  AND  Σ cycle.reeval == job:reevaluated → counter is correct; per-cycle 0s are just cycles with no NEW enrichment that tick."
       else "MISMATCH: counter disagrees with traces → investigate (Σenriched=\($sumEnriched) vs acked=\($ackedEnrich); Σreeval=\($sumReeval) vs reevaluated=\($reevaledJobs))." end),
    "",
    "-- queue --",
    "queue depth min/max/end .. \($depths|min) / \($depths|max) / \($depths|last)",
    "oldest job age (max/end) . \(if ($ages|length)>0 then ($ages|max) else "n/a" end) ms / \(if ($ages|length)>0 then ($ages|last) else "null" end) ms",
    "unique queued (last) ..... \($cycles | map(.uniqueQueued) | map(select(.!=null)) | (last // "n/a"))",
    "",
    "-- reliability (cumulative) --",
    "duplicate jobs prevented . \($lastStats.duplicateEnqueue // 0)",
    "retries .................. \($lastStats.retried // 0)   (retry traces = \($retriedTraces))",
    "dead letters ............. \($lastStats.deadlettered // 0)   (dead traces = \($deadTraces))",
    "429 rate-limit events .... \($c429)",
    "",
    "-- latency (enrichment persisted → reevaluation completed) --",
    "samples .................. \($lat|length)",
    "avg / median ............. \(if $avgLat then ($avgLat|.*100|round/100|tostring)+" s" else "n/a" end) / \(if $medLat then ($medLat|.*100|round/100|tostring)+" s" else "n/a" end)"
'
