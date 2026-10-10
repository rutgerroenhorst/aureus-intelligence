"use client";

export interface LabOdds {
  ageH: number;
  go2: { p: number; k: number; n: number } | null;
  collapse24: { p: number; k: number; n: number } | null;
  zone: string | null;
  flags: string[];
  oddsAt: { go2: number | null; collapse24: number | null };
}

const ZONE: Record<string, string> = { steady: "steady climber", burner: "hot mover", knife: "falling knife", zombie: "zombie", fallen: "already fallen" };

/**
 * One line on a Radar card from the Learning Lab: how often coins that scored the same way (on coins the lab's models had not
 * seen) doubled or lost half. Only shown when a checked model exists for this coin's age; otherwise just the plain flags.
 */
export function LabLine({ odds }: { odds: LabOdds | undefined }) {
  if (!odds || (!odds.go2 && !odds.collapse24 && !odds.flags.length)) return null;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <div style={{ fontSize: "10px", marginTop: "6px", color: "#8a8a9e", lineHeight: 1.5 }} title="From the Learning Lab: what happened to coins that looked like this one at this age, on coins its checked models had not seen. Frequencies, not promises.">
      <span style={{ color: "#30b0c0", fontWeight: 700 }}>🧪 Lab</span>
      {odds.collapse24 && (
        <span> · lost half within a day: <b style={{ color: "#ff453a" }}>{pct(odds.collapse24.p)}</b> ({odds.collapse24.k} of {odds.collapse24.n}){odds.collapse24.p >= 0.7 && <b style={{ color: "#ff453a" }}> · top risk group</b>}</span>
      )}
      {odds.go2 && (
        <span> · doubled within 3 days: <b style={{ color: "#34c759" }}>{pct(odds.go2.p)}</b> ({odds.go2.k} of {odds.go2.n})</span>
      )}
      {odds.zone && ZONE[odds.zone] && <span> · {ZONE[odds.zone]}</span>}
      {odds.flags.slice(0, 3).map((f) => (
        <span key={f} style={{ color: /dry|barely|dump|20%|thin|fading/.test(f) ? "#ff9f0a" : "#b4b4c6" }}> · {f}</span>
      ))}
    </div>
  );
}
