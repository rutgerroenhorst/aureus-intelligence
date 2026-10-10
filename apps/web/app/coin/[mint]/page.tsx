"use client";
import { useState } from "react";
import { usePolling } from "@/lib/usePolling";
import s from "@/app/learning/lab.module.css";
import { Badge, Note, Section } from "@/app/learning/parts";
import { hours, usd } from "@/app/learning/format";
import type { Dossier } from "@/lib/dossier";

const pct = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? "-" : `${v >= 0 && d === 0 && false ? "+" : ""}${v.toFixed(d)}%`);
const signed = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "-" : `${v >= 0 ? "+" : "−"}${Math.abs(v) >= 100 ? Math.abs(v).toFixed(0) : Math.abs(v).toFixed(1)}%`);
const n0 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "-" : Math.round(v).toLocaleString("en-US"));
const when = (t: number | null) => (t == null ? "-" : new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC");

function Chart({ candles, mcapPerPrice }: { candles: Array<[number, number, number, number, number, number]>; mcapPerPrice: number | null }) {
  if (candles.length < 3) return null;
  const W = 680;
  const H = 200;
  const pad = { l: 56, r: 10, t: 10, b: 22 };
  const xs = candles.map((c) => c[0]);
  const ys = candles.map((c) => c[4] * (mcapPerPrice ?? 1));
  const lo = Math.min(...candles.map((c) => c[3] * (mcapPerPrice ?? 1)));
  const hi = Math.max(...candles.map((c) => c[2] * (mcapPerPrice ?? 1)));
  const y0 = Math.log10(lo * 0.9);
  const y1 = Math.log10(hi * 1.1);
  const x = (t: number) => pad.l + ((t - xs[0]!) / (xs[xs.length - 1]! - xs[0]!)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (Math.log10(v) - y0) / (y1 - y0)) * (H - pad.t - pad.b);
  const line = ys.map((v, i) => `${i === 0 ? "M" : "L"}${x(xs[i]!).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const ticks: number[] = [];
  for (let e = Math.ceil(y0); e <= Math.floor(y1); e++) ticks.push(10 ** e);
  const days: number[] = [];
  for (let t = Math.ceil(xs[0]! / 86400) * 86400; t < xs[xs.length - 1]!; t += 86400) days.push(t);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Hourly closes, market cap on a log scale">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#2a2a3e" />
          <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#8a8a9e">{usd(v)}</text>
        </g>
      ))}
      {days.map((t) => (
        <text key={t} x={x(t)} y={H - 6} textAnchor="middle" fontSize="10" fill="#8a8a9e">{new Date(t * 1000).toISOString().slice(5, 10)}</text>
      ))}
      <path d={line} fill="none" stroke="#30b0c0" strokeWidth="1.7" />
    </svg>
  );
}

type Chip = { text: string; tone: "good" | "warn" | "bad" | "info"; why: string };

function chipsOf(d: Dossier): Chip[] {
  const c: Chip[] = [];
  const r = d.rugcheck;
  const j = d.jupiter;
  if (r) {
    if (r.rugged) c.push({ text: "RugCheck says rugged", tone: "bad", why: "RugCheck marks this coin as rugged." });
    else if (r.risks.length) c.push({ text: `${r.risks.length} RugCheck risk${r.risks.length > 1 ? "s" : ""}`, tone: "warn", why: r.risks.map((x) => x.name).join(", ") });
    else c.push({ text: "No RugCheck risks", tone: "good", why: "RugCheck lists no risks for this coin (its score is 1 at best)." });
    if (r.lpLockedPct != null) c.push({ text: `LP ${Math.round(r.lpLockedPct)}% locked`, tone: r.lpLockedPct >= 50 ? "good" : r.lpLockedPct < 10 ? "warn" : "info", why: "Share of the liquidity pool tokens that are locked or burned (RugCheck)." });
    if (r.mintAuthority || r.freezeAuthority) c.push({ text: r.mintAuthority ? "Mint authority still on" : "Freeze authority still on", tone: "bad", why: "Someone can still create more of the coin or freeze holders." });
    const insiders = r.insiderNetworks.reduce((a, n) => a + (n.holdingPct ?? 0), 0);
    if (insiders >= 5) c.push({ text: `Insider networks hold ${insiders.toFixed(0)}%`, tone: "bad", why: "Wallets linked to each other (transfers from the same source) hold this share of the supply." });
    else if ((r.insidersDetected ?? 0) > 0) c.push({ text: `${r.insidersDetected} insider links, ${insiders.toFixed(1)}% held`, tone: "info", why: "RugCheck found linked wallets; together they hold little." });
    if (r.top10Pct != null) c.push({ text: `Top 10 hold ${r.top10Pct.toFixed(0)}%`, tone: r.top10Pct >= 40 ? "warn" : "info", why: "Share of the supply held by the ten largest accounts (pools included)." });
  }
  if (j) {
    if (j.organic != null) c.push({ text: `Organic score ${Math.round(j.organic)}`, tone: j.organic >= 70 ? "good" : j.organic < 30 ? "warn" : "info", why: "Jupiter's score for how organic the trading looks (0-100)." });
    if ((j.devMints ?? 0) >= 5) c.push({ text: `Developer launched ${j.devMints} coins`, tone: "warn", why: "A serial launcher." });
    else if (j.devMints === 1) c.push({ text: "One-off developer", tone: "info", why: "The developer has launched only this coin." });
  }
  if (d.paid?.profile && d.market?.pairCreatedAt) {
    const mins = (d.paid.profile - d.market.pairCreatedAt / 1000) / 60;
    if (mins >= 0 && mins <= 60) c.push({ text: `Paid profile after ${Math.max(1, Math.round(mins))} min`, tone: "info", why: "The team paid DexScreener for an enhanced profile soon after the pair appeared." });
  }
  if (d.lab.pump && d.lab.pump.createToMigrateMin != null && d.lab.pump.createToMigrateMin < 2 && (d.lab.pump.initialBuySol ?? 0) >= 50) c.push({ text: `Born graduated (creator bought ${Math.round(d.lab.pump.initialBuySol ?? 0)} SOL)`, tone: "warn", why: "The creator bought the whole bonding curve in the launch transaction, so the coin graduated within minutes. That is not how organic graduations look; the lab is measuring how these coins end." });
  if (d.lab.pump?.mayhem) c.push({ text: "Mayhem Mode launch", tone: "warn", why: "An AI agent trades this coin for its first 24 hours; early volume is partly the agent's." });
  if (d.narrative.aiName) c.push({ text: "AI, agent or bot name", tone: "info", why: "The name points at AI, agents or bots (the lab tests whether such coins do better)." });
  return c;
}

const TONE = { good: s.tagGood, warn: s.tagWarn, bad: s.tagWarn, info: "" } as const;

export default function CoinPage({ params }: { params: { mint: string } }) {
  const mint = params.mint;
  const [d, setD] = useState<Dossier | null>(null);
  const [err, setErr] = useState<string | null>(null);
  usePolling(async () => {
    try {
      const res = await fetch(`/api/coin/${mint}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? String(res.status));
      setD(j);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, 60_000);

  const m = d?.market;
  const supply = m?.priceUsd && m.mcap ? m.mcap / m.priceUsd : null;
  const chips = d ? chipsOf(d) : [];
  const ageH = m?.pairCreatedAt ? (Date.now() - m.pairCreatedAt) / 3_600_000 : null;
  return (
    <div className={s.page}>
      <div className={s.head}>
        <h1>{m?.symbol ?? "Coin"} <span className={s.dim} style={{ fontSize: 15, fontWeight: 400 }}>{m?.name}</span></h1>
        <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{mint}</p>
        <div className={s.chips}>
          <a className={s.chip} href={`https://dexscreener.com/solana/${m?.pair ?? mint}`} target="_blank" rel="noreferrer">DexScreener</a>
          <a className={s.chip} href={`https://rugcheck.xyz/tokens/${mint}`} target="_blank" rel="noreferrer">RugCheck</a>
          <a className={s.chip} href={`https://jup.ag/tokens/${mint}`} target="_blank" rel="noreferrer">Jupiter</a>
          <a className={s.chip} href={`https://solscan.io/token/${mint}`} target="_blank" rel="noreferrer">Solscan</a>
        </div>
      </div>
      {err && !d && <Note warn>{err}</Note>}
      {!d && !err && <Note>Gathering what the free sources say about this coin…</Note>}
      {d && (
        <>
          <Section title="At a glance" lede="Every flag below comes from a free source and says where. They describe the coin now; none is a promise, and a coin with no flags can still fall.">
            <div>{chips.map((c) => <span key={c.text} className={`${s.tag} ${TONE[c.tone]}`} title={c.why}>{c.text}</span>)}{!chips.length && <span className={s.dim}>No source answered yet.</span>}</div>
          </Section>

          {m && (
            <Section title="Market">
              <div className={s.grid4}>
                <div className={`${s.card} ${s.stat}`}><div className="v" style={{ fontSize: 24, fontWeight: 700 }}>{usd(m.mcap)}</div><div className="l" style={{ color: "#b4b4c6", fontSize: 12 }}>market cap</div><div className={s.small}>liquidity {usd(m.liquidity)}{ageH != null ? ` · pair ${hours(ageH)} old` : ""}</div></div>
                <div className={`${s.card} ${s.stat}`}><div style={{ fontSize: 24, fontWeight: 700 }} className={(m.change.h24 ?? 0) >= 0 ? s.good : s.bad}>{signed(m.change.h24)}</div><div style={{ color: "#b4b4c6", fontSize: 12 }}>24 h</div><div className={s.small}>1 h {signed(m.change.h1)} · 6 h {signed(m.change.h6)}</div></div>
                <div className={`${s.card} ${s.stat}`}><div style={{ fontSize: 24, fontWeight: 700 }}>{usd(m.volume.h24)}</div><div style={{ color: "#b4b4c6", fontSize: 12 }}>volume, 24 h</div><div className={s.small}>last hour {usd(m.volume.h1)}</div></div>
                <div className={`${s.card} ${s.stat}`}><div style={{ fontSize: 24, fontWeight: 700 }}>{m.buys.h24 != null && m.sells.h24 != null ? `${Math.round((m.buys.h24 / Math.max(1, m.buys.h24 + m.sells.h24)) * 100)}%` : "-"}</div><div style={{ color: "#b4b4c6", fontSize: 12 }}>of trades are buys, 24 h</div><div className={s.small}>{n0(m.buys.h24)} buys · {n0(m.sells.h24)} sells · {m.dex}</div></div>
              </div>
              <div className={s.card} style={{ marginTop: 14 }}>
                <h3>Price history, last 7 days</h3>
                {d.chart ? <Chart candles={d.chart.candles} mcapPerPrice={supply} /> : <div className={s.small}>No price history right now ({d.sources.geckoterminal ?? "GeckoTerminal not asked"}). It is the source most often refused from shared addresses; try again in a minute.</div>}
              </div>
            </Section>
          )}

          <Section title="Who holds it and who trades it">
            <div className={s.grid2}>
              <div className={s.card}>
                <h3>Holders</h3>
                <table className={s.table}><tbody>
                  <tr><td>Holders (Jupiter)</td><td className={s.num}>{n0(d.jupiter?.holders)}</td></tr>
                  <tr><td>Token accounts (RugCheck)</td><td className={s.num}>{n0(d.rugcheck?.totalHolders)}</td></tr>
                  <tr><td>Top 10 accounts hold</td><td className={s.num}>{pct(d.rugcheck?.top10Pct ?? d.jupiter?.topHoldersPct, 1)}</td></tr>
                  <tr><td>Creator still holds</td><td className={s.num}>{pct(d.rugcheck?.creatorPct ?? d.jupiter?.devPct, 1)}</td></tr>
                  <tr><td>Liquidity locked</td><td className={s.num}>{pct(d.rugcheck?.lpLockedPct, 0)}</td></tr>
                  <tr><td>Insider links found</td><td className={s.num}>{n0(d.rugcheck?.insidersDetected)}</td></tr>
                </tbody></table>
                {d.rugcheck && d.rugcheck.topHolders.length > 0 && (
                  <div className={s.small} style={{ marginTop: 8 }}>
                    Largest accounts: {d.rugcheck.topHolders.slice(0, 5).map((h) => `${h.pct.toFixed(1)}%${h.insider ? " (insider)" : ""}`).join(" · ")}
                  </div>
                )}
              </div>
              <div className={s.card}>
                <h3>Traders, last 24 hours (Jupiter)</h3>
                {d.jupiter ? (
                  <table className={s.table}><tbody>
                    <tr><td>Distinct traders</td><td className={s.num}>{n0(d.jupiter.h24.numTraders)}</td></tr>
                    <tr><td>Organic buyers</td><td className={s.num}>{n0(d.jupiter.h24.numOrganicBuyers)}</td></tr>
                    <tr><td>Net buyers (bought more than sold)</td><td className={s.num}>{n0(d.jupiter.h24.numNetBuyers)}</td></tr>
                    <tr><td>Organic share of volume</td><td className={s.num}>{d.jupiter.h24.buyVolume != null && d.jupiter.h24.sellVolume != null && d.jupiter.h24.buyOrganicVolume != null && d.jupiter.h24.sellOrganicVolume != null ? pct(((d.jupiter.h24.buyOrganicVolume + d.jupiter.h24.sellOrganicVolume) / Math.max(1, d.jupiter.h24.buyVolume + d.jupiter.h24.sellVolume)) * 100, 0) : "-"}</td></tr>
                    <tr><td>Holders, 24 h change</td><td className={s.num}>{signed(d.jupiter.h24.holderChange)}</td></tr>
                    <tr><td>Liquidity, 24 h change</td><td className={s.num}>{signed(d.jupiter.h24.liquidityChange)}</td></tr>
                  </tbody></table>
                ) : <div className={s.small}>Jupiter has no listing for this coin ({d.sources.jupiter}).</div>}
              </div>
            </div>
          </Section>

          <Section title="What the team paid for" lede="Paid promotion is a signal in both directions: a team that spends money is committed, and paid attention is also how weak coins get noticed. The lab tests whether it matters.">
            {d.paid ? (
              <div className={s.card}>
                <table className={s.table}><tbody>
                  <tr><td>DexScreener profile</td><td className={s.num}>{d.paid.profile ? `${when(d.paid.profile)}${m?.pairCreatedAt ? ` (${Math.round((d.paid.profile - m.pairCreatedAt / 1000) / 60)} min after the pair)` : ""}` : "not paid"}</td></tr>
                  <tr><td>Boosts</td><td className={s.num}>{d.paid.boosts.length ? d.paid.boosts.map((b) => `${b[1]} on ${when(b[0]).slice(5, 16)}`).join(" · ") : "none"}</td></tr>
                  <tr><td>Ads</td><td className={s.num}>{d.paid.ads.length ? d.paid.ads.length : "none"}</td></tr>
                  <tr><td>Community takeover</td><td className={s.num}>{d.paid.cto ? when(d.paid.cto) : "no"}</td></tr>
                </tbody></table>
              </div>
            ) : <div className={s.small}>DexScreener's order list could not be read ({d.sources.orders}).</div>}
          </Section>

          <Section title="Who made it">
            <div className={s.card}>
              <table className={s.table}><tbody>
                <tr><td>Launchpad</td><td className={s.num}>{d.jupiter?.launchpad ?? d.rugcheck?.launchpad ?? "-"}</td></tr>
                <tr><td>Coins the developer launched (Jupiter)</td><td className={s.num}>{n0(d.jupiter?.devMints)}</td></tr>
                {d.lab.pump && <>
                  <tr><td>Minutes from launch to graduation</td><td className={s.num}>{d.lab.pump.createToMigrateMin == null ? "-" : Math.round(d.lab.pump.createToMigrateMin).toLocaleString("en-US")}</td></tr>
                  <tr><td>Creator's first buy</td><td className={s.num}>{d.lab.pump.initialBuySol == null ? "-" : `${d.lab.pump.initialBuySol.toFixed(2)} SOL`}</td></tr>
                  <tr><td>Creator's launches in the 72 h before</td><td className={s.num}>{n0(d.lab.pump.creatorLaunches72h)}</td></tr>
                  <tr><td>Mayhem Mode</td><td className={s.num}>{d.lab.pump.mayhem ? "yes" : "no"}</td></tr>
                </>}
                <tr><td>First seen by RugCheck</td><td className={s.num}>{d.rugcheck?.detectedAt ? d.rugcheck.detectedAt.slice(0, 16).replace("T", " ") + " UTC" : "-"}</td></tr>
              </tbody></table>
            </div>
          </Section>

          <Section title="What the lab knows">
            <div className={s.card}>
              {d.lab.lesson || d.lab.watch ? (
                <div>
                  {d.lab.lesson && <div>Followed as <b>{d.lab.lesson.lane === "fresh" ? "a Radar coin" : d.lab.lesson.lane}</b> since {when(d.lab.lesson.firstSeenAt)}; so far <Badge kind="neutral">{d.lab.lesson.cls.toLowerCase()}</Badge>{d.lab.lesson.peakHeld ? `, highest held level ${d.lab.lesson.peakHeld.toFixed(2)}x its first price` : ""}.</div>}
                  {d.lab.watch && !d.lab.lesson && <div>On the lab's watch list ({d.lab.watch.reason.replace(/_/g, " ")}) since {when(d.lab.watch.firstSeenAt)}, {d.lab.watch.polls} readings so far.</div>}
                </div>
              ) : <div className={s.small}>The lab has not followed this coin.</div>}
              {d.lab.odds && (d.lab.odds.go2 || d.lab.odds.collapse24) && (
                <div style={{ marginTop: 8 }} className={s.small}>
                  Coins that scored like this one: {d.lab.odds.collapse24 ? `${Math.round(d.lab.odds.collapse24.p * 100)}% lost half within a day (${d.lab.odds.collapse24.k} of ${d.lab.odds.collapse24.n})` : ""}
                  {d.lab.odds.go2 ? `; ${Math.round(d.lab.odds.go2.p * 100)}% doubled within 3 days (${d.lab.odds.go2.k} of ${d.lab.odds.go2.n})` : ""}.
                </div>
              )}
              {d.lab.odds && d.lab.odds.flags.length > 0 && <div style={{ marginTop: 6 }}>{d.lab.odds.flags.map((f) => <span key={f} className={s.tag}>{f}</span>)}</div>}
              {d.lab.entry && (
                <div style={{ marginTop: 10 }} className={s.small}>
                  Your journal: entered {when(Date.parse(d.lab.entry.enteredAt) / 1000)}{d.lab.entry.tab ? ` from ${d.lab.entry.tab.replace(/_/g, " ")}` : ""} at {usd(d.lab.entry.entryMcap)}; now {d.lab.entry.multiplier.toFixed(2)}x, highest {d.lab.entry.peakMultiple.toFixed(2)}x.
                </div>
              )}
            </div>
          </Section>

          <p className={s.small}>
            Sources: {Object.entries(d.sources).map(([k, v]) => `${k}: ${v}`).join(" · ")}. Built {when(Date.parse(d.at) / 1000)}. Not advice.
          </p>
        </>
      )}
    </div>
  );
}
