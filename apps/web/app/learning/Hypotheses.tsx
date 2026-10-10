"use client";
import s from "./lab.module.css";
import { Badge, Empty, Note, RateText, Section } from "./parts";
import { evText, ago } from "./format";
import type { LabData } from "./types";
import type { HypothesisResult, Test } from "@/lib/lab/reports/hypotheses";

const CLAIM = { higher: "should be higher", lower: "should be lower", not_lower: "should be at least as high" } as const;

export function Hypotheses({ d }: { d: LabData }) {
  const items = d.hypotheses?.items ?? [];
  return (
    <Section
      title="Ideas written down before they are tested"
      lede="Finding a pattern in coins you have already seen proves little: with enough features something always lines up. So every idea is registered with a date, and the only evidence that counts is how coins first seen AFTER that date turn out. The earlier coins are shown too, marked as where the idea came from."
    >
      {items.length === 0 ? (
        <Empty>No hypotheses registered yet.</Empty>
      ) : (
        <div className={s.grid2}>
          {items.map((h) => (
            <Card key={h.id} h={h} />
          ))}
        </div>
      )}
      <Note>
        A hypothesis is called supported only when coins first seen after its registration date, with at least the needed number in each group, show the claimed difference with p below 0.05.
      </Note>
    </Section>
  );
}

function Row({ label, t, ev }: { label: string; t: Test; ev: boolean }) {
  return (
    <tr>
      <td>{label}</td>
      <td className={s.num}>{t.inGroup.n}</td>
      <td className={s.num}>{ev ? evText(t.inGroup.ev) : <RateText r={t.inGroup.rate} />}</td>
      <td className={s.num}>{t.outGroup.n}</td>
      <td className={s.num}>{ev ? evText(t.outGroup.ev) : <RateText r={t.outGroup.rate} />}</td>
      <td className={s.num}>{t.p == null ? "–" : t.p < 0.001 ? "<0.001" : t.p.toFixed(3)}</td>
    </tr>
  );
}

function Card({ h }: { h: HypothesisResult }) {
  const ev = h.outcome === "ev";
  return (
    <div className={s.card}>
      <div className={s.cardTop}>
        <div>
          <h3>{h.title}</h3>
          <div className={s.sub}>{h.statement}</div>
        </div>
        <Badge kind={h.status}>{h.status}</Badge>
      </div>
      <div className={s.small} style={{ margin: "8px 0" }}>{h.basis}</div>
      <table className={s.table}>
        <thead>
          <tr><th>Coins</th><th className={s.num}>In</th><th className={s.num}>Result</th><th className={s.num}>Rest</th><th className={s.num}>Result</th><th className={s.num}>p</th></tr>
        </thead>
        <tbody>
          <Row label="Seen before (origin)" t={h.inSample} ev={ev} />
          <Row label="Seen after (evidence)" t={h.forward} ev={ev} />
        </tbody>
      </table>
      <div className={s.small} style={{ marginTop: 6 }}>
        Registered {ago(new Date(h.registeredAt * 1000).toISOString())}. The "in" group {CLAIM[h.claim]}. Needs {h.need} coins in each group after registration; has {h.forward.inGroup.n} and {h.forward.outGroup.n}.
      </div>
    </div>
  );
}
