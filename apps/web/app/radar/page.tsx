"use client";
import { useMemo, useState } from "react";
import ElitePageWrapper from "@/components/ElitePageWrapper";
import { usePolling, useOnScanDone } from "@/lib/usePolling";
import { RunnersTab, type Runner, type RunnersLab, type RunnersPrior } from "./RunnersTab";
import { GraduatesTab, type Graduate, type GradMeta } from "./GraduatesTab";
import { HotChainsBar, HotTab, isNewSmall, type HotClient } from "./HotChains";
import { AwayLine, CheckHubContext, type CheckAnswer, type CheckHub, type CheckNote } from "./CoinCheck";
import { CoinRow, UltraCard } from "./CoinRow";
import { leaveOut, mergeNotes, noteKey } from "@/lib/checkAway";

interface Candidate {
  id: string;
  symbol: string | null;
  mint: string;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  discovered_at: string;
}

type Tab = "hot" | "cate" | "signals" | "positions" | "trends" | "momentum" | "performance" | "elite-s" | "early" | "entry" | "qualified" | "stats" | "runners" | "graduates";

// The name the learning system and the trade journal use for each Radar tab.
const JOURNAL_TAB: Partial<Record<Tab, string>> = {
  cate: "cate",
  signals: "buy_signals",
  early: "ultra_momentum",
  "elite-s": "elite",
  qualified: "incubation",
  runners: "runners",
  graduates: "graduates",
  hot: "hot",
};

/** One tab button. Not defined inside the page: a component defined inside another is a new element on every render, and a click that lands while the page renders is lost. */
function TabButton({ label, count, active, onSelect }: { label: string; count?: number; active: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      style={{
        padding: "8px 16px",
        background: active ? "#34c759" : "#1a1a1f",
        color: active ? "#000" : "#8a8a8e",
        border: `1px solid ${active ? "#34c759" : "#2a2a2f"}`,
        borderRadius: "6px",
        cursor: "pointer",
        fontSize: "12px",
        fontWeight: 700,
      }}
    >
      {label} {count !== undefined && <span style={{ opacity: 0.8 }}>({count})</span>}
    </button>
  );
}

export default function RadarPageElite() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [eliteCandidates, setEliteCandidates] = useState<any[]>([]);
  const [ultraEarlyCandidates, setUltraEarlyCandidates] = useState<any[]>([]);
  const [ultraEarlyMomentum, setUltraEarlyMomentum] = useState<any[]>([]);
  const [incubationCandidates, setIncubationCandidates] = useState<any[]>([]);
  const [cateCoins, setCateCoins] = useState<any[]>([]);
  const [cateSummary, setCateSummary] = useState<any>(null);
  const [buySignals, setBuySignals] = useState<any[]>([]);
  const [graduates, setGraduates] = useState<Graduate[]>([]);
  const [gradMeta, setGradMeta] = useState<GradMeta | null>(null);
  const [gradLab, setGradLab] = useState<{ followed3d: number; held2: { p: number } } | null>(null);
  const [runners, setRunners] = useState<Runner[]>([]);
  const [runnersLab, setRunnersLab] = useState<RunnersLab | null>(null);
  const [runnersPrior, setRunnersPrior] = useState<RunnersPrior | null>(null);
  const [failedEntries, setFailedEntries] = useState<Set<string>>(new Set());
  const [positions, setPositions] = useState<any[]>([]);
  const [trends, setTrends] = useState<any[]>([]);
  const [momentum, setMomentum] = useState<any[]>([]);
  const [performance, setPerformance] = useState<any>(null);
  const [networks, setNetworks] = useState<any[]>([]);
  const [safety, setSafety] = useState<{ total: number; safe: number; rejected: number; unverified: number; noData: number } | null>(null);
  const [selectedChain, setSelectedChain] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("hot");
  const [hot, setHot] = useState<HotClient | null>(null);
  const [hotChain, setHotChain] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [scrollPositions, setScrollPositions] = useState<{[key in Tab]: number}>({
    hot: 0, cate: 0, signals: 0, positions: 0, trends: 0, momentum: 0, performance: 0,
    "elite-s": 0, early: 0, entry: 0, qualified: 0, stats: 0, runners: 0, graduates: 0
  });
  const [enteredCoins, setEnteredCoins] = useState<Set<string>>(new Set());
  // the coins the user checked before, by "<tab>|<mint>" (the Check button: lib/coinCheck.ts)
  const [checkNotes, setCheckNotes] = useState<Map<string, CheckNote>>(new Map());
  // checks made on this screen since the last refresh, the answers that are open (their cards stay), and whether the coins the checks took off a list are shown anyway
  const [checkLocal, setCheckLocal] = useState<Map<string, CheckNote>>(new Map());
  const [checkOpen, setCheckOpen] = useState<Set<string>>(new Set());
  const [showAway, setShowAway] = useState(false);

  // One request for everything (/api/radar-bundle), and only while the screen is visible.
  // A source that failed comes back as null: keep showing its previous data instead of blanking it.
  const fetchAll = async () => {
    try {
      setIsRefreshing(true);
      const res = await fetch("/api/radar-bundle", { cache: "no-store" });
      if (!res.ok) throw new Error(`radar-bundle ${res.status}`);
      const { data: d, failed } = await res.json();
      setFailedSources(Array.isArray(failed) ? failed : []);

      if (d.candidates) setCandidates(d.candidates.candidates || []);
      if (d.elite) setEliteCandidates(d.elite.candidates || []);
      if (d.ultraEarly) setUltraEarlyCandidates(d.ultraEarly.candidates || []);
      if (d.ultraEarlyMomentum) setUltraEarlyMomentum(d.ultraEarlyMomentum.candidates || []);
      if (d.incubation) setIncubationCandidates(d.incubation.candidates || []);
      if (d.cate) {
        setCateCoins(d.cate.cateCoins || []);
        setCateSummary(d.cate.summary || null);
      }
      if (d.signals) setBuySignals(d.signals.buy_signals || []);
      if (d.graduates) {
        setGraduates(d.graduates.candidates || []);
        setGradLab(d.graduates.lab || null);
        setGradMeta({ summary: d.graduates.summary || [], source: d.graduates.source, asOf: d.graduates.asOf });
      }
      if (d.checks) setCheckNotes(new Map(((d.checks.checks ?? []) as CheckNote[]).map((n) => [`${n.tab}|${n.mint}`, n])));
      if (d.runners) {
        setRunners(d.runners.candidates || []);
        setRunnersLab(d.runners.lab || null);
        setRunnersPrior(d.runners.prior || null);
      }
      if (d.positions) setPositions(d.positions.positions || []);
      if (d.trends) setTrends(d.trends.candidates || []);
      if (d.momentum) setMomentum(d.momentum.candidates || []);
      if (d.performance) setPerformance(d.performance.metrics || {});
      if (d.networks) setNetworks(d.networks.networks || []);
      setSafety(d.safety || null);

      setLastUpdate(new Date());
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      setIsRefreshing(false);
    }
  };

  // every 30 s while in use (the hosted site keeps the answer for a minute anyway); idle and long-idle screens ask less, see usePolling
  usePolling(fetchAll, 30_000);
  usePolling(async () => {
    try {
      const res = await fetch("/api/hot-chains", { cache: "no-store" });
      if (!res.ok) return;
      const d = (await res.json()) as HotClient;
      if (d?.chains?.length) {
        setHot(d);
        // the network on screen stays where it is when the ranking changes (the first reading picks the hottest): otherwise the list switches under a click
        setHotChain((cur) => cur ?? d.chains[0]!.id);
      }
    } catch {
      /* keep what is on screen */
    }
  }, 60_000);
  // A scan has just finished: show its coins now instead of at the next 20 s tick.
  useOnScanDone(() => void fetchAll());

  // What the user's Checks do to the lists (lib/checkAway.ts): a coin the site agreed is dead, or has a serious problem, leaves its tab for a day.
  const hub = useMemo<CheckHub>(
    () => ({
      answered: (tab: string, mint: string, a: CheckAnswer) => setCheckLocal((prev) => new Map(prev).set(noteKey(tab, mint), { mint, tab, at: a.at, verdict: a.verdict, returned: false })),
      opened: (tab: string, mint: string, open: boolean) =>
        setCheckOpen((prev) => {
          const k = noteKey(tab, mint);
          if (prev.has(k) === open) return prev;
          const next = new Set(prev);
          if (open) next.add(k);
          else next.delete(k);
          return next;
        }),
    }),
    [],
  );
  const notes = useMemo(() => mergeNotes(checkNotes, checkLocal), [checkNotes, checkLocal]);
  const nowMs = Date.now();
  const split = <T,>(tab: string, list: T[], mintOf: (x: T) => string) => {
    const r = leaveOut(tab, list, mintOf, notes, checkOpen, nowMs);
    return { list: showAway ? list : r.shown, away: r.away.length };
  };
  const lists = {
    cate: split("cate", cateCoins, (c) => c.mint),
    signals: split("buy_signals", buySignals, (c) => c.mint),
    early: split("ultra_momentum", ultraEarlyMomentum, (c) => c.mint),
    elite: split("elite", eliteCandidates, (c) => c.mint),
    incubation: split("incubation", incubationCandidates, (c) => c.mint),
    runners: split("runners", runners, (c) => c.mint),
    graduates: split("graduates", graduates, (c) => c.mint),
  };
  // the Hot tab keeps its pools per network; the check works on the coin's address
  const hotChainNow = hot?.chains.find((c) => c.id === hotChain) ?? hot?.chains[0] ?? null;
  const hotAway = hot && hotChainNow ? leaveOut("hot", (hot.pools[hotChainNow.id] ?? []).filter(isNewSmall), (p) => p.address, notes, checkOpen, nowMs).away.length : 0;
  const hotShown: HotClient | null = hot && !showAway ? { ...hot, pools: Object.fromEntries(Object.entries(hot.pools).map(([id, l]) => [id, leaveOut("hot", l, (p) => p.address, notes, checkOpen, nowMs).shown])) } : hot;
  const awayHere: Partial<Record<Tab, number>> = { hot: hotAway, cate: lists.cate.away, signals: lists.signals.away, early: lists.early.away, "elite-s": lists.elite.away, qualified: lists.incubation.away, runners: lists.runners.away, graduates: lists.graduates.away };
  /** what a CoinRow needs to know about its tab */
  const rowProps = (c: any) => ({ tab: JOURNAL_TAB[activeTab], note: notes.get(noteKey(JOURNAL_TAB[activeTab] ?? "", c.mint)) });

  const selectTab = (tab: Tab) => {
    const contentDiv = document.querySelector('[data-tab-content]');
    if (contentDiv) {
      setScrollPositions(prev => ({ ...prev, [activeTab]: contentDiv.scrollTop }));
    }
    setActiveTab(tab);
    setTimeout(() => {
      const newContentDiv = document.querySelector('[data-tab-content]');
      if (newContentDiv) {
        newContentDiv.scrollTop = scrollPositions[tab] || 0;
      }
    }, 0);
  };

  /** "I entered this" for the lanes beyond the Radar's door (Runners, Graduations, Hot): one record in the trade journal, with the tab and the network. */
  const enterCoin = async (c: { symbol: string | null; mint: string; mcap: number | null; chain?: string }, tabKey: "runners" | "graduates" | "hot") => {
    try {
      const res = await fetch("/api/my-trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: c.symbol, mint: c.mint, chain: c.chain ?? "solana", entryMcap: c.mcap, tab: JOURNAL_TAB[tabKey] ?? null, action: "add-entry" }),
      });
      if (!res.ok) throw new Error(`my-trades ${res.status}`);
      setEnteredCoins((prev) => new Set([...prev, c.mint]));
      setFailedEntries((prev) => { const n = new Set(prev); n.delete(c.mint); return n; });
    } catch (err) {
      console.error("Could not save the entry:", err);
      setFailedEntries((prev) => new Set([...prev, c.mint]));
    }
  };

  /** "I entered this" on the Ultra Momentum tab: the record in the trade journal, and a green "Entered" for three seconds. */
  const enterUltra = async (c: any) => {
    try {
      const res = await fetch("/api/my-trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: c.symbol, mint: c.mint, entryMcap: c.mcap, tab: JOURNAL_TAB.early ?? null, action: "add-entry" }),
      });
      if (!res.ok) throw new Error(`my-trades ${res.status}`);
      setEnteredCoins((prev) => new Set([...prev, c.mint]));
      setTimeout(
        () =>
          setEnteredCoins((prev) => {
            const next = new Set(prev);
            next.delete(c.mint);
            return next;
          }),
        3000,
      );
    } catch (err) {
      console.error("Entry track error:", err);
      window.alert("Not saved: the trade could not be recorded. Try again.");
    }
  };

  const renderCATECoins = () => {
    const elite = lists.cate.list.filter(c => c.tier === "🚀 ELITE");
    const hot = lists.cate.list.filter(c => c.tier === "🔥 HOT");
    const rising = lists.cate.list.filter(c => c.tier === "⚡ RISING");
    const watch = lists.cate.list.filter(c => c.tier === "📊 WATCH");
    // the tiles count what the list shows: with coins left out they would say more than the list holds
    const tiles = cateSummary && lists.cate.away && !showAway ? { ...cateSummary, elite: elite.length, hot: hot.length, rising: rising.length, watch: watch.length } : cateSummary;

    return (
      <div style={{ padding: "16px" }}>
        {tiles && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "8px",
            marginBottom: "24px",
            fontSize: "12px"
          }}>
            <div style={{ background: "#1a1a1f", padding: "12px", borderRadius: "6px", textAlign: "center" }}>
              <div style={{ color: "#34c759", fontWeight: 700, fontSize: "16px" }}>{tiles.elite || 0}</div>
              <div style={{ color: "#8a8a8e", marginTop: "4px" }}>🚀 Elite</div>
            </div>
            <div style={{ background: "#1a1a1f", padding: "12px", borderRadius: "6px", textAlign: "center" }}>
              <div style={{ color: "#ff9500", fontWeight: 700, fontSize: "16px" }}>{tiles.hot || 0}</div>
              <div style={{ color: "#8a8a8e", marginTop: "4px" }}>🔥 Hot</div>
            </div>
            <div style={{ background: "#1a1a1f", padding: "12px", borderRadius: "6px", textAlign: "center" }}>
              <div style={{ color: "#30b0c0", fontWeight: 700, fontSize: "16px" }}>{tiles.rising || 0}</div>
              <div style={{ color: "#8a8a8e", marginTop: "4px" }}>⚡ Rising</div>
            </div>
            <div style={{ background: "#1a1a1f", padding: "12px", borderRadius: "6px", textAlign: "center" }}>
              <div style={{ color: "#8a8a8e", fontWeight: 700, fontSize: "16px" }}>{tiles.watch || 0}</div>
              <div style={{ color: "#8a8a8e", marginTop: "4px" }}>📊 Watch</div>
            </div>
          </div>
        )}

        {elite.length > 0 && (
          <>
            <h3 style={{ color: "#34c759", marginBottom: "12px" }}>🚀 ELITE ({elite.length})</h3>
            {elite.map((c, i) => <CoinRow key={`elite-${c.mint ?? i}`} c={c} color="#34c759" score={c.cateScore} {...rowProps(c)} />)}
          </>
        )}

        {hot.length > 0 && (
          <>
            <h3 style={{ color: "#ff9500", marginBottom: "12px", marginTop: "16px" }}>🔥 HOT ({hot.length})</h3>
            {hot.map((c, i) => <CoinRow key={`hot-${c.mint ?? i}`} c={c} color="#ff9500" score={c.cateScore} {...rowProps(c)} />)}
          </>
        )}

        {rising.length > 0 && (
          <>
            <h3 style={{ color: "#30b0c0", marginBottom: "12px", marginTop: "16px" }}>⚡ RISING ({rising.length})</h3>
            {rising.map((c, i) => <CoinRow key={`rising-${c.mint ?? i}`} c={c} color="#30b0c0" score={c.cateScore} {...rowProps(c)} />)}
          </>
        )}

        {watch.length > 0 && (
          <>
            <h3 style={{ color: "#8a8a8e", marginBottom: "12px", marginTop: "16px" }}>📊 WATCH ({watch.length})</h3>
            {watch.map((c, i) => <CoinRow key={`watch-${c.mint ?? i}`} c={c} color="#8a8a8e" score={c.cateScore} {...rowProps(c)} />)}
          </>
        )}

        {lists.cate.list.length === 0 && (
          <div style={{ textAlign: "center", color: "#8a8a8e", padding: "32px" }}>
            No CATE signals yet...
          </div>
        )}
      </div>
    );
  };

  const renderContent = () => {
    switch (activeTab) {
      case "hot":
        return <HotTab hot={hotShown} chain={hotChain} entered={enteredCoins} failedMints={failedEntries} notes={notes} onEnter={(p) => enterCoin({ symbol: p.symbol, mint: p.address, mcap: p.mcap, chain: p.chain }, "hot")} />;
      case "cate":
        return renderCATECoins();
      case "signals":
        return (
          <div style={{ padding: "16px" }}>
            <h3 style={{ color: "#34c759", marginBottom: "16px" }}>🎯 Buy Signals - Entry Opportunities ({lists.signals.list.length})</h3>
            {lists.signals.list.length > 0 ? (
              lists.signals.list.map((c, i) => <CoinRow key={`buy-${c.mint ?? i}`} c={c} color="#34c759" isBuySignal={true} {...rowProps(c)} />)
            ) : (
              <div style={{ textAlign: "center", color: "#8a8a8e", padding: "32px" }}>
                No viable buy signals right now. Check back soon! 🔄
              </div>
            )}
          </div>
        );
      case "graduates":
        return <GraduatesTab coins={lists.graduates.list} lab={gradLab} meta={gradMeta} entered={enteredCoins} failedMints={failedEntries} notes={notes} onEnter={(c) => enterCoin(c, "graduates")} />;
      case "runners":
        return (
          <RunnersTab
            runners={lists.runners.list}
            lab={runnersLab}
            prior={runnersPrior}
            entered={enteredCoins}
            failedMints={failedEntries}
            notes={notes}
            onEnter={(c) => enterCoin(c, "runners")}
          />
        );
      case "early":
        return (
          <div style={{ padding: "16px" }}>
            <h3 style={{ color: "#ff9500", marginBottom: "16px" }}>🚀 Ultra Early Momentum ({lists.early.list.length})</h3>
            {lists.early.list.length > 0 ? (
              lists.early.list.map((c, i) => <UltraCard key={c.mint ?? i} c={c} entered={enteredCoins.has(c.mint)} onEnter={() => void enterUltra(c)} tab={JOURNAL_TAB.early} note={notes.get(noteKey("ultra_momentum", c.mint))} />)
            ) : (
              <div style={{ textAlign: "center", color: "#8a8a8e", padding: "32px" }}>
                No ultra-early momentum signals yet. Waiting for net launches... 🚀
              </div>
            )}
          </div>
        );
      case "elite-s":
        return (
          <div style={{ padding: "16px" }}>
            <h3 style={{ color: "#34c759", marginBottom: "16px" }}>Elite ({lists.elite.list.length})</h3>
            {lists.elite.list.map((c, i) => <CoinRow key={c.mint ?? i} c={c} color="#34c759" {...rowProps(c)} />)}
          </div>
        );
      case "qualified":
        return (
          <div style={{ padding: "16px" }}>
            <h3 style={{ color: "#5ac8fa", marginBottom: "16px" }}>Incubation ({lists.incubation.list.length})</h3>
            {lists.incubation.list.map((c, i) => <CoinRow key={c.mint ?? i} c={c} color="#5ac8fa" {...rowProps(c)} />)}
          </div>
        );
      case "stats":
        return (
          <div style={{ padding: "16px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
              <div style={{ background: "#1a1a1f", padding: "16px", borderRadius: "8px" }}>
                <div style={{ fontSize: "11px", color: "#8a8a8e" }}>Total Candidates</div>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "#fff", marginTop: "8px" }}>{candidates.length}</div>
              </div>
              <div style={{ background: "#1a1a1f", padding: "16px", borderRadius: "8px" }}>
                <div style={{ fontSize: "11px", color: "#8a8a8e" }}>CATE Coins</div>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "#34c759", marginTop: "8px" }}>{cateCoins.length}</div>
              </div>
              <div style={{ background: "#1a1a1f", padding: "16px", borderRadius: "8px" }}>
                <div style={{ fontSize: "11px", color: "#8a8a8e" }}>Buy Signals</div>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "#34c759", marginTop: "8px" }}>{buySignals.length}</div>
              </div>
              <div style={{ background: "#1a1a1f", padding: "16px", borderRadius: "8px" }}>
                <div style={{ fontSize: "11px", color: "#8a8a8e" }}>Ultra Early</div>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "#ff9500", marginTop: "8px" }}>{ultraEarlyCandidates.length}</div>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <CheckHubContext.Provider value={hub}>
    <ElitePageWrapper>
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <div style={{ marginBottom: "24px" }}>
          <h1 style={{ fontSize: "24px", fontWeight: 700, marginBottom: "16px", color: "#fff" }}>
            📊 Aureus Radar
          </h1>
          
          {/* the networks only change the Hot tab: every other tab is Solana, so the bar would suggest a choice that does nothing there */}
          {activeTab === "hot" && <HotChainsBar hot={hot} selected={hotChain} onSelect={(id) => { setHotChain(id); setActiveTab("hot"); }} />}

          <div className="radar-tabs" style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
            <TabButton label="🔥 Hot" count={hotShown ? (hotShown.pools[(hotShown.chains.find((c) => c.id === hotChain) ?? hotShown.chains[0])?.id ?? ""] ?? []).filter(isNewSmall).length : undefined} active={activeTab === "hot"} onSelect={() => selectTab("hot")} />
            <TabButton label="🎯 CATE" count={lists.cate.list.length} active={activeTab === "cate"} onSelect={() => selectTab("cate")} />
            <TabButton label="💰 Buy Signals" count={lists.signals.list.length} active={activeTab === "signals"} onSelect={() => selectTab("signals")} />
            <TabButton label="🚀 Ultra Momentum" count={lists.early.list.length} active={activeTab === "early"} onSelect={() => selectTab("early")} />
            <TabButton label="⭐ Elite" count={lists.elite.list.length} active={activeTab === "elite-s"} onSelect={() => selectTab("elite-s")} />
            <TabButton label="💼 Incubation" count={lists.incubation.list.length} active={activeTab === "qualified"} onSelect={() => selectTab("qualified")} />
            <TabButton label="🏃 Runners" count={lists.runners.list.length} active={activeTab === "runners"} onSelect={() => selectTab("runners")} />
            <TabButton label="🎓 Graduations" count={lists.graduates.list.filter((g) => g.healthy !== false).length} active={activeTab === "graduates"} onSelect={() => selectTab("graduates")} />
            <TabButton label="📋 Stats" active={activeTab === "stats"} onSelect={() => selectTab("stats")} />
          </div>

          <div style={{ fontSize: "12px", color: "#8a8a8e", display: "flex", alignItems: "center", gap: "10px" }}>
            <span>
              {isRefreshing
                ? "🔄 Refreshing..."
                : lastUpdate
                  ? `${failedSources.length ? "⚠ Partly refreshed" : "✓ Screen refreshed"} ${lastUpdate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                  : "Loading..."}
            </span>
            <button
              onClick={() => void fetchAll()}
              disabled={isRefreshing}
              aria-label="Refresh now"
              style={{ background: "#1a1a1f", color: "#8a8a8e", border: "1px solid #2a2a2f", borderRadius: "6px", padding: "4px 10px", fontSize: "12px", cursor: "pointer" }}
            >
              ↻ Refresh
            </button>
          </div>
          {failedSources.length > 0 && (
            <div style={{ marginTop: "8px", fontSize: "12px", color: "#ff9f0a" }}>
              ⚠ {failedSources.length} data source{failedSources.length === 1 ? "" : "s"} could not be loaded just now ({failedSources.join(", ")}). Lists may be incomplete or out of date; the next refresh tries again.
            </div>
          )}
          {safety && safety.unverified > 0 && (
            <div style={{ marginTop: "8px", fontSize: "12px", color: "#ff9f0a" }}>
              ⚠ {safety.unverified} of {safety.total} coins could not be live-checked right now (DexScreener busy) — they are NOT confirmed safe.
            </div>
          )}
        </div>

        <div data-tab-content className="radar-tab-content" style={{ maxHeight: "calc(100vh - 300px)", overflowY: "auto" }}>
          <AwayLine count={awayHere[activeTab] ?? 0} shown={showAway} onToggle={() => setShowAway((v) => !v)} />
          {renderContent()}
        </div>
      </div>
    </ElitePageWrapper>
    </CheckHubContext.Provider>
  );
}
