export type V2StatusType = 
  | "STRUCTURALLY_QUALIFIED"
  | "INSUFFICIENT_DATA" 
  | "FATAL_REJECT"
  | "NO_V2_EVALUATION";

export function getV2Status(v2StructuralStatus: string | null): V2StatusType {
  if (!v2StructuralStatus) return "NO_V2_EVALUATION";
  if (v2StructuralStatus === "STRUCTURALLY_QUALIFIED") return "STRUCTURALLY_QUALIFIED";
  if (v2StructuralStatus === "INSUFFICIENT_DATA") return "INSUFFICIENT_DATA";
  if (v2StructuralStatus === "FATAL_REJECT") return "FATAL_REJECT";
  return "NO_V2_EVALUATION";
}

export const V2_STATUS_LABELS: Record<V2StatusType, { label: string; secondary?: string; color: string }> = {
  STRUCTURALLY_QUALIFIED: {
    label: "Structurally Qualified",
    secondary: "Deep verification pending",
    color: "text-emerald-400"
  },
  INSUFFICIENT_DATA: {
    label: "More Data Required",
    color: "text-amber-400"
  },
  FATAL_REJECT: {
    label: "Rejected",
    color: "text-red-400"
  },
  NO_V2_EVALUATION: {
    label: "No Verification Yet",
    color: "text-gray-500"
  }
};
