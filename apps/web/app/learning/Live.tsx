"use client";
import { useState } from "react";
import s from "./lab.module.css";
import { Empty, Note, Section, Seg } from "./parts";
import { hours, pct, usd } from "./format";
import type { LabData } from "./types";
import type { Rate } from "@/lib/lab/reports/common";

const ZONE: Record<string, { label: string; cls: string }> = {
  steady: { label: "Steady climber", cls: s.tagGood },
  burner: { label: "Hot mover", cls: s.tagWarn },
  knife: { label: "Falling knife", cls: s.tagWarn },
  zombie: { label: "Zombie", cls: "" },
  fallen: { label: "Already fallen", cls: "" },
};

/** "27%" with the sample behind it ("5 of 19"); a dash when no checked model fits this coin. */
function Odds({ r, tone, what }: { r: Rate | null; tone: "good" | "bad"; what: string }) {
  if (!r || !r.n) return <span className={s.dim} title="No checked model fits this coin's age or state">–</span>;
  return (
    <span title={`${r.k} of ${r.n} coins that scored like this ${what}. 90% range ${pct(r.lo)} to ${pct(r.hi)}.`}>
      <b className={s[tone]}>{pct(r.p)}</b> <span className={s.small}>{r.k} of {r.n}</span>
    </span>
  );
}

const LANE_LABEL: Record<string, string> = { fresh: "Radar", graduate: "graduate, first hour", runner: "runner" };

export function Live({ d }: { d: LabData }) {
  const live = d.live;
  const [lane, setLane] = useState<"all" | "fresh" | "runner" | "graduate">("all");
  if (!live) return null;
  const counts = { all: live.coins.length, fresh: 0, runner: 0, graduate: 0 } as Record<string, number>;
  for (const c of live.coins) counts[c.lane] = (counts[c.lane] ?? 0) + 1;
  const shown = live.coins.filter((c) => lane === "all" || c.lane === lane);
  return (
    <Section title="Coins being followed now" lede="What the lab says about each coin it is still watching: how often coins that looked like this one doubled or lost half, which of the four kinds it is, and plain flags. A number is only shown when the model behind it has beaten chance on coins it had not seen, at an age close to this coin's.">
      <Note warn={!live.trusted.go2 && !live.trusted.collapse24}>{live.note}</Note>
      {(counts.runner || counts.graduate) > 0 && (
        <Seg
          value={lane}
          onChange={setLane}
          options={[
            { value: "all", label: `All ${counts.all}` },
            { value: "fresh", label: `Radar ${counts.fresh}` },
            ...(counts.runner ? [{ value: "runner" as const, label: `Runners ${counts.runner}` }] : []),
            ...(counts.graduate ? [{ value: "graduate" as const, label: `Too young ${counts.graduate}` }] : []),
          ]}
        />
      )}
      {shown.length === 0 ? (
        <Empty>No coin is being followed right now. They appear here after the next scan.</Empty>
      ) : (
        <div className={s.liveWrap}>
        <div className={s.liveList}>
          <div className={`${s.liveRow} ${s.liveHead}`}>
            <div>Coin</div>
            <div className={s.num}>Age</div>
            <div className={s.num}>Market cap</div>
            <div className={s.num}>Liquidity</div>
            <div className={s.num}>Doubles</div>
            <div className={s.num}>Loses half</div>
            <div>Kind</div>
            <div>Flags</div>
          </div>
          {shown.map((c) => {
            const z = c.zone ? ZONE[c.zone] : null;
            return (
              <div key={c.mint} className={s.liveRow}>
                <div className={s.liveCoin}>
                  <a href={`/coin/${c.mint}`} style={{ color: "inherit" }}><b>{c.symbol ?? "?"}</b></a>
                  <div className={s.small}>{c.name}</div>
                  {c.lane !== "fresh" && <span className={`${s.tag} ${s.tagGood}`}>{LANE_LABEL[c.lane] ?? c.lane}</span>}
                </div>
                <div className={s.num} data-label="Age">{hours(c.ageH)}</div>
                <div className={s.num} data-label="Market cap">{usd(c.mcap)}</div>
                <div className={s.num} data-label="Liquidity">{usd(c.liq)}</div>
                <div className={s.num} data-label="Doubles"><Odds r={c.go2} tone="good" what="doubled within 3 days" /></div>
                <div className={s.num} data-label="Loses half"><Odds r={c.collapse24} tone="bad" what="lost half within a day" /></div>
                <div className={s.liveKind}>{z ? <span className={`${s.tag} ${z.cls}`}>{z.label}</span> : <span className={s.dim}>–</span>}</div>
                <div className={s.liveFlags}>
                  {c.flags.map((f) => (
                    <span key={f} className={`${s.tag} ${/dry|barely|dump|20%|thin/.test(f) ? s.tagWarn : f.startsWith("AI") ? s.tagGood : ""}`}>{f}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        </div>
      )}
    </Section>
  );
}
