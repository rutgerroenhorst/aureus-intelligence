"use client";
import s from "./lab.module.css";
import { Bars, Empty, Note, RateText, Section } from "./parts";
import { evText, hours, pct, pctS, range } from "./format";
import type { LabData } from "./types";

export function Lifecycle({ d }: { d: LabData }) {
  const l = d.lifecycle;
  if (!l) return null;
  return (
    <>
      <Section title="From A to Z" lede={`When the good things happen and how coins die, measured on the ${l.basis} coins that were followed for the full 3 days, so a young coin is never counted as a failure.`}>
        <div className={s.grid2}>
          <div className={s.card}>
            <h3>When a coin first holds 2x</h3>
            <div className={s.small} style={{ marginBottom: 6 }}>Chance that a coin which has not held 2x yet, and is still followed at the end of the window, does so inside the window.</div>
            <Bars
              items={l.hazard.map((h) => ({ label: `${h.from}-${h.to} h`, value: h.firstHeld2x.n ? h.firstHeld2x.p : null, n: h.atRisk }))}
            />
            {l.timeTo2x && (
              <div className={s.small} style={{ marginTop: 10 }}>
                Of the {l.timeTo2x.n} coins that did hold 2x: a quarter by {hours(l.timeTo2x.p25)}, half by {hours(l.timeTo2x.p50)}, three quarters by {hours(l.timeTo2x.p75)}, nine in ten by {hours(l.timeTo2x.p90)}.
              </div>
            )}
          </div>
          <div className={s.card}>
            <h3>How many are still alive</h3>
            <div className={s.small} style={{ marginBottom: 6 }}>Share of coins with at least $2K of liquidity, among the coins still followed at that moment.</div>
            <Bars items={l.survival.map((x) => ({ label: `+${x.tau} h`, value: x.alive.n ? x.alive.p : null, n: x.alive.n }))} />
          </div>
        </div>
      </Section>

      <Section title="Kinds of ending">
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Ending</th>
                <th className={s.num}>Coins</th>
                <th className={s.num}>Share</th>
                <th className={s.num}>Median time to 2x</th>
                <th className={s.num}>Median price after 24 h</th>
                <th>Examples</th>
              </tr>
            </thead>
            <tbody>
              {l.classes.map((c) => (
                <tr key={c.cls}>
                  <td style={{ fontWeight: 600 }}>{c.label}</td>
                  <td className={s.num}>{c.n}</td>
                  <td className={s.num}>{pct(c.share)}</td>
                  <td className={s.num}>{c.hoursTo2x == null ? "–" : hours(c.hoursTo2x)}</td>
                  <td className={s.num}>{c.final24 == null ? "–" : `${c.final24.toFixed(2)}x`}</td>
                  <td className={s.dim}>{c.examples.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="What a coin is called, and where it was launched"
        lede="A plain look at whether the name or the launch venue goes with how a coin ends. The AI/tool-name idea comes from looking at the winners afterwards, so it is registered as a hypothesis below and only coins first seen from now on count as evidence."
      >
        {l.product && (
          <Note>
            <b>AI, agent or tool names:</b> {pctS(l.product.inGroup.held3.p)} held 3x ({l.product.inGroup.held3.k} of {l.product.inGroup.n}) against {pctS(l.product.outGroup.held3.p)} for the rest ({l.product.outGroup.held3.k} of {l.product.outGroup.n}); Fisher p = {l.product.pHeld3?.toFixed(3) ?? "–"}. Held 10x: {pctS(l.product.inGroup.held10.p)} against {pctS(l.product.outGroup.held10.p)} (p = {l.product.pHeld10?.toFixed(3) ?? "–"}).
            {l.product.early && l.product.late && (
              <> In the earlier half of the coins: {pctS(l.product.early.inGroup.p)} against {pctS(l.product.early.outGroup.p)}; in the later half: {pctS(l.product.late.inGroup.p)} against {pctS(l.product.late.outGroup.p)}.</>
            )}
          </Note>
        )}
        <div className={s.grid2}>
          <SplitTable title="By name" rows={l.narrative} />
          <SplitTable title="By launch venue" rows={[...l.venues, ...l.ecosystems]} />
        </div>
        <div style={{ height: 14 }} />
        <SplitTable title="By time of day of the first look (UTC)" rows={l.hours} />
      </Section>
    </>
  );
}

function SplitTable({ title, rows }: { title: string; rows: Array<{ key: string; label: string; n: number; held2: any; held3: any; held10: any }> }) {
  if (!rows.length) return <div className={s.card}><h3>{title}</h3><Empty>Not enough coins.</Empty></div>;
  return (
    <div className={s.tableWrap}>
      <div style={{ padding: "8px 8px 0", fontWeight: 700 }}>{title}</div>
      <table className={s.table}>
        <thead>
          <tr>
            <th />
            <th className={s.num}>Coins</th>
            <th className={s.num}>Held 2x</th>
            <th className={s.num}>Held 3x</th>
            <th className={s.num}>Held 10x</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td className={s.num}>{r.n}</td>
              <td className={s.num}>{pctS(r.held2.p)}</td>
              <td className={s.num} title={`90% interval ${range(r.held3)}`}>{pctS(r.held3.p)}</td>
              <td className={s.num}>{pctS(r.held10.p)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { RateText, evText };
