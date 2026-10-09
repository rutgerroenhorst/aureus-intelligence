"use client";
import { useRef, useState } from "react";
import { usePolling } from "@/lib/usePolling";

interface TabLearning {
  tab_name: string;
  total_coins: number;
  winners: number;
  mega_winners: number;
  rugpulls: number;
  dead_coins: number;
  pending: number;
  win_rate: number;
  avg_return: number;
  by_age_bucket: Record<string, any>;
}

interface FilterSuggestion {
  tab_name: string;
  age_bucket_min: number;
  age_bucket_max: number;
  metric_name: string;
  current_threshold: number;
  suggested_threshold: number;
  suggested_direction: string;
  confidence_score: number;
  win_rate_with_suggestion: number;
  win_rate_without_suggestion: number;
  sample_size: number;
  status: string;
}

interface AnalysisSummary {
  total_tabs: number;
  total_coins_tracked: number;
  overall_win_rate: number;
  active_suggestions: number;
}

const fmtAge = (h: number) => (h >= 1000 ? "∞" : h >= 48 ? `${Math.round(h / 24)}d` : `${h}h`);

const ago = (iso: string | null | undefined) => {
  if (!iso) return "never";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return min < 1 ? "just now" : min < 90 ? `${min} min ago` : min < 2880 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} d ago`;
};

export default function LearningPage() {
  const [analysis, setAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchAnalysis = async () => {
    try {
      const res = await fetch("/api/learning-analysis", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setAnalysis(data);
        setLastUpdate(new Date());
      }
    } catch (err) {
      console.error("Failed to fetch learning analysis:", err);
    } finally {
      setLoading(false);
    }
  };

  // First load always; after that every 30 s while "Auto" is on. Pauses while the screen is hidden and backs off when
  // untouched (a plain setInterval ran 24/7 on a forgotten tab).
  const loadedOnce = useRef(false);
  usePolling(async () => {
    if (loadedOnce.current && !autoRefresh) return;
    loadedOnce.current = true;
    await fetchAnalysis();
  }, 30_000);

  return (
    <>
      <div className="learn-head" style={{ padding: "24px 32px", borderBottom: "1px solid #2a2a3e" }}>
        <h2 style={{ fontSize: "28px", fontWeight: 700, margin: "0 0 8px 0", color: "#fff" }}>
          Self-Optimizer
        </h2>
        <p style={{ fontSize: "14px", color: "#8a8a9e", margin: 0 }}>
          Real-time filter learning and optimization across all tabs
        </p>
      </div>

      <div className="learn-body" style={{ flex: 1, overflow: "auto", padding: "24px 32px" }}>
        {loading ? (
          <div style={{ color: "#8a8a9e", textAlign: "center", padding: "60px" }}>
            Loading learning data...
          </div>
        ) : !analysis ? (
          <div style={{ color: "#8a8a9e", textAlign: "center", padding: "60px" }}>
            No learning data yet. Coins need to flow through the system first.
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div style={{ marginBottom: "32px" }}>
              <div className="learn-summary" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px", marginBottom: "12px" }}>
                <div style={{ padding: "16px", background: "rgba(52, 199, 89, 0.1)", border: "1px solid rgba(52, 199, 89, 0.3)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#8a8a9e", marginBottom: "8px", textTransform: "uppercase" }}>
                    Overall Win Rate
                  </div>
                  <div style={{ fontSize: "24px", fontWeight: 700, color: "#34c759" }}>
                    {analysis.analysis_summary.total_graded > 0 ? `${analysis.analysis_summary.overall_win_rate.toFixed(1)}%` : "—"}
                  </div>
                  <div style={{ fontSize: "10px", color: "#8a8a9e", marginTop: "4px" }}>
                    {analysis.analysis_summary.total_coins_tracked} coins tracked
                  </div>
                </div>

                <div style={{ padding: "16px", background: "rgba(48, 176, 192, 0.1)", border: "1px solid rgba(48, 176, 192, 0.3)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#8a8a9e", marginBottom: "8px", textTransform: "uppercase" }}>
                    Tabs Learning
                  </div>
                  <div style={{ fontSize: "24px", fontWeight: 700, color: "#30b0c0" }}>
                    {analysis.analysis_summary.total_tabs}
                  </div>
                </div>

                <div style={{ padding: "16px", background: "rgba(255, 59, 48, 0.1)", border: "1px solid rgba(255, 59, 48, 0.3)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#8a8a9e", marginBottom: "8px", textTransform: "uppercase" }}>
                    Active Suggestions
                  </div>
                  <div style={{ fontSize: "24px", fontWeight: 700, color: "#ff3b30" }}>
                    {analysis.analysis_summary.active_suggestions}
                  </div>
                </div>

                <div style={{ padding: "16px", background: "rgba(100, 100, 130, 0.1)", border: "1px solid rgba(100, 100, 130, 0.3)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#8a8a9e", marginBottom: "8px", textTransform: "uppercase" }}>
                    Last Updated
                  </div>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "#fff" }}>
                    {lastUpdate ? lastUpdate.toLocaleTimeString() : "—"}
                  </div>
                  <button
                    onClick={() => setAutoRefresh(!autoRefresh)}
                    style={{
                      fontSize: "10px",
                      color: autoRefresh ? "#34c759" : "#8a8a9e",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      marginTop: "4px"
                    }}
                  >
                    {autoRefresh ? "🔄 Auto" : "⏸ Manual"}
                  </button>
                </div>
              </div>
            </div>

            {/* What is tracked and how coins are graded */}
            <div style={{ marginBottom: "24px", padding: "14px 16px", background: "rgba(48, 176, 192, 0.06)", border: "1px solid rgba(48, 176, 192, 0.25)", borderRadius: "8px", fontSize: "12px", lineHeight: 1.6, color: "#b0b0be" }}>
              <div style={{ color: "#fff", fontWeight: 600, marginBottom: "4px" }}>
                {analysis.analysis_summary.total_coins_tracked} coins tracked · {analysis.analysis_summary.total_graded ?? 0} graded · {analysis.analysis_summary.total_pending ?? 0} still being watched
              </div>
              Last coin added {ago(analysis.analysis_summary.last_tracked_at)}, last check {ago(analysis.analysis_summary.last_checked_at)}.
              A coin counts as a <b style={{ color: "#34c759" }}>winner</b> when it reaches 2× its market cap from the moment it appeared on a tab,
              a <b style={{ color: "#ff3b30" }}>rugpull</b> when it falls below 0.5× or its liquidity is pulled, and a loser when it is still between 0.5× and 2× after {analysis.rules?.watch_hours ?? 6} hours.
              Coins are measured while Aureus is open (or while the 24/7 scanner runs), so a spike that comes and goes between two checks can be missed. Filter suggestions appear once a tab and age group has about 10 graded coins with at least 5 winners and 5 non-winners.
            </div>

            {/* Per-Tab Learning */}
            <div style={{ marginBottom: "32px" }}>
              <h3 style={{ fontSize: "13px", fontWeight: 700, marginBottom: "16px", textTransform: "uppercase" }}>
                Per-Tab Performance
              </h3>

              {Object.keys(analysis.per_tab).length === 0 && (
                <div style={{ color: "#8a8a9e", padding: "24px", textAlign: "center", border: "1px dashed #2a2a3e", borderRadius: "8px", fontSize: "13px" }}>
                  No coins tracked yet. They are added automatically after a scan finishes while Aureus is open; check back in a few minutes.
                </div>
              )}
              {Object.entries(analysis.per_tab).map(([tabName, tab]: [string, any]) => (
                <div
                  key={tabName}
                  style={{
                    marginBottom: "20px",
                    padding: "20px",
                    background: "linear-gradient(180deg, rgba(52, 199, 89, 0.05), rgba(48, 176, 192, 0.05))",
                    border: "1px solid #2a2a3e",
                    borderRadius: "10px"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                    <h4 style={{ fontSize: "16px", fontWeight: 700, margin: 0, textTransform: "uppercase", color: "#fff" }}>
                      {tabName.replace(/_/g, " ")}
                    </h4>
                    <div style={{ fontSize: "12px", color: "#8a8a9e" }}>
                      {tab.winners}/{tab.total_coins - tab.pending} confirmed • {tab.pending} pending
                    </div>
                  </div>

                  {/* Metrics Grid */}
                  <div className="learn-metrics" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "12px", marginBottom: "16px" }}>
                    <div style={{ padding: "12px", background: "rgba(0,0,0,0.3)", borderRadius: "6px", border: "1px solid #2a2a3e" }}>
                      <div style={{ fontSize: "10px", color: "#8a8a9e", marginBottom: "4px" }}>WIN RATE</div>
                      <div style={{ fontSize: "18px", fontWeight: 700, color: tab.total_coins === tab.pending ? "#8a8a9e" : tab.win_rate > 40 ? "#34c759" : "#ff3b30" }}>
                        {tab.total_coins === tab.pending ? "—" : `${tab.win_rate.toFixed(1)}%`}
                      </div>
                    </div>

                    <div style={{ padding: "12px", background: "rgba(0,0,0,0.3)", borderRadius: "6px", border: "1px solid #2a2a3e" }}>
                      <div style={{ fontSize: "10px", color: "#8a8a9e", marginBottom: "4px" }}>AVG RETURN</div>
                      <div style={{ fontSize: "18px", fontWeight: 700, color: tab.avg_return > 1.5 ? "#34c759" : "#8a8a9e" }}>
                        {tab.total_coins === tab.pending ? "—" : `${tab.avg_return.toFixed(2)}x`}
                      </div>
                    </div>

                    <div style={{ padding: "12px", background: "rgba(0,0,0,0.3)", borderRadius: "6px", border: "1px solid #2a2a3e" }}>
                      <div style={{ fontSize: "10px", color: "#8a8a9e", marginBottom: "4px" }}>MEGA WINS</div>
                      <div style={{ fontSize: "18px", fontWeight: 700, color: "#34c759" }}>
                        {tab.mega_winners}
                      </div>
                    </div>

                    <div style={{ padding: "12px", background: "rgba(0,0,0,0.3)", borderRadius: "6px", border: "1px solid #2a2a3e" }}>
                      <div style={{ fontSize: "10px", color: "#8a8a9e", marginBottom: "4px" }}>RUGPULLS</div>
                      <div style={{ fontSize: "18px", fontWeight: 700, color: "#ff3b30" }}>
                        {tab.rugpulls}
                      </div>
                    </div>

                    <div style={{ padding: "12px", background: "rgba(0,0,0,0.3)", borderRadius: "6px", border: "1px solid #2a2a3e" }}>
                      <div style={{ fontSize: "10px", color: "#8a8a9e", marginBottom: "4px" }}>DEAD</div>
                      <div style={{ fontSize: "18px", fontWeight: 700, color: "#8a8a9e" }}>
                        {tab.dead_coins}
                      </div>
                    </div>
                  </div>

                  {/* Age Bucket Breakdown */}
                  {Object.keys(tab.by_age_bucket).length > 0 && (
                    <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid #2a2a3e" }}>
                      <div style={{ fontSize: "11px", fontWeight: 600, color: "#8a8a9e", marginBottom: "8px", textTransform: "uppercase" }}>
                        Performance by Age Bucket
                      </div>
                      <div className="learn-buckets" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "8px" }}>
                        {Object.entries(tab.by_age_bucket).map(([bucket, stats]: [string, any]) => (
                          <div key={bucket} style={{ padding: "8px", background: "rgba(0,0,0,0.2)", borderRadius: "4px", border: "1px solid #2a2a3e" }}>
                            <div style={{ fontSize: "9px", fontWeight: 700, color: "#30b0c0", marginBottom: "2px" }}>
                              {bucket}
                            </div>
                            <div style={{ fontSize: "12px", fontWeight: 700, color: stats.win_rate > 40 ? "#34c759" : "#ff9500" }}>
                              {stats.win_rate.toFixed(0)}%
                            </div>
                            <div style={{ fontSize: "9px", color: "#8a8a9e" }}>
                              {stats.winners}/{stats.total}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Filter Suggestions */}
            {analysis.suggestions && analysis.suggestions.length > 0 && (
              <div>
                <h3 style={{ fontSize: "13px", fontWeight: 700, marginBottom: "16px", textTransform: "uppercase" }}>
                  🧠 Active Filter Suggestions ({analysis.suggestions.length})
                </h3>

                {analysis.suggestions.map((suggestion: FilterSuggestion, idx: number) => (
                  <div
                    key={idx}
                    style={{
                      marginBottom: "12px",
                      padding: "16px",
                      background: suggestion.status === "pending_review"
                        ? "linear-gradient(135deg, rgba(255, 59, 48, 0.1), rgba(255, 200, 100, 0.05))"
                        : "rgba(0,0,0,0.2)",
                      border: suggestion.status === "pending_review" ? "1px solid rgba(255, 59, 48, 0.3)" : "1px solid #2a2a3e",
                      borderRadius: "8px",
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: "16px",
                      alignItems: "center"
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                        <span style={{ fontSize: "12px", fontWeight: 700, color: "#fff" }}>
                          {suggestion.tab_name}: {suggestion.metric_name}
                        </span>
                        <span
                          style={{
                            fontSize: "10px",
                            fontWeight: 700,
                            padding: "2px 6px",
                            background: suggestion.suggested_direction === "increase" ? "#34c759" : "#30b0c0",
                            color: "#000",
                            borderRadius: "3px"
                          }}
                        >
                          {suggestion.suggested_direction === "increase" ? "↑" : "↓"} {suggestion.suggested_direction}
                        </span>
                      </div>

                      <div style={{ fontSize: "12px", color: "#8a8a9e", marginBottom: "8px" }}>
                        Coins aged {fmtAge(suggestion.age_bucket_min)}–{fmtAge(suggestion.age_bucket_max)}: now accepted from {Number(suggestion.current_threshold).toFixed(2)} → try {suggestion.suggested_direction === "increase" ? "at least" : "at most"} {Number(suggestion.suggested_threshold).toFixed(2)}
                      </div>

                      <div style={{ display: "flex", gap: "24px", fontSize: "11px" }}>
                        <div>
                          <span style={{ color: "#8a8a9e" }}>Without:</span> {" "}
                          <span style={{ color: "#ff9500", fontWeight: 600 }}>
                            {Number(suggestion.win_rate_without_suggestion).toFixed(1)}% win rate
                          </span>
                        </div>
                        <div>
                          <span style={{ color: "#8a8a9e" }}>With:</span> {" "}
                          <span style={{ color: "#34c759", fontWeight: 600 }}>
                            {Number(suggestion.win_rate_with_suggestion).toFixed(1)}% win rate
                          </span>
                        </div>
                        <div>
                          <span style={{ color: "#8a8a9e" }}>n=</span>
                          <span style={{ fontWeight: 600, color: "#30b0c0" }}>{suggestion.sample_size}</span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <div
                        style={{
                          fontSize: "24px",
                          fontWeight: 700,
                          color: Number(suggestion.confidence_score) > 75 ? "#34c759" : Number(suggestion.confidence_score) > 50 ? "#ff9500" : "#8a8a9e",
                          textAlign: "center"
                        }}
                      >
                        {Number(suggestion.confidence_score).toFixed(0)}%
                      </div>
                      <div style={{ fontSize: "10px", color: "#8a8a9e", textAlign: "center", marginTop: "4px" }}>
                        confidence
                      </div>
                      {suggestion.status === "pending_review" && (
                        <div style={{ marginTop: "12px", display: "flex", gap: "6px" }}>
                          <button
                            style={{
                              flex: 1,
                              padding: "6px",
                              background: "#34c759",
                              color: "#000",
                              border: "none",
                              borderRadius: "4px",
                              fontSize: "10px",
                              fontWeight: 700,
                              cursor: "pointer"
                            }}
                          >
                            ✓ Apply
                          </button>
                          <button
                            style={{
                              flex: 1,
                              padding: "6px",
                              background: "#2a2a3e",
                              color: "#8a8a9e",
                              border: "none",
                              borderRadius: "4px",
                              fontSize: "10px",
                              fontWeight: 700,
                              cursor: "pointer"
                            }}
                          >
                            ✕ Reject
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
