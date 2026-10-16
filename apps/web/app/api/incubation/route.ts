import { internalFetch } from "@/lib/internalFetch";
import { flaggedPayload, gateLive } from "@/lib/liveGate";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
// the live red-flag gate asks DexScreener about every coin it is about to show (lib/liveGate.ts); a slow exchange ends in "kept", but the call must be allowed the time
export const maxDuration = 30;

export async function GET() {
  try {
    // Use safety-gate to get pre-filtered safe candidates
    const safeRes = await internalFetch(`/api/safety-gate`, {
      cache: "no-store",
    });

    if (!safeRes.ok) {
      return NextResponse.json({ candidates: [] });
    }

    const safeData = await safeRes.json();
    const candidates = safeData.safe_candidates || [];
    const now = Date.now();

    // INCUBATION: <4 hours + micro-cap (all already passed safety-gate)
    const incubation = candidates
      .filter((c: any) => {
        const discoveredAt = new Date(c.discovered_at).getTime();
        const minutesOld = Math.floor((now - discoveredAt) / (1000 * 60));
        const mcap = Number(c.marketCapUsd || 0);

        // Must be <4 hours old
        if (minutesOld > 240) return false;

        // Must be in micro-cap range
        if (mcap < 50000 || mcap > 500000) return false;

        return true;
      })
      .sort((a: any, b: any) => {
        // Score by: good mcap position + fresh
        const aMcap = Number(a.marketCapUsd || 0);
        const bMcap = Number(b.marketCapUsd || 0);
        const aAge = (now - new Date(a.discovered_at).getTime()) / (1000 * 60);
        const bAge = (now - new Date(b.discovered_at).getTime()) / (1000 * 60);

        // Fresh coins at good mcap level
        return (aAge - bAge) || (aMcap - bMcap);
      })
      .slice(0, 60);

    // judged as it is now (lib/liveGate.ts, docs/RED_FLAGS.md): a coin that has rugged, collapsed or stopped trading since the last scan is left out
    const gate = await gateLive(incubation, { mintOf: (c: any) => c.mint });

    return NextResponse.json({
      candidates: gate.kept.slice(0, 50),
      ...flaggedPayload(gate),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ candidates: [] });
  }
}
