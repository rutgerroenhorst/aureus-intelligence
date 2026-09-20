"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { BoardView } from "../../lib/boardSections";
import type { CandidateDecisionView } from "../../lib/candidateView";
import { TradeTicket } from "../../components/TradeTicket";
import { PriceChart } from "../../components/PriceChart";
import { ago, usd, shortMint, dexUrl } from "../../lib/format";

/**
 * The decision surface.
 *
 * This page answers one question — what do I do right now — and everything that does
 * not serve that answer has been moved behind a link. The previous version led with
 * eight status counters and a wall of blocker chips, which is a truthful description
 * of the system's internals and a poor description of the next action.
 */

/** Short enough to scan in a list. Full sentences were truncated to "een nieuwe be…",
 *  which is worse than a terse label that fits. */
const GATE_NL: Record<string, string> = {
  structure_confirmed: "wacht op setup",
  entry_rules_pass:    "entry-regels",
  core_safety_pass:    "veiligheidscheck",
  data_fresh:          "data verouderd",
  slippage_ok:         "slippage te hoog",
  not_late_chase:      "te laat",
  move_not_spent:      "beweging is op",
  meets_quality_floor: "te weinig volume",
  not_distributing:    "verkopers actief",
};

/** Gates that mean "do not buy this", as opposed to "not yet". */
const DISQUALIFYING = new Set(["move_not_spent", "not_late_chase", "not_distributing"]);

/**
 * The single most useful thing to say about a coin that is not ready.
 *
 * When a coin is DISQUALIFIED the reason must be the disqualifier, not merely the
 * first unmet gate — the two are different lists. Showing the first produced
 * "niet kopen — een bevestigde setup", which reads as though a confirmed setup were
 * a reason to stay away.
 */
function waitingOn(v: CandidateDecisionView): string {
  const gates = v.entryReadyBlockers ?? [];
  const disqualifier = gates.find((g) => DISQUALIFYING.has(g));
  const g = disqualifier ?? gates[0];
  if (g) return GATE_NL[g] ?? g.replace(/_/g, " ");
  return v.primaryBlocker;
}

/**
 * Market-cap bands, ceilinged at 150k.
 *
 * Two things stay true at once and it is worth being precise about which is which.
 *
 * Measured at h6, small caps do NOT produce bigger multiples: <25k was the worst
 * bucket on every metric (9% doubled, 5% tripled, p90 peak 95%) against 200-600k
 * (16%, 8%, 151%). That is about how OFTEN a move happens, and it is unchanged.
 *
 * What the ceiling is about is how much a move is WORTH. A 3x from 50k needs 150k and
 * happens; the same 3x from 700k needs 2.1m and is rare at any hit rate. Above 150k
 * the reachable multiple is too small to be worth the risk taken to get it.
 *
 * So: the ceiling is a hard limit, not a scoring tweak. The SCORE is still left alone —
 * within the band it ranks on measurement, not on a preference for tiny numbers.
 */
const MCAP_CEILING = 150_000;
const MCAP_BANDS: Array<{ id: string; label: string; min: number; max: number }> = [
  { id: "all", label: "tot 150k", min: 0, max: MCAP_CEILING },
  { id: "seed", label: "< 25k", min: 0, max: 25_000 },
  { id: "early", label: "25–75k", min: 25_000, max: 75_000 },
  { id: "late", label: "75–150k", min: 75_000, max: MCAP_CEILING },
];

function Row({ v, ok }: { v: CandidateDecisionView; ok: boolean }) {
  // V2 verification badge
  const v2Badge = (v as any).v2Status ? (
    <span className={`v2-badge v2-${(v as any).v2Status?.toLowerCase()}`}
          title={`V2: ${(v as any).v2Status} (confidence: ${(v as any).v2Confidence}%)`}>
      {(v as any).v2Status === "STRUCTURALLY_QUALIFIED" ? "✓ SQ" : (v as any).v2Status}
    </span>
  ) : null;

  return (
    <div className="wrow">
      <Link href={`/candidate/${v.id}`} className="wr-main">
        <span className={`wr-pot${v.potential != null && v.potential >= 0.35 ? " good" : v.potential != null && v.potential <= 0.12 ? " poor" : ""}`}>
          {v.potential != null ? `${Math.round(v.potential * 100)}%` : "—"}
        </span>
        <span className="wr-sym">{v.symbol ?? "Unknown"}</span>
        {/* No levels drawn here: a row is for recognising shape at a glance, and three
            dashed lines at this size are noise rather than information. */}
        <span className="wr-spark"><PriceChart points={v.priceSeries} height={30} /></span>
        <span className="wr-price">{v.marketCapUsd != null ? usd(v.marketCapUsd) : "—"}</span>
        {v2Badge}
        <span className={`wr-need${ok ? "" : " danger"}`} title={waitingOn(v)}>{waitingOn(v)}</span>
      </Link>
      <a className="wr-dex" href={dexUrl(v.mint, v.pool)} target="_blank" rel="noopener noreferrer"
         title="Chart openen in nieuw tabblad">chart ↗</a>
    </div>
  );
}

export function TodayLive({ initial }: { initial: BoardView; enrichment?: Record<string, number> }) {
  const [board, setBoard] = useState<BoardView>(initial);
  const [bandId, setBandId] = useState<string>("all");
  // Read the saved choice after mount, never during render — reading localStorage in
  // the initial state makes the server and client disagree and the page fails to hydrate.
  useEffect(() => {
    const saved = window.localStorage.getItem("aureus:mcapBand");
    if (saved && MCAP_BANDS.some((b) => b.id === saved)) setBandId(saved);
  }, []);
  const band = MCAP_BANDS.find((b) => b.id === bandId) ?? MCAP_BANDS[0]!;
  // Unknown market cap fails the ceiling. We cannot show something as "under 150k"
  // when we do not know that it is — silently admitting unknowns is how a cap becomes
  // decorative.
  const inBand = (v: CandidateDecisionView) => {
    const mc = v.marketCapUsd;
    if (mc == null) return false;
    return mc >= band.min && mc < band.max;
  };
  const [now, setNow] = useState<number>(() => Date.parse(initial.generatedAt) || 0);

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/action-board", { cache: "no-store" });
        if (res.ok && alive) setBoard(await res.json());
      } catch { /* keep last good */ }
    };
    const iv = setInterval(poll, 10_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const w = board.worker;
  const ready = board.sections.ENTRY_READY;
  const approaching = board.sections.ENTRY_APPROACHING;
  const watch = [...board.sections.PRIMARY_WATCH, ...board.sections.SETUP_FORMING];
  // Freshly found small caps sit in DISCOVERED until enrichment and a structure exist.
  // They are the whole point of the strategy, and leaving them off the page made the
  // board look like it had found nothing while ten of them were being assessed.
  const assessing = board.sections.ASSESSING ?? [];

  // The featured ticket must be the best ACTIONABLE candidate, not merely the
  // highest-ranked one. A coin blocked because its move is already spent, or because
  // buying now would be a chase, does not belong in an order slip — showing one
  // invites exactly the trade the rest of the system refuses. Those stay in the list.
  // "Can I buy this" needs BOTH: nothing disqualifying, and levels to buy at.
  //
  // Checking only the blockers let an already-run coin back into the headline through
  // a different door: its plan came back invalid with "price above maximum chase" —
  // which is the already-ran signal itself — while its blocker list stayed clean. The
  // page then showed a full order slip whose own body read "Nog geen bruikbare
  // niveaus". A ticket with no levels on it is not something you can act on.
  const actionable = (v: CandidateDecisionView) =>
    !(v.entryReadyBlockers ?? []).some((g) => DISQUALIFYING.has(g)) &&
    v.plan?.valid === true;
  // Highest MEASURED potential first, real markets ahead of thin ones as the tiebreak.
  const preferReal = (a: CandidateDecisionView, b: CandidateDecisionView) =>
    (b.potential ?? 0) - (a.potential ?? 0) ||
    Number(b.activity === "REAL") - Number(a.activity === "REAL");

  // Every branch sorts on measured potential, including the fallback. Taking pool[0]
  // from a raw concatenation meant "approaching" beat "watch" on list order alone, and
  // a 3% coin sat above a 53% one at the top of the page.
  const pool = [...ready, ...approaching, ...watch].filter(inBand).sort(preferReal);
  // No actionable coin means no headline. Putting an already-run coin in the most
  // prominent slot with a full ticket is what made the page read as a list of things
  // that had already happened.
  const focus =
    ready.filter(inBand).filter(actionable).sort(preferReal)[0] ??
    [...approaching, ...watch].filter(inBand).filter(actionable).sort(preferReal)[0] ??
    null;
  const focusActionable = focus != null && actionable(focus);
  // Concatenating two already-sorted lists does not produce a sorted list. This is the
  // second time that bug appeared, so the ranked set is computed once and reused.
  // The list was 12 already-run coins to 5 usable ones, and the already-run ones held
  // the top scores — because the score measures the COIN, not the moment. A coin that
  // has made its move still has good turnover, valuation and depth. Separating the two
  // questions is the only way a list of "what can I buy" stops filling with things you
  // cannot. Already-run coins stay reachable, just not in the way.
  const rest = pool.filter((v) => v.id !== focus?.id);
  const usable = rest.filter(actionable);
  const alreadyRan = rest.filter((v) => !actionable(v));
  const state = ready.length > 0 ? "ready" : focus != null ? "close" : "wait";

  return (
    <>
      <div className="statusbar">
        <span className={`live-dot ${w.online ? "on" : "off"}`} />
        <span>{w.online ? "Live" : "Offline"}</span>
        <span className="sb-sep">·</span>
        <span>scan {w.lastCycleAt ? ago(w.lastCycleAt, now) : "—"} geleden</span>
        <span className="sb-grow" />
        <div className="mcap-filter" role="group" aria-label="Marktwaarde">
          {MCAP_BANDS.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`mcf${b.id === bandId ? " on" : ""}`}
              aria-pressed={b.id === bandId}
              onClick={() => { setBandId(b.id); window.localStorage.setItem("aureus:mcapBand", b.id); }}
            >{b.label}</button>
          ))}
        </div>
      </div>

      {/* ── the answer ── */}
      <section className={`verdict v-${state}`}>
        <div className="vd-mark" />
        <div className="vd-body">
          <h1 className="vd-head">
            {state === "ready" ? "Klaar om te kopen"
              : state === "close" ? "Bijna zover"
              : "Nu even niets"}
          </h1>
          <p className="vd-sub">
            {state === "ready"
              ? `${ready.length} coin${ready.length > 1 ? "s" : ""} met een bevestigde setup. Instellingen hieronder.`
              : state === "close"
                ? `${approaching.length} coin${approaching.length > 1 ? "s" : ""} wacht${approaching.length > 1 ? "en" : ""} op de laatste bevestiging.`
                : alreadyRan.length > 0
                  ? `Alle ${alreadyRan.length} coins op de lijst hebben hun beweging al gemaakt. Wachten op een nieuwe.`
                  : assessing.length > 0
                    ? `${assessing.length} nieuwe coin${assessing.length > 1 ? "s worden" : " wordt"} nu beoordeeld.`
                    : "Geen setup die het wachten waard is. Dat is het normale antwoord."}
          </p>
        </div>
      </section>

      {/* ── the ticket ── */}
      {focus && state !== "wait" ? (
        <section className="focus">
          <div className="focus-lbl">
            {state === "ready" && focusActionable ? "Order"
              : focusActionable ? "Voorbereid — nog niet kopen"
              : "Dichtstbijzijnde — geen order"}
          </div>
          <TradeTicket v={focus} live={state === "ready" && focusActionable} />
          {state !== "ready" || !focusActionable ? (
            <div className={`focus-need${focusActionable ? "" : " blocked"}`}>
              <span className="fn-k">{focusActionable ? "Wacht op" : "Niet kopen"}</span>
              {waitingOn(focus)}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Everything below the ticket is a list of coins and ONE reason each. The
          assessing block used to print eight dead small caps in full; they are a count
          now, because "which coins can I buy" is never answered by a dead coin. */}
      {usable.length > 0 ? (
        <section className="rest">
          <h2 className="rest-h">Nog bruikbaar</h2>
          <div className="rest-rows">{usable.map((v) => <Row key={v.id} v={v} ok />)}</div>
        </section>
      ) : focus != null ? null : (
        // Only claim "nothing usable" when the headline is empty too. With a full
        // order slip on screen directly above it, that sentence contradicted the page
        // itself — the focus coin IS usable, it is simply not repeated in the list.
        <section className="rest">
          <h2 className="rest-h">Nog bruikbaar</h2>
          <div className="none-usable">
            Op dit moment geen enkele coin waar het instapmoment nog open staat.
          </div>
        </section>
      )}

      {alreadyRan.length > 0 ? (
        <details className="ran">
          <summary>
            {alreadyRan.length} coin{alreadyRan.length > 1 ? "s" : ""} die de beweging al gemaakt {alreadyRan.length > 1 ? "hebben" : "heeft"}
          </summary>
          <div className="rest-rows">{alreadyRan.map((v) => <Row key={v.id} v={v} ok={false} />)}</div>
        </details>
      ) : null}

      <div className="footnote">
        Alleen coins die nu verhandelbaar zijn: 1–48 uur oud, onder 150k market cap,
        voldoende diepte, echte handel. Boven 150k is de haalbare winst te klein
        voor het risico, dus die worden niet eens gevolgd.
        {assessing.length > 0 ? ` ${assessing.length} nieuwe worden nog gecontroleerd.` : ""}
        {board.counts.ripening > 0
          ? ` ${board.counts.ripening} net gevonden coin${board.counts.ripening > 1 ? "s zijn" : " is"} nog geen uur oud — die worden nu gevolgd en zijn straks te beoordelen.` : ""}
        {board.counts.outsideUniverse - board.counts.ripening > 0
          ? ` ${board.counts.outsideUniverse - board.counts.ripening} vallen buiten die grenzen.` : ""}
        {" "}
        <Link href="/action-board">Volledig overzicht →</Link>
      </div>
    </>
  );
}
