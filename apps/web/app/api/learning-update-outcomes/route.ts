import { NextResponse } from "next/server";
import { updateOutcomes } from "@/lib/learning-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Re-measures the coins that are still open and labels the ones that can be labelled. The site runs this by itself
// (lib/cloudScan.ts); the route stays for running it by hand. The labelling rules are in lib/learning-engine.ts.
export async function POST() {
  try {
    const r = await updateOutcomes();
    return NextResponse.json({ updated_count: r.checked, total_pending: r.pending, ...r });
  } catch (err) {
    console.error("[learning-update-outcomes] Error:", err);
    return NextResponse.json({ error: "Failed to update outcomes", details: String(err) }, { status: 500 });
  }
}
