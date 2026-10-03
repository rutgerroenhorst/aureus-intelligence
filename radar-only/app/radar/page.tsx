"use client";

import { RadarLive } from "./RadarLive";

const MOCK_DATA = {
  CATE: [
    {
      mint: "Coin1",
      symbol: "CATE",
      marketCapUsd: 45000,
      liquidityUsd: 12000,
      volumeUsd: 8500,
      discoveredAt: new Date(Date.now() - 3600000).toISOString(),
      code: "C001",
      v2StructuralStatus: "STRUCTURALLY_QUALIFIED",
      v2PassedGates: [
        { gateId: "G1", reason: "Liquidity threshold passed" },
        { gateId: "G2", reason: "Volume spike detected" }
      ]
    }
  ]
};

export default function RadarPage() {
  return (
    <div style={{ width: "100%", minHeight: "100vh" }}>
      <RadarLive initial={{
        sectionTotals: {},
        generatedAt: new Date().toISOString(),
        worker: { online: true, status: "OK", heliusMode: "UNKNOWN", lastCycleAt: null, lastEnrichmentAt: null },
        counts: {} as any,
        best: null,
        sections: {} as any
      }} />
    </div>
  );
}
