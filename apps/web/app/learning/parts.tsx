"use client";
import type { ReactNode } from "react";
import s from "./lab.module.css";
import { pct, pctS } from "./format";

export function Section({ title, lede, children }: { title: string; lede?: ReactNode; children: ReactNode }) {
  return (
    <section className={s.section}>
      <h2>{title}</h2>
      {lede && <p className={s.lede}>{lede}</p>}
      {children}
    </section>
  );
}

export function Stat({ value, label, sub, tone }: { value: ReactNode; label: string; sub?: ReactNode; tone?: "good" | "bad" | "info" | "warn" }) {
  return (
    <div className={`${s.card} ${s.stat}`}>
      <div className={`v ${tone ? s[tone] : ""}`} style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.4, lineHeight: 1.1 }}>
        {value}
      </div>
      <div className="l" style={{ marginTop: 4, color: "#b4b4c6", fontSize: 12 }}>{label}</div>
      {sub && <div className="s" style={{ color: "#8a8a9e", fontSize: 11.5, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const BADGE: Record<string, string> = {
  strong: s.bStrong, protective: s.bProtective, supported: s.bSupported, valid: s.bValid,
  suggestive: s.bSuggestive, open: s.bOpen, collecting: s.bCollecting,
  weak: s.bWeak, neutral: s.bNeutral, thin: s.bThin,
  costly: s.bCostly, contradicted: s.bContradicted, invalid: s.bInvalid,
};

export function Badge({ kind, children }: { kind: string; children?: ReactNode }) {
  return <span className={`${s.badge} ${BADGE[kind] ?? s.bWeak}`}>{children ?? kind}</span>;
}

export function Seg<T extends string | number>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }> }) {
  return (
    <div className={s.seg} role="tablist">
      {options.map((o) => (
        <button key={String(o.value)} className={`${s.segBtn} ${o.value === value ? s.segBtnOn : ""}`} onClick={() => onChange(o.value)} role="tab" aria-selected={o.value === value}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Note({ children, warn }: { children: ReactNode; warn?: boolean }) {
  return <div className={`${s.note} ${warn ? s.noteWarn : ""}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className={s.empty}>{children}</div>;
}

/** A rate with its sample: "18% (12 of 66)". */
export function RateText({ r, d }: { r: { k: number; n: number; p: number; lo: number; hi: number } | null | undefined; d?: number }) {
  if (!r || r.n === 0) return <span className={s.dim}>–</span>;
  return (
    <span title={`${r.k} of ${r.n}. 90% interval ${pct(r.lo)} to ${pct(r.hi)}`}>
      {d != null ? pct(r.p, d) : pctS(r.p)} <span className={s.dim}>({r.k}/{r.n})</span>
    </span>
  );
}

/** Small column chart: one bar per group, height = the rate, sample size under the label. */
export function Bars({ items, tone, max }: { items: Array<{ label: string; value: number | null; n: number }>; tone?: "red" | "teal"; max?: number }) {
  const top = max ?? Math.max(0.05, ...items.map((i) => i.value ?? 0));
  return (
    <div>
      <div className={s.bars}>
        {items.map((i, idx) => (
          <div key={idx} className={s.barCol}>
            <div className={s.barVal}>{i.value == null || i.n < 8 ? "–" : pctS(i.value)}</div>
            <div className={`${s.bar} ${tone === "red" ? s.barRed : ""}`} style={{ height: `${i.value == null || i.n < 8 ? 2 : Math.max(2, (i.value / top) * 100)}%`, opacity: i.n < 15 ? 0.45 : 1 }} />
          </div>
        ))}
      </div>
      <div className={s.barLabels}>
        {items.map((i, idx) => (
          <div key={idx} className={s.barLabel}>
            {i.label}
            <br />
            <span style={{ opacity: 0.7 }}>{i.n} coins</span>
          </div>
        ))}
      </div>
    </div>
  );
}
