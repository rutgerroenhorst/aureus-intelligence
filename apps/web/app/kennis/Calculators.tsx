"use client";
import { useState, type ReactNode } from "react";
import { neededGain, positionSize, priceImpact, runChance, stakeBackFraction, streakChance, streakLoss, takeProfit } from "@/lib/kennis/calc";
import { brand } from "@/lib/brand";

const card: React.CSSProperties = { background: "#141418", border: "1px solid #2a2a2f", borderRadius: 8, padding: 14, marginBottom: 12 };
const label: React.CSSProperties = { fontSize: 12, color: "#8a8a8e", display: "block", marginBottom: 4 };
const input: React.CSSProperties = { width: "100%", height: 40, padding: "0 10px", background: "#0f1116", color: brand.fg, border: "1px solid #2a2a2f", borderRadius: 6, fontSize: 16, boxSizing: "border-box" };
const out: React.CSSProperties = { marginTop: 10, padding: "10px 12px", background: "rgba(47, 91, 255, 0.10)", borderLeft: `3px solid ${brand.blue}`, borderRadius: 4, fontSize: 13, lineHeight: 1.6, color: "#d4d4de" };

const n = (s: string): number => {
  const v = parseFloat(s.replace(",", "."));
  return Number.isFinite(v) ? v : 0;
};
const usd = (v: number) => `$${v >= 100 ? Math.round(v).toLocaleString("nl-NL") : v.toFixed(2).replace(".", ",")}`;
const pc = (v: number, d = 0) => `${v.toFixed(d).replace(".", ",")}%`;

function Field({ name, value, onChange, suffix }: { name: string; value: string; onChange: (v: string) => void; suffix?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 110 }}>
      <label style={label}>
        {name}
        {suffix ? ` (${suffix})` : ""}
      </label>
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" style={input} />
    </div>
  );
}

function Calc({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <div style={card}>
      <h3 style={{ margin: "0 0 4px", fontSize: 15, color: "#fff" }}>{title}</h3>
      <div style={{ fontSize: 12, color: "#8a8a8e", marginBottom: 10, lineHeight: 1.5 }}>{intro}</div>
      {children}
    </div>
  );
}

/** Four small calculators for the sums the answers talk about. They only compute: nothing is saved and nothing is sent anywhere. */
export function Calculators() {
  const [bank, setBank] = useState("500");
  const [risk, setRisk] = useState("2");
  const [stake, setStake] = useState("20");
  const [mult, setMult] = useState("2");
  const [fee, setFee] = useState("5");
  const [sell, setSell] = useState("");
  const [loss, setLoss] = useState("50");
  const [order, setOrder] = useState("200");
  const [pool, setPool] = useState("20000");

  const size = positionSize(n(bank), n(risk));
  const sb = stakeBackFraction(n(mult), n(fee));
  const sellFrac = sell.trim() === "" ? sb : Math.min(Math.max(n(sell) / 100, 0), 1);
  const tp = takeProfit(n(stake), n(mult), sellFrac, n(fee));
  const imp = priceImpact(n(order), n(pool));

  return (
    <div>
      <Calc title="Inleg per coin" intro="Een vast deel van je bankroll per coin. Bij memecoins telt de hele inleg als het verlies dat je riskeert (zie 'Positiegrootte').">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Field name="Bankroll" suffix="$" value={bank} onChange={setBank} />
          <Field name="Risico per coin" suffix="%" value={risk} onChange={setRisk} />
        </div>
        <div style={out}>
          Inleg per coin: <b>{usd(size)}</b>.
          <br />
          Tien verliezers op rij kosten dan ongeveer <b>{pc(100 * streakLoss(n(risk), 10), 0)}</b> van je bankroll. Als 80% van je coins verliest, is de kans op zo'n reeks van 10 <b>{pc(100 * streakChance(0.8, 10), 0)}</b>, en op minstens één zo'n reeks in 100 coins ongeveer <b>{pc(100 * runChance(0.8, 10, 100), 0)}</b>.
        </div>
      </Calc>

      <Calc title="Winst nemen" intro="Hoeveel je verkoopt om je inleg terug te hebben, en wat er dan nog openstaat. Laat 'verkoop' leeg voor het bedrag dat precies je inleg teruggeeft.">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Field name="Inleg" suffix="$" value={stake} onChange={setStake} />
          <Field name="Koers nu" suffix="× je instap" value={mult} onChange={setMult} />
          <Field name="Fees" suffix="% op wat je verkoopt" value={fee} onChange={setFee} />
          <Field name="Verkoop" suffix="% van de positie, leeg = inleg terug" value={sell} onChange={setSell} />
        </div>
        <div style={out}>
          Voor je inleg terug: verkoop <b>{pc(100 * sb, 1)}</b> van de positie.
          <br />
          Je verkoopt {pc(100 * sellFrac, 1)}: dat brengt <b>{usd(tp.proceeds)}</b> op{tp.stakeBack ? ", dus je inleg is terug" : `, dus nog ${usd(tp.atRisk)} van je inleg staat open`}. Er blijft {usd(tp.remainingValue)} open staan ({pc(100 * tp.remainingFraction, 0)} van de positie).
        </div>
      </Calc>

      <Calc title="Verlies terugverdienen" intro="Hoeveel je moet winnen om na een verlies weer op nul uit te komen.">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Field name="Verlies" suffix="%" value={loss} onChange={setLoss} />
        </div>
        <div style={out}>
          Na een verlies van {pc(n(loss), 0)} heb je een winst van <b>{Number.isFinite(neededGain(n(loss))) ? pc(neededGain(n(loss)), 0) : "oneindig"}</b> nodig om gelijk te zijn.
        </div>
      </Calc>

      <Calc title="Price impact" intro="Vuistregel: ongeveer twee keer het aandeel van je order in de hele pool. Voor kopen en voor verkopen.">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Field name="Je order" suffix="$" value={order} onChange={setOrder} />
          <Field name="Pool (liquiditeit)" suffix="$" value={pool} onChange={setPool} />
        </div>
        <div style={out}>
          Je order is {pc(n(pool) > 0 ? (100 * n(order)) / n(pool) : 0, 1)} van de pool: ongeveer <b>{pc(100 * imp, 1)}</b> price impact, in dollars ongeveer <b>{usd(n(order) * imp)}</b> aan de ene kant.
        </div>
      </Calc>
    </div>
  );
}
