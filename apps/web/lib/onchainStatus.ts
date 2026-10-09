/**
 * Single source of truth for describing on-chain (Helius) status on any page.
 * Pure — takes the SAME live inputs both /action-board and /candidate read
 * (worker Helius mode + latest enrichment datasets + Safety family result) and
 * returns a precise, non-misleading label. PARTIAL is never called UNAVAILABLE.
 */
import { DATASET_REGISTRY } from "@aureus/safety-engine";

export type OnChainLevel = "HELIUS_OFFLINE" | "ENRICHMENT_PARTIAL" | "ENRICHMENT_COMPLETE" | "SAFETY_COMPLETE";

export interface OnChainSummary {
  level: OnChainLevel;
  tone: "bad" | "warn" | "ok";
  headline: string;
  detail: string;
  implementedOk: number;
  implementedTotal: number;
  missingImplemented: string[]; // implemented datasets not yet OK
  notYetImplemented: string[]; // datasets that exist as placeholders (not built)
}

interface DatasetEntry { status: string; reason?: string }

export function describeOnChain(
  heliusMode: string | null | undefined,
  datasets: Record<string, DatasetEntry> | null | undefined,
  safetyFamily: "PASS" | "FAIL" | "INCOMPLETE" | "NA" | null,
): OnChainSummary {
  const ds = datasets ?? {};
  const keys = Object.keys(ds);
  // Implemented/advisory is read from the explicit registry — NOT a regex on reason strings.
  const notYetImplemented = keys.filter((k) => DATASET_REGISTRY[k] ? !DATASET_REGISTRY[k]!.implemented : /not yet implemented/i.test(ds[k]?.reason ?? ""));
  const implemented = keys.filter((k) => !notYetImplemented.includes(k));
  const implementedOk = implemented.filter((k) => ds[k]?.status === "OK");
  const missingImplemented = implemented.filter((k) => ds[k]?.status !== "OK");
  const base = {
    implementedOk: implementedOk.length,
    implementedTotal: implemented.length,
    missingImplemented,
    notYetImplemented,
  };

  // 1) Helius genuinely offline / no data at all.
  const noData = keys.length === 0 || (heliusMode !== "LIVE" && implementedOk.length === 0);
  if (heliusMode !== "LIVE" && noData) {
    return {
      ...base, level: "HELIUS_OFFLINE", tone: "bad",
      headline: `HELIUS ${heliusMode === "DEGRADED" ? "DEGRADED" : "OFFLINE"}`,
      detail: "No on-chain data retrieved — Safety cannot PASS.",
    };
  }

  // 2) Safety complete — every dataset Safety requires is present (deployer, insider,
  //    bundle, sellability are Safety-required; today they're not-yet-implemented).
  if (safetyFamily === "PASS" && missingImplemented.length === 0 && notYetImplemented.length === 0) {
    return { ...base, level: "SAFETY_COMPLETE", tone: "ok", headline: "SAFETY COMPLETE", detail: "All Safety-required on-chain datasets present." };
  }

  // 3) Enrichment complete for every IMPLEMENTED dataset, but Safety-required datasets
  //    remain unimplemented → not a failure, an explicit data gap.
  if (missingImplemented.length === 0 && implemented.length > 0) {
    return {
      ...base, level: "ENRICHMENT_COMPLETE", tone: "warn",
      headline: "ENRICHMENT COMPLETE (implemented datasets)",
      detail: notYetImplemented.length
        ? `Safety still requires unimplemented datasets: ${notYetImplemented.join(", ")}. Missing critical data = UNKNOWN RISK, not a FAIL.`
        : "All implemented datasets present.",
    };
  }

  // 4) Partial — some datasets available. NEVER "UNAVAILABLE".
  const stillMissing = [...missingImplemented, ...notYetImplemented];
  return {
    ...base, level: "ENRICHMENT_PARTIAL", tone: "warn",
    headline: `ENRICHMENT PARTIAL — ${implementedOk.length}/${keys.length} datasets`,
    detail: `Available: ${implementedOk.length ? implementedOk.join(", ") : "none"}. Missing: ${stillMissing.join(", ") || "none"}. Missing critical on-chain data is UNKNOWN RISK, not UNAVAILABLE.`,
  };
}
