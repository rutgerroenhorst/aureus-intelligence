"use client";
import { Fragment, useState } from "react";
import s from "./lab.module.css";
import { Badge, Empty, Note, RateText, Section, Seg } from "./parts";
import { evText, evTone, pct, pctS, tauText } from "./format";
import type { LabData } from "./types";
import type { RuleResult } from "@/lib/lab/reports/rulesboard";

const ZONE_ORDER = ["steady", "burner", "zombie", "knife"] as const;

export function Filters({ d }: { d: LabData }) {
  const ng = d.nogo;
  const taus = ng?.taus ?? [];
  const [tau, setTau] = useState<number>(() => (taus.find((t) => t.tau === 3) ? 3 : taus[0]?.tau ?? 3));
  const [mode, setMode] = useState<"opportunity" | "risk">("opportunity");
  const [open, setOpen] = useState<string | null>(null);
  const t = taus.find((x) => x.tau === tau) ?? taus[0];
  const rows = t ? (mode === "opportunity" ? t.byOpportunity : t.byRisk) : [];

  return (
    <>
      <Section
        title="The bullshit filter"
        lede="Coins that have volume but are never going anywhere. The lab does not guess: it ranks coins by its own odds, removes the worst 10 to 50%, and shows exactly what that would have cost in winners and what it would have saved in crashes, on coins it had not been fitted to."
      >
        {!t ? (
          <Empty>Not enough coins with a finished outcome window yet.</Empty>
        ) : (
          <>
            <Seg value={tau} onChange={setTau} options={taus.map((x) => ({ value: x.tau, label: tauText(x.tau) }))} />
            <h3 style={{ margin: "4px 0 8px", fontSize: 14 }}>Four kinds of coin at {tauText(tau)}</h3>
            <div className={s.grid2}>
              {ZONE_ORDER.map((id) => {
                const z = t.zones.find((x) => x.id === id);
                if (!z) return null;
                return (
                  <div key={id} className={s.zone}>
                    <h4>{z.label}</h4>
                    <div className={s.small}>{z.about}</div>
                    <div className={s.small} style={{ marginTop: 8 }}>
                      {z.group.n} coins · doubled <RateText r={z.group.go2} /> · lost half <RateText r={z.group.collapse24} />
                    </div>
                    <div className={`${s.small} ${s[evTone(z.group.ev.mean)]}`} style={{ marginTop: 2 }}>
                      Exit-ladder result {evText(z.group.ev.mean)} ({z.group.ev.n} coins)
                    </div>
                  </div>
                );
              })}
            </div>

            <h3 style={{ margin: "22px 0 8px", fontSize: 14 }}>Filter simulator at {tauText(tau)}</h3>
            <Seg
              value={mode}
              onChange={setMode}
              options={[
                { value: "opportunity", label: "Remove the least likely to double" },
                { value: "risk", label: "Remove the most likely to crash" },
              ]}
            />
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Remove</th>
                    <th className={s.num}>Winners lost</th>
                    <th className={s.num}>Crashes avoided</th>
                    <th className={s.num}>Kept: doubled</th>
                    <th className={s.num}>Kept: ladder</th>
                    <th className={s.num}>Removed: doubled</th>
                    <th className={s.num}>Removed: ladder</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.share}>
                      <td>{pct(r.share)} of coins ({r.removed.n})</td>
                      <td className={`${s.num} ${s.bad}`}>{pct(r.winnersLost.p)} <span className={s.dim}>({r.winnersLost.k}/{r.winnersLost.n})</span></td>
                      <td className={`${s.num} ${s.good}`}>{pct(r.crashesAvoided.p)} <span className={s.dim}>({r.crashesAvoided.k}/{r.crashesAvoided.n})</span></td>
                      <td className={s.num}>{pctS(r.kept.go2.p)}</td>
                      <td className={`${s.num} ${s[evTone(r.kept.ev.mean)]}`}>{evText(r.kept.ev.mean)}</td>
                      <td className={s.num}>{pctS(r.removed.go2.p)}</td>
                      <td className={`${s.num} ${s[evTone(r.removed.ev.mean)]}`}>{evText(r.removed.ev.mean)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Note>
              Read it like this: if the lab removed the bottom 30% and 25% of the future winners were in that 30%, the filter would cost a quarter of the winners to throw out 30% of the coins. A good filter loses few winners and many crashes. Coins in general: {pctS(t.base.go2.p)} doubled, {pctS(t.base.collapse24.p)} lost half within a day.
            </Note>
          </>
        )}
      </Section>

      <RuleSearch d={d} />
      <Scoreboard d={d} open={open} setOpen={setOpen} />
    </>
  );
}

function RuleSearch({ d }: { d: LabData }) {
  const rules = d.nogo?.rules ?? [];
  return (
    <Section
      title="Plain rules for no-hopers, tested on later coins"
      lede="The lab searches thousands of simple rules ('volume dried up AND few trades') on the earlier 60% of coins and then checks the best few on the later 40% that it never looked at. A rule only counts as validated when, on those later coins, it removed clearly more no-hopers than chance and lost few winners."
    >
      {rules.length === 0 ? (
        <Empty>Not enough coins yet.</Empty>
      ) : (
        rules.map((g) => (
          <div key={g.tau} style={{ marginBottom: 14 }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>At {tauText(g.tau)} (coins in general: {pct(g.baseNoGo)} never held 1.5x)</h3>
            <div className={s.grid2}>
              {g.candidates.map((c, i) => (
                <div key={i} className={s.card}>
                  <div className={s.cardTop}>
                    <div style={{ fontWeight: 600 }}>{c.text}</div>
                    <Badge kind={c.validated ? "valid" : "invalid"}>{c.validated ? "holds up" : "not proven"}</Badge>
                  </div>
                  <div className={s.small} style={{ marginTop: 6 }}>
                    Earlier coins: removed {c.train.removed}, of which {c.train.noGo} no-hopers and {c.train.wins} winners.
                  </div>
                  <div className={s.small}>
                    Later coins: removed {c.test.removed} ({pct(c.test.share)}), {pctS(c.test.precision.p)} were no-hopers ({pct(c.test.precision.lo)} to {pct(c.test.precision.hi)}), {c.test.winnersLost} of {c.test.winnersTotal} winners lost.
                  </div>
                  <div className={s.small} style={{ marginTop: 6 }}>{c.why}</div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </Section>
  );
}

const VERDICT: Record<string, string> = { protective: "protects", costly: "costs winners", neutral: "no difference", thin: "too few coins" };

function Scoreboard({ d, open, setOpen }: { d: LabData; open: string | null; setOpen: (v: string | null) => void }) {
  const rules = d.rules?.rules ?? [];
  if (!rules.length) return null;
  return (
    <Section
      title="Do our own rules help?"
      lede="Every rule the system uses to hide or reject coins, graded by what happened to the coins it blocked compared with the ones it let through, measured forward from the moment of the check. Protects = the blocked coins did worse. Costs winners = the blocked coins did better, so the rule throws good coins away."
    >
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Rule</th>
              <th className={s.num}>Blocks (first look)</th>
              <th>First look</th>
              <th>Later (3 to 6 h)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <FragmentRow key={r.id} r={r} open={open === r.id} toggle={() => setOpen(open === r.id ? null : r.id)} />
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function FragmentRow({ r, open, toggle }: { r: RuleResult; open: boolean; toggle: () => void }) {
  const f = r.firstLook;
  const l = r.later;
  return (
    <Fragment>
      <tr>
        <td>
          <div style={{ fontWeight: 600 }}>{r.label}</div>
          <div className={s.small}>{r.where}</div>
        </td>
        <td className={s.num}>{f ? `${pct(f.share)} (${f.blocked.n})` : "–"}</td>
        <td>{f ? <Badge kind={f.verdict}>{VERDICT[f.verdict]}</Badge> : "–"}</td>
        <td>{l ? <Badge kind={l.verdict}>{VERDICT[l.verdict]}</Badge> : "–"}</td>
        <td><button className={s.btn} onClick={toggle}>{open ? "Hide" : "Details"}</button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5}>
            <div className={s.small} style={{ marginBottom: 8 }}>{r.about}</div>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Moment</th>
                  <th className={s.num}>Blocked / passed</th>
                  <th className={s.num}>Doubled (blocked vs passed)</th>
                  <th className={s.num}>Lost half (blocked vs passed)</th>
                  <th className={s.num}>Ladder (blocked vs passed)</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {r.byTau.map((c) => (
                  <tr key={c.tau}>
                    <td>{tauText(c.tau)}</td>
                    <td className={s.num}>{c.blocked.n} / {c.passed.n}</td>
                    <td className={s.num}>{c.blocked.go2.n ? pctS(c.blocked.go2.p) : "–"} vs {c.passed.go2.n ? pctS(c.passed.go2.p) : "–"}</td>
                    <td className={s.num}>{c.blocked.collapse24.n ? pctS(c.blocked.collapse24.p) : "–"} vs {c.passed.collapse24.n ? pctS(c.passed.collapse24.p) : "–"}</td>
                    <td className={s.num}>{evText(c.blocked.ev.mean)} vs {evText(c.passed.ev.mean)}</td>
                    <td><Badge kind={c.verdict}>{VERDICT[c.verdict]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
