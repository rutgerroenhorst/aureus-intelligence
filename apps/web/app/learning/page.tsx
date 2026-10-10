"use client";
import { useState } from "react";
import { usePolling } from "@/lib/usePolling";
import s from "./lab.module.css";
import { Empty } from "./parts";
import { ago } from "./format";
import { Overview } from "./Overview";
import { InsightsView } from "./Insights";
import { Filters } from "./Filters";
import { Live } from "./Live";
import { Lifecycle } from "./Lifecycle";
import { Models } from "./Models";
import { Hypotheses } from "./Hypotheses";
import { Cases } from "./Cases";
import { TabsLegacy } from "./TabsLegacy";
import type { LabData } from "./types";

const VIEWS = [
  { id: "overview", label: "Overview" },
  { id: "go", label: "Why coins go" },
  { id: "not", label: "Why coins don't" },
  { id: "filters", label: "Filters" },
  { id: "live", label: "Live coins" },
  { id: "life", label: "Life of a coin" },
  { id: "models", label: "Models" },
  { id: "ideas", label: "Hypotheses" },
  { id: "case", label: "Case: HOTBOT" },
  { id: "tabs", label: "Tabs" },
] as const;
type View = (typeof VIEWS)[number]["id"];

export default function LearningPage() {
  const [data, setData] = useState<LabData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("overview");

  // First load always; then every minute while the screen is in use (the analyses themselves are recomputed about hourly).
  usePolling(async () => {
    try {
      const res = await fetch("/api/lab", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError("The Learning Lab could not be loaded right now.");
    }
  }, 60_000);

  const ready = data && data.overview && data.meta;
  return (
    <div className={s.page}>
      <div className={s.head}>
        <h1>Learning Lab</h1>
        <p>What the system has learned from every coin it has followed, from the first look to the end: why coins go, why they don't, and which of its own rules help or hurt. Every claim comes with its sample size and is only called a finding when it holds up on coins it was not fitted to.</p>
        {ready && (
          <div className={s.chips}>
            <span className={s.chip}>{data!.meta!.coins.toLocaleString()} coins</span>
            <span className={s.chip}>{data!.overview!.firstSeen ? `${data!.overview!.firstSeen!.days.toFixed(0)} days of data` : "no data"}</span>
            <span className={s.chip}>updated {ago(data!.computedAt)}</span>
          </div>
        )}
      </div>

      <div className={s.nav} role="tablist">
        {VIEWS.map((v) => (
          <button key={v.id} role="tab" aria-selected={view === v.id} className={`${s.navBtn} ${view === v.id ? s.navBtnOn : ""}`} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </div>

      {error && !data && <Empty>{error}</Empty>}
      {!data && !error && <Empty>Loading the lab…</Empty>}
      {data && !ready && (
        <Empty>
          The lab has not analysed any coin yet. It builds its first lessons on the next learning round, a few minutes after a scan.
        </Empty>
      )}
      {ready && (
        <>
          {view === "overview" && <Overview d={data!} />}
          {view === "go" && <InsightsView key="go" d={data!} target="go2" />}
          {view === "not" && <InsightsView key="not" d={data!} target="collapse24" />}
          {view === "filters" && <Filters d={data!} />}
          {view === "live" && <Live d={data!} />}
          {view === "life" && <Lifecycle d={data!} />}
          {view === "models" && <Models d={data!} />}
          {view === "ideas" && <Hypotheses d={data!} />}
          {view === "case" && <Cases d={data!} />}
          {view === "tabs" && <TabsLegacy d={data!} />}
        </>
      )}
    </div>
  );
}
