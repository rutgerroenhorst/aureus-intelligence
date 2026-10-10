"use client";
import s from "./lab.module.css";
import { Note, RateText, Section } from "./parts";
import { hours, pct, usd } from "./format";
import type { LabData } from "./types";

/** The coins the Radar's door does not let in, and what they did. */
export function Lanes({ d }: { d: LabData }) {
  const l = d.lanes;
  if (!l) return null;
  const others = l.groups.filter((g) => g.id !== "fresh");
  const collecting = others.every((g) => g.basis === 0);
  return (
    <Section
      title="Beyond the Radar's door"
      lede="The Radar admits a coin only when its pair is at least 60 minutes old and worth at most $150K. That is a choice about what the Radar shows, but it also means the system never learns what happens to the coins it turns away. HOTBOT, a coin that went about 10x, was above $1M within hours of graduating and was never seen. So the lab also follows what the door turns away, and coins found on Jupiter's organic-score lists. None of them appear on the Radar tabs."
    >
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Lane</th>
              <th className={s.num}>Coins</th>
              <th className={s.num}>Watched now</th>
              <th className={s.num}>Followed 3 days</th>
              <th className={s.num}>Held 2x</th>
              <th className={s.num}>Held 3x</th>
              <th className={s.num}>Held 5x</th>
              <th className={s.num}>First look: value / pair age</th>
            </tr>
          </thead>
          <tbody>
            {l.groups.map((g) => (
              <tr key={g.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{g.label}</div>
                  <div className={s.small}>{g.about}</div>
                </td>
                <td className={s.num}>{g.n.toLocaleString()}</td>
                <td className={s.num}>{g.id === "fresh" ? "-" : g.watching}</td>
                <td className={s.num}>{g.basis}</td>
                <td className={s.num}>{g.basis >= 8 ? <RateText r={g.held2} /> : <span className={s.dim}>collecting</span>}</td>
                <td className={s.num}>{g.basis >= 8 ? <RateText r={g.held3} /> : <span className={s.dim}>collecting</span>}</td>
                <td className={s.num}>{g.basis >= 8 ? <RateText r={g.held5} /> : <span className={s.dim}>collecting</span>}</td>
                <td className={s.num}>
                  {usd(g.medianFirstMcap)} / {g.medianPairAgeH == null ? "-" : hours(g.medianPairAgeH)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Note warn={collecting}>
        {collecting
          ? "The extra lanes started today. Each coin has to be followed for 3 days before it counts, so these rows fill in from about three days on. "
          : ""}
        {l.note}
      </Note>
      {l.groups.some((g) => g.ai && g.ai.in.n >= 5) && (
        <div className={s.grid2}>
          {l.groups
            .filter((g) => g.ai && g.ai.in.n >= 5)
            .map((g) => (
              <div key={g.id} className={s.card}>
                <h3>AI, agent or bot names: {g.label.toLowerCase()}</h3>
                <div className={s.small} style={{ margin: "4px 0 8px" }}>Held 2x within 3 days, by whether the name points at AI, an agent or a bot.</div>
                <div className={s.small}>With such a name: <RateText r={g.ai!.in.held2} /> ({g.ai!.in.n} coins)</div>
                <div className={s.small}>Other names: <RateText r={g.ai!.out.held2} /> ({g.ai!.out.n} coins)</div>
                <div className={s.small} style={{ marginTop: 4 }}>{g.ai!.p == null ? "Too few coins to test." : `Difference ${g.ai!.p < 0.05 ? "is bigger than chance" : "is not bigger than chance"} (p = ${g.ai!.p < 0.001 ? "<0.001" : g.ai!.p.toFixed(3)}). This is hypothesis H6; only coins first seen after it was written down count.`}</div>
              </div>
            ))}
        </div>
      )}
      <span style={{ display: "none" }}>{pct(0)}</span>
    </Section>
  );
}
