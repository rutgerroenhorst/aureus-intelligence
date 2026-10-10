"use client";
import s from "./lab.module.css";
import { Note, Section, Stat } from "./parts";
import { LoopCard } from "./Loop";
import { Lanes } from "./Lanes";
import { MarketStrip } from "@/components/MarketStrip";
import { ago, pct, pctS } from "./format";
import type { LabData } from "./types";

const COLORS: Record<string, string> = {
  MOONSHOT: "#34c759", RUNNER: "#62d37d", BOUNCE: "#93e0a8", ZOMBIE: "#8a8a9e", BLEED: "#c08a3e", DUMP: "#ff9f0a", RUG: "#ff453a", DEAD: "#a03a34", OPEN: "#3a4660",
};

const SOURCE_TEXT: Record<string, string> = {
  price_tail: "Price tail (coins the scanner dropped)",
  candle_tail: "Hourly candles (history repair)",
  gecko_multi: "Unique buyers and sellers",
  jupiter: "Organic score and holders",
  watch: "Watch list readings (lanes beyond the door)",
  runner_scan: "Jupiter list scans (runner discovery)",
};

export function Overview({ d }: { d: LabData }) {
  const o = d.overview;
  if (!o) return null;
  const h = o.held;
  return (
    <>
      <MarketStrip />
      <LoopCard d={d} />
      <Section title="What the lab knows" lede="Every coin the system has followed becomes one lesson: how it looked at the first look and at fixed moments after it, and what really happened next. Everything below is computed from those lessons, and every rate comes with its sample size.">
        <ul className={s.list} style={{ marginBottom: 18 }}>
          {(d.headlines ?? []).map((x, i) => (
            <li key={i} className={s.item}>
              <span className={`${s.dot} ${x.kind === "finding" ? s.dotFinding : x.kind === "warning" ? s.dotWarning : s.dotInfo}`} />
              <span>{x.text}</span>
            </li>
          ))}
        </ul>
        <div className={s.grid4}>
          <Stat value={o.coins.total.toLocaleString()} label="Radar coins followed" sub={o.firstSeen ? `${o.firstSeen.days.toFixed(0)} days, about ${o.firstSeen.perDay.toFixed(0)} a day` : undefined} />
          <Stat value={pctS(h.x2.p)} tone="info" label="held 2x for 3 days" sub={`of ${h.basis} coins followed that long (${pct(h.x2.lo)} to ${pct(h.x2.hi)})`} />
          <Stat value={pctS(h.x3.p)} tone="good" label="held 3x" sub={`${pct(h.x3.lo)} to ${pct(h.x3.hi)}`} />
          <Stat value={pctS(h.x10.p)} tone="good" label="held 10x" sub={`${h.x10.k} coins; ${pctS(h.x5.p)} held 5x`} />
        </div>
      </Section>

      <Section title="How coins end" lede="Each coin gets one of these labels. A coin that held 1.5x is never demoted by what came later, and a coin is only called a loser when the data really shows it.">
        <div className={s.card}>
          <div className={s.stack}>
            {o.byClass.map((c) => (
              <div key={c.cls} style={{ width: `${c.share * 100}%`, background: COLORS[c.cls] }} title={`${c.label}: ${c.n}`} />
            ))}
          </div>
          <div className={s.legend}>
            {o.byClass.map((c) => (
              <span key={c.cls}>
                <i className={s.swatch} style={{ background: COLORS[c.cls] }} />
                {c.label} {c.n} ({pct(c.share)})
              </span>
            ))}
          </div>
          <table className={s.table} style={{ marginTop: 12 }}>
            <tbody>
              {o.byClass.map((c) => (
                <tr key={c.cls}>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{c.label}</td>
                  <td className={s.dim}>{c.definition}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Lanes d={d} />

      <Section title="How trustworthy are the lessons?">
        <div className={s.grid2}>
          <div className={s.card}>
            <h3>Data quality</h3>
            <ul className={s.list}>
              <li><b>{o.coins.phantomReadings}</b> readings in {o.coins.withPhantoms} coins were left out as glitches (the pool liquidity jumped 20x for a few scans and fell back). One of them once produced a "1,194x coin".</li>
              <li><b>{o.coins.censored}</b> coins were dropped by the scanner (rejected or expired). Their later months are completed by the lab's own tail tracking, so a rejection can be graded by what the coin did afterwards.</li>
              <li><b>{o.coins.thin}</b> coins have fewer than 8 clean readings and are never called winners or losers.</li>
              <li>Median {o.medianReadings.toFixed(0)} readings per coin; {o.coins.open} coins are still maturing, {o.coins.final} are final.</li>
            </ul>
          </div>
          <div className={s.card}>
            <h3>Collected from now on</h3>
            {d.collectors && d.collectors.length ? (
              <table className={s.table}>
                <tbody>
                  {d.collectors.map((c) => (
                    <tr key={c.source}>
                      <td>{SOURCE_TEXT[c.source] ?? c.source}</td>
                      <td className={s.num}>{c.rows.toLocaleString()} rows</td>
                      <td className={s.num}>{c.coins} coins</td>
                      <td className={`${s.num} ${s.dim}`}>{ago(c.last)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className={s.sub}>The collectors have not run yet. They start with the next learning round.</p>
            )}
            <p className={s.small} style={{ marginTop: 8 }}>
              Unique buyers, organic score and holder counts exist only as snapshots, so the lab can only learn from them for coins it watches from now on.
            </p>
          </div>
        </div>
      </Section>

      <Section title="Decision moments">
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Moment</th>
                <th className={s.num}>Coins with a snapshot</th>
                <th className={s.num}>Outcome decided</th>
              </tr>
            </thead>
            <tbody>
              {o.moments.map((m) => (
                <tr key={m.tau}>
                  <td>{m.tau === 0 ? "First look" : `${m.tau} h after the first look`}</td>
                  <td className={s.num}>{m.snaps}</td>
                  <td className={s.num}>{m.decided}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Note>
          At each moment the lab freezes what the coin looks like and waits for the next 72 hours. A moment only counts once its whole window has been seen: counting early winners but waiting for the losers would make every rate look better than it is.
        </Note>
      </Section>
    </>
  );
}
