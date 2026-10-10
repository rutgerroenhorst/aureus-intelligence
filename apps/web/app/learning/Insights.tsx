"use client";
import { useState } from "react";
import s from "./lab.module.css";
import { Badge, Bars, Empty, Note, RateText, Section, Seg } from "./parts";
import { evText, pct, pctS, tauText } from "./format";
import type { LabData } from "./types";

type Target = "go2" | "collapse24";

const COPY: Record<Target, { title: string; lede: string; what: string; short: string }> = {
  go2: {
    title: "Why coins go",
    lede: "Which things about a coin, at a given moment, go with it doubling (holding 2x for about half an hour) within the next 3 days. Only coins that had not already fallen apart are compared, so the answer is useful for a coin you could still buy.",
    what: "doubled within 3 days",
    short: "doubled",
  },
  collapse24: {
    title: "Why coins don't (and how they die)",
    lede: "Which things about a coin go with it losing half of its price within the next 24 hours. Only coins that had not already fallen apart are compared; a coin that is already down 90% cannot crash again, which would make the answer look better than it is.",
    what: "lost half within 24 hours",
    short: "lost half",
  },
};

export function InsightsView({ d, target }: { d: LabData; target: Target }) {
  const ins = d.insights;
  const copy = COPY[target];
  const taus = ins?.taus ?? [];
  const [tau, setTau] = useState<number>(() => (taus.find((t) => t.tau === 3) ? 3 : taus[0]?.tau ?? 3));
  const [all, setAll] = useState(false);
  if (!ins || !taus.length) return <Section title={copy.title}><Empty>Not enough coins have finished their 3-day window yet.</Empty></Section>;
  const t = taus.find((x) => x.tau === tau) ?? taus[0]!;
  const spread = (f: (typeof t.features)[number]) => Math.abs((f[target]?.auc ?? 0.5) - 0.5);
  const sorted = [...t.features].filter((f) => f[target]).sort((a, b) => spread(b) - spread(a));
  const notable = sorted.filter((f) => f.tier[target] !== "weak");
  const shown = all ? sorted : (notable.length ? notable : sorted).slice(0, 6);
  const base = t.base[target];
  const headlines = ins.headlines.filter((h) => h.target === target).slice(0, 4);

  return (
    <Section title={copy.title} lede={copy.lede}>
      <Seg
        value={tau}
        onChange={setTau}
        options={taus.map((x) => ({ value: x.tau, label: tauText(x.tau) }))}
      />
      <div className={s.grid3} style={{ marginBottom: 14 }}>
        <div className={s.card}>
          <div className={s.sub}>Coins still standing at this moment</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{base.n}</div>
          <div className={s.small}>with the whole outcome window seen</div>
        </div>
        <div className={s.card}>
          <div className={s.sub}>{copy.what}</div>
          <div style={{ fontSize: 24, fontWeight: 700 }} className={target === "go2" ? s.good : s.bad}>{pctS(base.p)}</div>
          <div className={s.small}>{base.k} of {base.n} (90% interval {pct(base.lo)} to {pct(base.hi)})</div>
        </div>
        <div className={s.card}>
          <div className={s.sub}>Already fallen apart by then</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{t.fallen.n}</div>
          <div className={s.small}>
            {target === "go2" ? <>doubled: <RateText r={t.fallen.go2} /></> : <>lost half: <RateText r={t.fallen.collapse24} /> (little left to lose)</>}
          </div>
        </div>
      </div>

      {headlines.length > 0 && (
        <Note>
          <b>Strongest across all moments:</b>
          <ul className={s.list} style={{ marginTop: 6 }}>
            {headlines.map((h, i) => (
              <li key={i}>
                {h.label} at {tauText(h.tau)}: {h.sentence}. <span className={s.dim}>AUC {h.auc.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </Note>
      )}
      {!headlines.length && <Note warn>No feature is strong enough yet to be called a finding (it must survive a correction for the {ins.tests} tests and point the same way in the earlier and the later coins). The closest ones are below.</Note>}

      <div className={s.grid2}>
        {shown.map((f) => {
          const a = f[target]!;
          const dir = a.auc > 0.5 ? "higher" : "lower";
          const halves = f.halves[target];
          return (
            <div key={f.key} className={s.card}>
              <div className={s.cardTop}>
                <div>
                  <h3>{f.label}</h3>
                  <div className={s.sub}>{f.about}</div>
                </div>
                <Badge kind={f.tier[target]} />
              </div>
              <div className={s.small} style={{ margin: "6px 0 2px" }}>
                {a.auc > 0.5 ? "Higher" : "Lower"} values go with more coins that {copy.short}. AUC {a.auc.toFixed(2)} ({a.lo.toFixed(2)} to {a.hi.toFixed(2)}), q = {a.q < 0.001 ? "<0.001" : a.q.toFixed(3)}.
                {halves[0] != null && halves[1] != null && (
                  <> Earlier coins {halves[0].toFixed(2)}, later coins {halves[1].toFixed(2)}.</>
                )}
              </div>
              <Bars
                tone={target === "collapse24" ? "red" : "teal"}
                items={f.bins.map((b) => ({ label: b.label, value: b[target].n ? b[target].p : null, n: b[target].n }))}
              />
              <div className={s.small} style={{ marginTop: 8 }}>
                Exit-ladder result by group: {f.bins.map((b) => (b.evN >= 8 ? evText(b.ev) : "–")).join("  |  ")}
              </div>
              <div className={s.small} style={{ marginTop: 4 }}>{f.sentence[target]}</div>
              <span className={s.small} style={{ display: "none" }}>{dir}</span>
            </div>
          );
        })}
      </div>
      <div style={{ margin: "12px 0" }}>
        <button className={s.btn} onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${sorted.length + t.others.length} tested features`}
        </button>
      </div>
      {all && t.others.length > 0 && (
        <div className={s.card}>
          <h3>Tested, with the least to show</h3>
          <div className={s.small} style={{ marginBottom: 8 }}>AUC 0.50 means the feature tells winners from the rest no better than a coin flip.</div>
          <div>
            {t.others.map((o) => {
              const v = target === "go2" ? o.go2 : o.collapse24;
              return (
                <span key={o.key} className={s.tag}>
                  {o.label} {v == null ? "–" : v.toFixed(2)}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </Section>
  );
}
