import { getFeedTelemetry } from "../../../lib/telemetry";
import { getScanState } from "../../../lib/cloudScan";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    // `scan` tells the shell when the data is from and whether it should ask for a fresh scan; it is optional
    // so the health dot still works if the lease table is unreachable.
    const [telemetry, scan] = await Promise.all([getFeedTelemetry(), getScanState().catch(() => null)]);
    return NextResponse.json({ ...telemetry, scan }, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err) {
    console.error("Telemetry API error:", err);
    return NextResponse.json(
      { error: "Failed to fetch telemetry" },
      { status: 500 }
    );
  }
}
