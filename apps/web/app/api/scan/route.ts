import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { RETENTION_DAYS, claim, getScanState, runLearning, runRetention, runScan } from "@/lib/cloudScan";
import { isTrusted } from "@/lib/trusted";

export const dynamic = "force-dynamic";
// A scan has to fit in here: waitUntil() work counts against the function's maximum duration.
export const maxDuration = 300;

const noStore = { "Cache-Control": "no-store, max-age=0" };

/**
 * One tick: scan the market if the data is due, then grade/track coins if that is due. The work runs after
 * the response has been sent, so the browser is never left waiting on it.
 */
async function tick(force: boolean, only?: string | null) {
  const scan = only === "learning" ? false : await claim("scan", force);
  const learningNow = scan || only === "scan" ? false : await claim("learning", force);
  if (!scan && !learningNow) return { started: [] as string[] };

  waitUntil(
    (async () => {
      try {
        if (scan) {
          await runScan();
          // Right after a scan: the new coins are what the tabs list, so track them now.
          if (only !== "scan" && (await claim("learning", force))) await runLearning();
        } else {
          await runLearning();
        }
        // Housekeeping for the small hosted database; only when this deployment is configured for it.
        if (RETENTION_DAYS >= 2 && !only && (await claim("retention", force))) await runRetention();
      } catch (err) {
        console.error("[scan] tick failed", err);
      }
    })(),
  );
  return { started: [scan ? "scan" : "learning"] };
}

/** State for anyone; a tick when called by the scheduler with the secret. */
export async function GET(req: Request) {
  try {
    if (isTrusted(req)) {
      const q = new URL(req.url).searchParams;
      return NextResponse.json(await tick(q.get("force") === "1", q.get("only")), { headers: noStore });
    }
    return NextResponse.json(await getScanState(), { headers: noStore });
  } catch (err) {
    console.error("[scan] GET failed", err);
    return NextResponse.json({ error: "scan state unavailable" }, { status: 500, headers: noStore });
  }
}

/** The shell asks for a tick when telemetry says something is due. Safe to call often: leases decide. */
export async function POST(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const outside = isTrusted(req); // browsers cannot force or narrow a tick; only the scheduler with the secret can
    return NextResponse.json(await tick(outside && q.get("force") === "1", outside ? q.get("only") : null), { status: 202, headers: noStore });
  } catch (err) {
    console.error("[scan] POST failed", err);
    return NextResponse.json({ error: "scan could not start" }, { status: 500, headers: noStore });
  }
}
