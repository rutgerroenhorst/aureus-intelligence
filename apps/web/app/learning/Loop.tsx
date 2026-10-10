"use client";
import s from "./lab.module.css";
import { Badge, Note, Section } from "./parts";
import { pct } from "./format";
import type { LabData } from "./types";
import type { ScoreItem } from "@/lib/lab/reports/loop";

/** A tiny line of the last days; nothing is drawn until there are at least two days. */
function Spark({ points }: { points: Array<{ v: number }> }) {
  if (points.length < 2) return <span className={s.small}>trend starts after a second day</span>;
  const vs = points.map((p) => p.v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const w = 96;
  const h = 22;
  const y = (v: number) => (hi === lo ? h / 2 : h - 2 - ((v - lo) / (hi - lo)) * (h - 4));
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i / (points.length - 1)) * w},${y(p.v).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} fill="none" stroke="var(--teal)" strokeWidth="1.5" />
    </svg>
  );
}

function tone(i: ScoreItem): "good" | "bad" | "info" | "warn" | undefined {
  if (i.value == null) return undefined;
  const v = i.versus?.value;
  if (i.format === "hours") return i.value >= 20 ? "good" : i.value >= 12 ? "warn" : "bad";
  if (i.good === "info" || v == null) return "info";
  if (i.good === "high") return i.value >= v * 0.97 ? "good" : "warn";
  return i.value <= v * 1.03 ? "good" : "warn";
}

function Score({ i }: { i: ScoreItem }) {
  const t = tone(i);
  const big = i.value == null ? "collecting" : i.format === "hours" ? `${Math.round(i.value)} of 24 h` : pct(i.value, i.value < 0.1 ? 1 : 0);
  return (
    <div className={`${s.card} ${s.stat}`} title={i.about}>
      <div className={t ? s[t] : s.dim} style={{ fontSize: i.value == null ? 18 : 26, fontWeight: 700, letterSpacing: -0.4, lineHeight: 1.15 }}>{big}</div>
      <div style={{ marginTop: 4, color: "#b4b4c6", fontSize: 12 }}>{i.label}</div>
      <div className={s.small} style={{ marginTop: 2 }}>
        {i.value == null
          ? `${i.n} so far; shown from ${i.id === "door_missed" ? 20 : 10} on`
          : i.format === "hours"
            ? "of the last 24 hours had a scan"
            : `${i.k} of ${i.n}${i.versus && i.versus.value != null ? ` · ${i.versus.label}: ${pct(i.versus.value, i.versus.value < 0.1 ? 1 : 0)}` : ""}`}
      </div>
      <div style={{ marginTop: 6 }}>
        <Spark points={i.trend} />
      </div>
    </div>
  );
}

export function LoopCard({ d }: { d: LabData }) {
  const loop = d.loop;
  if (!loop) return null;
  const quiet = loop.decisions.length === 0;
  return (
    <Section
      title="The system loop"
      lede="How the system improves itself without anybody reading forty tables: it measures four numbers, tests every idea on coins it has not seen yet, and only comes to you when the evidence is strong enough. If nothing is listed under Needs you, nothing needs you."
    >
      <div className={s.grid4} style={{ marginBottom: 14 }}>
        {loop.scoreboard.map((i) => (
          <Score key={i.id} i={i} />
        ))}
      </div>

      <div className={s.card} style={{ marginBottom: 14 }}>
        <div className={s.cardTop}>
          <h3>Needs you</h3>
          <Badge kind={quiet ? "neutral" : "suggestive"}>{quiet ? "nothing" : `${loop.decisions.length}`}</Badge>
        </div>
        {quiet ? (
          <p className={s.sub} style={{ margin: "6px 0 0" }}>
            Nothing needs a decision right now. The lab keeps collecting, and the experiments below need more new coins before they can say anything.
          </p>
        ) : (
          <ul className={s.list} style={{ marginTop: 8 }}>
            {loop.decisions.map((x) => (
              <li key={x.id} className={s.zone}>
                <div className={s.cardTop}>
                  <h4>{x.title}</h4>
                  <Badge kind={x.level === "act" ? "suggestive" : "weak"}>{x.level === "act" ? "act" : "consider"}</Badge>
                </div>
                <div className={s.small} style={{ marginTop: 4 }}>{x.why}</div>
                <div className={s.small} style={{ marginTop: 4 }}><b>Evidence:</b> {x.evidence}</div>
                <div className={s.small} style={{ marginTop: 4 }}><b>Suggested:</b> {x.suggestion}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={s.card} style={{ marginBottom: 14 }}>
        <h3>Experiments running</h3>
        <div className={s.small} style={{ marginBottom: 8 }}>Each idea was written down with a date; only coins first seen after that date count. A bar shows how far the smaller group is from the number needed to judge.</div>
        <div className={s.expList}>
          {loop.experiments.map((e) => {
            const have = Math.min(e.inN, e.outN);
            return (
              <div key={e.id} className={s.expRow}>
                <div className={s.expTitle}>
                  <b>{e.id.split("-")[0]}</b> {e.title}
                </div>
                <div className={s.expBar} title={`${e.inN} in the group, ${e.outN} in the rest; ${e.need} needed in each`}>
                  <i style={{ width: `${Math.min(100, (have / e.need) * 100)}%` }} />
                </div>
                <div className={s.small}>{have} of {e.need}</div>
                <Badge kind={e.status} />
              </div>
            );
          })}
        </div>
      </div>
      <Note>{loop.rhythm}</Note>
    </Section>
  );
}
