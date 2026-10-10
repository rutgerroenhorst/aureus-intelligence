"use client";
import s from "./lab.module.css";
import { Empty, Note, Section } from "./parts";
import { hours, usd } from "./format";
import type { LabData } from "./types";
import type { CaseStudy } from "@/lib/lab/cases";

const W = 680;
const H = 250;
const PAD = { l: 52, r: 12, t: 12, b: 26 };

/** Market cap over the coin's life on a log scale, with the Radar's door drawn in: where it stops admitting coins. */
function Chart({ c }: { c: CaseStudy }) {
  const supply = c.supply ?? 1e9;
  const pts = c.series.map(([t, p]) => [t, p * supply] as [number, number]).filter((x) => x[1] > 0);
  if (pts.length < 3) return null;
  const t0 = pts[0]![0];
  const t1 = pts[pts.length - 1]![0];
  const lo = Math.min(...pts.map((p) => p[1]), c.door.maxMcap / 3);
  const hi = Math.max(...pts.map((p) => p[1]));
  const ly0 = Math.log10(lo * 0.8);
  const ly1 = Math.log10(hi * 1.25);
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (m: number) => PAD.t + (1 - (Math.log10(m) - ly0) / (ly1 - ly0)) * (H - PAD.t - PAD.b);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
  const ticks: number[] = [];
  for (let e = Math.ceil(ly0); e <= Math.floor(ly1); e++) ticks.push(10 ** e);
  const g = c.door.graduatedAt;
  const days: number[] = [];
  for (let t = Math.ceil(t0 / 86400) * 86400; t < t1; t += 86400 * 2) days.push(t);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${c.title} market cap since it graduated, with the Radar door at $${c.door.maxMcap.toLocaleString("en-US")}`}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="#2a2a3e" strokeWidth="1" />
          <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#8a8a9e">{usd(v)}</text>
        </g>
      ))}
      {days.map((t) => (
        <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fontSize="10" fill="#8a8a9e">{new Date(t * 1000).toISOString().slice(5, 10)}</text>
      ))}
      <line x1={PAD.l} x2={W - PAD.r} y1={y(c.door.maxMcap)} y2={y(c.door.maxMcap)} stroke="#ff9f0a" strokeDasharray="5 4" strokeWidth="1.2" />
      <text x={W - PAD.r - 4} y={y(c.door.maxMcap) - 5} textAnchor="end" fontSize="10.5" fill="#ff9f0a">the door admits coins up to {usd(c.door.maxMcap)}</text>
      {g && g + c.door.minAgeMin * 60 > t0 && (
        <>
          <rect x={x(Math.max(g, t0))} y={PAD.t} width={Math.max(3, x(g + c.door.minAgeMin * 60) - x(Math.max(g, t0)))} height={H - PAD.t - PAD.b} fill="#ff9f0a" opacity="0.3" />
          <text x={x(g + c.door.minAgeMin * 60) + 6} y={PAD.t + 11} fontSize="10" fill="#ff9f0a">the first hour: the door waits</text>
        </>
      )}
      <path d={line} fill="none" stroke="#30b0c0" strokeWidth="1.8" />
    </svg>
  );
}

export function Cases({ d }: { d: LabData }) {
  const c = d.cases?.items?.[0];
  if (!c) {
    return (
      <Section title="Case study: HOTBOT">
        <Empty>The case study has not been built yet (it needs one pass of market data; it appears after the next rebuild).</Empty>
      </Section>
    );
  }
  const live = d.live?.coins.find((x) => x.mint === c.mint) ?? null;
  const lanes = d.lanes;
  const runners = lanes?.groups.find((g) => g.id === "runners");
  const h6 = d.hypotheses?.items.find((h) => h.id.startsWith("H6"));
  const crossed = c.door.crossedAtH;
  const lows = c.dailyLows.slice(-9);
  return (
    <>
      <Section
        title={`Case study: ${c.title}`}
        lede={`A coin that was worth ${c.door.mcapAtMinAge != null ? usd(c.door.mcapAtMinAge) : "about half a million dollars"} an hour after graduating and ${d.live?.coins.find((x) => x.mint === c.mint)?.mcap != null ? usd(d.live!.coins.find((x) => x.mint === c.mint)!.mcap!) : c.facts.find((f) => f.label === "Market cap now")?.value ?? "several million"} now, and that the Radar never listed. It is here because it shows exactly where the system was blind, and what the lab changed because of it.`}
      >
        {c.about.map((t, i) => (
          <p key={i} className={s.lede} style={{ marginBottom: 8 }}>{t}</p>
        ))}
        <div className={s.card} style={{ marginTop: 10 }}>
          <h3>Its market cap, and where the Radar's door stood</h3>
          <div className={s.small} style={{ marginBottom: 6 }}>Hourly closes since the pair was created, market cap on a log scale (each gridline is ten times the one below).</div>
          <Chart c={c} />
          <div className={s.small} style={{ marginTop: 6 }}>
            {crossed != null ? (
              <>It passed {usd(c.door.maxMcap)} within about {crossed < 1 ? `${Math.max(1, Math.round(crossed * 60))} minutes` : `${crossed.toFixed(1)} hours`} of the pair being created. </>
            ) : null}
            {c.door.mcapAtMinAge != null ? <>An hour after graduating, when the door's 60-minute age rule would first have let it in, it was already worth {usd(c.door.mcapAtMinAge)}, which is {(c.door.mcapAtMinAge / c.door.maxMcap).toFixed(1)} times the door's cap. So no setting of the filters could have let it through: it never fit the door at all.</> : null}
          </div>
        </div>
      </Section>

      <Section title="What can be checked about it today">
        <div className={s.grid2}>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <tbody>
                {c.facts.map((f) => (
                  <tr key={f.label}>
                    <td>
                      {f.label}
                      <div className={s.small}>{f.source}</div>
                    </td>
                    <td className={s.num} style={{ whiteSpace: "normal" }}><b>{f.value}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={s.card}>
            <h3>The floor kept rising</h3>
            <div className={s.small} style={{ marginBottom: 8 }}>Lowest market cap of each day. A coin that is bought in waves tends to leave higher lows; one that is being sold into leaves lower ones.</div>
            <table className={s.table}>
              <tbody>
                {lows.map((l) => (
                  <tr key={l.day}>
                    <td>{l.day}</td>
                    <td className={s.num}>{usd(l.mcap)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={s.small} style={{ marginTop: 8 }}>
              In the lab's other coins this pattern did not predict a further doubling (too few to say). It is one coin, a story, not a rule.
            </div>
          </div>
        </div>
      </Section>

      <Section title="What the lab changed because of it">
        <ul className={s.list}>
          <li className={s.item}><span className={`${s.dot} ${s.dotFinding}`} /><span>The worker now hands the lab every coin the door turns away as too young or too big. The lab watches them for a week and learns from them. The Radar is unchanged.</span></li>
          <li className={s.item}><span className={`${s.dot} ${s.dotFinding}`} /><span>Jupiter's free lists of the most organic, most traded and trending coins are read about every 20 minutes. Coins that look like {c.title} did (worth $0.3M to $150M, three hours to two months old, real liquidity, thousands of holders) join the runner lane. {c.title} itself was on those lists today{live ? ` and is followed now (${live.mcap != null ? usd(live.mcap) : "?"}, ${hours(live.ageH)} since the first look)` : ""}.</span></li>
          <li className={s.item}><span className={`${s.dot} ${s.dotInfo}`} /><span>The idea that AI, agent or bot names keep running more often was written down as hypothesis H6 before any runner coin was collected. {h6 ? `Status: ${h6.status}; the smaller group has ${Math.min(h6.forward.inGroup.n, h6.forward.outGroup.n)} of the ${h6.need} coins needed.` : ""}</span></li>
          <li className={s.item}><span className={`${s.dot} ${s.dotInfo}`} /><span>{runners && runners.basis >= 8 ? `Runner lane so far: ${runners.basis} coins followed for 3 days, ${Math.round(runners.held2.p * 100)}% of them held 2x.` : "The runner lane has just started; its first results appear after the coins have been followed for 3 days."}</span></li>
        </ul>
        <Note>
          Not advice, and not a promise that the next one will look like this one: for every {c.title} the lists also hold coins that faded. The lane exists to measure how often that is, from the moment a coin first shows up on the lists.
        </Note>
        <div className={s.small}>
          Sources:{" "}
          {c.sources.map((x, i) => (
            <span key={x.url}>
              {i > 0 ? " · " : ""}
              <a href={x.url} target="_blank" rel="noreferrer" style={{ color: "var(--teal)" }}>{x.label}</a>
            </span>
          ))}
          . Built {new Date(c.builtAt).toISOString().slice(0, 16).replace("T", " ")} UTC.
        </div>
      </Section>
    </>
  );
}
