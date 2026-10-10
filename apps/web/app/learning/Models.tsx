"use client";
import { Fragment, useState } from "react";
import s from "./lab.module.css";
import { Badge, Empty, Note, Section } from "./parts";
import { pct, pctS, tauText } from "./format";
import type { LabData } from "./types";
import type { ModelEval } from "@/lib/lab/reports/model";

const TARGET = { go2: "doubles within 3 days", collapse24: "loses half within a day" } as const;

export function Models({ d }: { d: LabData }) {
  const evals = d.models?.evals ?? [];
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Section
      title="The odds models"
      lede="Two small models per moment (plain logistic regression on about a dozen features): the chance a coin doubles, and the chance it loses half within a day. They are fitted on the earlier 60% of coins and judged only on the later 40%. AUC 0.50 is a coin flip, 1.00 is perfect; a model is only trusted when the whole interval stays above 0.55."
    >
      {evals.length === 0 ? (
        <Empty>Not enough coins with a finished window yet.</Empty>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Moment</th>
                <th>Predicts</th>
                <th className={s.num}>Fitted / tested on</th>
                <th className={s.num}>Base rate (later coins)</th>
                <th className={s.num}>AUC on later coins</th>
                <th className={s.num}>Best 20% by odds</th>
                <th>Verdict</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {evals.map((e) => {
                const key = `${e.tau}-${e.target}`;
                return (
                  <ModelRow key={key} e={e} open={open === key} toggle={() => setOpen(open === key ? null : key)} />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Note>
        A model that beats chance does not make coins safe: even the best odds here are probabilities. The numbers on the Live tab only use models that passed this test.
      </Note>
    </Section>
  );
}

function ModelRow({ e, open, toggle }: { e: ModelEval; open: boolean; toggle: () => void }) {
  return (
    <Fragment>
      <tr>
        <td>{tauText(e.tau)}</td>
        <td>{TARGET[e.target]}</td>
        <td className={s.num}>{e.nTrain} / {e.nTest}</td>
        <td className={s.num}>{pctS(e.baseTest)}</td>
        <td className={s.num}>{e.auc ? `${e.auc.auc.toFixed(2)} (${e.auc.lo.toFixed(2)}-${e.auc.hi.toFixed(2)})` : "–"}</td>
        <td className={s.num}>{e.top20 ? `${pct(e.top20.rate)} (${e.top20.lift.toFixed(1)}x)` : "–"}</td>
        <td><Badge kind={e.valid ? "valid" : "invalid"}>{e.valid ? "beats chance" : "not proven"}</Badge></td>
        <td><button className={s.btn} onClick={toggle}>{open ? "Hide" : "Why"}</button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8}>
            <div className={s.small} style={{ marginBottom: 6 }}>{e.note}</div>
            <div className={s.small}><b>What the model leans on</b> (standardised weights; positive = more likely):</div>
            <div style={{ marginTop: 4 }}>
              {e.coefs.map((c) => (
                <span key={c.key} className={`${s.tag} ${c.coef > 0 ? s.tagGood : s.tagWarn}`}>{c.label} {c.coef > 0 ? "+" : "−"}{Math.abs(c.coef).toFixed(2)}</span>
              ))}
            </div>
            <div className={s.small} style={{ marginTop: 8 }}>
              <b>Calibration</b> (predicted vs real, five equal groups of later coins): {e.calibration.map((c) => `${pct(c.meanPred)} → ${pct(c.observed)}`).join("   ")}
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
