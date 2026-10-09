# PRODUCT_REQUIREMENTS.md — Aureus Intelligence

Version: 0.1 (foundations, pre-implementation review)
Status: **draft for review.** No UI is built until this and ARCHITECTURE.md are
approved.

Aureus Intelligence is a **private, read-only, institutional-grade Solana
early-coin intelligence platform**. It ingests market, on-chain, wallet,
deployer, liquidity, and social/attention data and converts it into a small
number of **transparent, evidence-backed decision states**. It is not a Dex
Screener clone, not a memecoin casino dashboard, and it never emits an ungrounded
"BUY".

---

## 1. Product purpose

Turn the noise of early Solana launches into a disciplined research pipeline that
answers **four independent questions**, in order, and refuses to conflate them:

1. **Safety** — Is this token structurally safe enough to *investigate*?
2. **Demand** — Is genuine, independent demand developing?
3. **Capital** — Is liquidity/capital being *retained*?
4. **Entry** — Is the *current price* a favourable, clearly invalidatable entry?

The cardinal rule: **a structurally strong token at a bad price is never
`ENTRY_READY`.** Quality and timing are separated by construction.

The platform's value is not prediction; it is **grounded triage + explainability
+ honest outcome accounting**. Every state is defended by evidence with a source
and a timestamp, and every candidate — including rejected ones — is tracked to
outcome so the rules can be measured, not believed.

## 2. Target user

A single sophisticated operator (initially the owner): technically literate,
risk-aware, treats early Solana tokens as high-variance research bets, and wants
a calm instrument that enforces discipline rather than amplifying FOMO. Not a
retail "next 100x" audience. The product is private (single-tenant) and
read-only; it never holds funds or places trades.

## 3. Core jobs-to-be-done

- **JTBD-1 — Triage safely.** "Given a flood of new pools, tell me which few are
  even worth my attention, and prove why the rest were rejected."
- **JTBD-2 — Distinguish real from manufactured demand.** "Show me whether buyers
  are independent humans or the deployer's own wallets / a bundle / sybils."
- **JTBD-3 — Watch capital, not hype.** "Tell me if liquidity and holders are
  being retained or quietly drained."
- **JTBD-4 — Time an invalidatable entry.** "If (and only if) the token is
  confirmed, tell me a specific price level, the invalidation, and the
  reward-to-risk — or tell me to wait."
- **JTBD-5 — Hold myself accountable.** "Track every call I could have made,
  including the ones I rejected, and show me where the rules were right or wrong."
- **JTBD-6 — Trust the data.** "Always show me how fresh each number is and where
  it came from; flag stale, missing, mocked, and conflicting data loudly."

## 4. Decision states (canonical)

State lives on the **candidate** (a `(chain, mint, pool, candidate_id,
discovered_at)` identity), and its history is append-only.

| State | Meaning | Primary driver |
|---|---|---|
| `REJECTED` | A hard safety gate failed, or a fatal data condition. Terminal-ish (can be revisited only via explicit re-open). | Safety = FAILED |
| `RESEARCHING` | Newly discovered; engines running; not enough evidence yet. | default post-discovery |
| `STRUCTURE_WATCH` | Passed initial safety; structure/holders being observed; quality not yet confirmed. | Safety = PASSED, Quality < CONFIRMED |
| `QUALITY_CONFIRMED` | Demand + Capital + Attention confirmations met; token is a legitimate research subject — **independent of price**. | Quality = CONFIRMED |
| `ENTRY_WATCH` | Quality confirmed; Entry Engine is watching for a specific level. | Entry = WAIT_FOR_LEVEL |
| `ENTRY_READY` | **All four gates green simultaneously and fresh.** A specific, invalidatable level is live. | see §7 conjunction |
| `OVEREXTENDED` | Quality confirmed but price is stretched; no favourable entry now. | Entry = OVEREXTENDED |
| `POSITION_RISK` | A tracked (simulated or user-flagged) position is now threatened (LP drain, smart-wallet exit, structure break). | risk event on held candidate |
| `EXPIRED` | Discovery/entry window elapsed without qualification; archived. | timers |
| `UNRESOLVED` | Blocked by critical missing/conflicting data that we cannot currently obtain. | data-quality hard-hold |

**Identity rule (binding):** never key, title, or dedupe a candidate by token
name or ticker. Identity = chain + mint address + pool address + candidate ID +
discovery timestamp. Names/tickers are display labels carrying their own
`source`/`observed_at`.

**State authority rule:** state transitions are produced **only** by the
deterministic decision engine from engine outputs + freshness + data-quality.
The AI explanation layer may describe a state; it may never set or change one.

## 5. Complete user journey

1. **Discovery.** Ingestion detects a new Solana pool/mint (Dex Screener profiles
   poll; Helius pool-creation events). An **address-first candidate record** is
   created with an **immutable discovery snapshot** and `candidate_id`.
2. **Safety pass.** The Safety Engine runs its hard gates. Any critical failure →
   `REJECTED` with a full evidence trail (still tracked for outcomes). Missing
   critical data → `UNRESOLVED` (not rejected — we distinguish "bad" from
   "unknown").
3. **Structure watch.** Survivors become `STRUCTURE_WATCH`. Observations
   accumulate: holder snapshots, LP, transaction aggregates, deployer/funding
   graph, attention.
4. **Quality confirmation.** The Quality Engine evaluates Independent Demand,
   Capital Retention, Attention Development. When all reach CONFIRMED →
   `QUALITY_CONFIRMED`.
5. **Entry evaluation.** Only now does the Entry Engine matter. It produces
   `TOO_EARLY` / `WAIT_FOR_LEVEL` (→ `ENTRY_WATCH`) / `READY` (→ `ENTRY_READY`) /
   `OVEREXTENDED` (→ `OVEREXTENDED`) / `INVALIDATED` / `EXPIRED`.
6. **Alerting.** State-change and risk events raise in-app alerts (§7 Deliverable
   10 objects), each with candidate link, action, reasons, freshness, expiry.
7. **Position risk.** If the user marks a simulated/real position, `POSITION_RISK`
   monitoring watches for LP drain, smart-wallet exit, deployer activity,
   structure break.
8. **Outcome.** Every candidate (including `REJECTED`) is tracked on fixed
   horizons; outcomes feed the validation reports.

The user's day starts on **Today** (≤5 priority cards), drills into **Candidate
Detail** (Safety / Demand / Capital / Entry blocks), and reviews **Outcomes** and
**Data Quality** to keep the system honest.

## 6. Data freshness rules

Freshness is a **first-class gate**, not decoration. Each data class has a
Time-To-Live; past TTL the datum is `STALE` and cannot satisfy a green gate.

| Data class | Fresh TTL (starting values, tunable) | On expiry |
|---|---|---|
| Price / market cap | 60 s (active candidate), 5 min (watch) | mark STALE; Entry cannot be READY |
| Liquidity / LP state | 2 min | STALE; Capital gate degrades |
| Transaction aggregates | 2 min | STALE |
| Holder snapshot | 15 min | STALE; concentration checks degrade |
| Deployer/funding graph | 6 h (mostly static post-launch) | recompute |
| Social / FOMO | 30 min | STALE (attention decays) |
| OHLCV (structure) | 1 candle interval | refetch before Entry eval |

Rules:
- **`ENTRY_READY` requires every *required* input within its TTL.** One stale
  required input blocks READY (state falls back to `ENTRY_WATCH` with reason
  `STALE_DATA`).
- Freshness is shown on every card and every evidence block ("as of 14s ago").
- Staleness is a visible amber state, never silently hidden.

## 7. Notification logic

Alerts are **state-machine outputs**, not model whims. An alert is raised only on
a genuine transition or a defined risk event, is deduplicated per candidate+type,
and carries an **expiry**. Alert object types (Deliverable 10):

`INTELLIGENCE_UPDATE`, `ENTRY_WATCH`, `ENTRY_READY`, `ENTRY_INVALIDATED`,
`OVEREXTENDED`, `LIQUIDITY_RISK`, `SMART_WALLET_EXIT`, `DEPLOYER_ACTIVITY`,
`DATA_STALE`.

Every alert contains: `candidate_id`, token label, mint, action, reasons[],
alert timestamp, data freshness summary, expiry, and a direct candidate link.
Delivery is **in-app first**; Telegram / email / push are **adapters left
un-wired** behind a common `NotificationChannel` interface. `ENTRY_READY` fires
**only** under the full conjunction in §7.1.

### 7.1 `ENTRY_READY` conjunction (binding)
`ENTRY_READY` ⇔ **all** of:
- Safety = `PASSED` (no critical or high open finding);
- Quality = `CONFIRMED` (all three sub-confirmations);
- Entry = `READY`;
- all required inputs within freshness TTL;
- **no open critical `data_quality_issue`** on this candidate.
If any clause drops, the state leaves `ENTRY_READY` immediately with a reasoned
transition. Positive signals **cannot** compensate for a failed clause.

## 8. Evidence & explainability requirements

- Every engine output is a **finding** with: `rule_id`, human explanation,
  `evidence` (the actual numbers/addresses), `source`, `observed_at`, `severity`,
  and **"what would change this outcome"** (the invalidation/confirmation
  condition).
- The **AI explanation layer** may only *summarise findings that already exist*.
  It is fed the structured findings and is contractually forbidden from
  introducing data, numbers, addresses, or a state not present in the findings.
  Its output is labelled as narrative and is never an input to any gate. (See
  ARCHITECTURE §AI-boundary.)
- **Banned vocabulary until statistically validated** (inherited from the
  gold-swing-engine discipline): `probability`, `confidence %`, `A+`, "high
  conviction", or any quality-band label may not appear in code, UI, alerts, or
  reports until an out-of-sample calibration (§12) supports it. The UI shows raw
  numbers and gate states, not manufactured certainty.
- **No profit guarantees. No probability percentages** on outcomes without a
  statistically validated model behind them.

## 9. MVP scope (what v0 must actually do)

In:
- Address-first ingestion from **Dex Screener (polled)** + **Helius (key
  required)**; **GeckoTerminal** for on-demand OHLCV/verification.
- Immutable discovery snapshots; append-only observations; raw JSON event store.
- **Deterministic Safety, Quality, Entry engines** with full finding output.
- **Decision-state history** + in-app **alerts**.
- **Outcome tracking** started at discovery (1h/6h/24h/72h/7d/30d + MFE/MAE).
- **Web UI** (built only after this doc is approved): Today, Discover, Candidate
  Detail, Entry Watch, Entry Ready, Wallet Intelligence, Deployer/Funding
  Intelligence, Watchlists, Position Risk, Outcomes, Data Quality, Sources/Health,
  Settings.
- Explicit **mock/stale/missing/real** labelling everywhere.
- Bubblemaps **iframe** evidence link; FOMO **manual import** only.
- Tests, setup instructions, `.env.example`, no committed secrets.

Out (explicitly excluded from MVP):
- **Any automated trading, order routing, or fund custody.** Permanently out of
  scope for this product.
- Multi-tenant accounts, billing, public access.
- Bubblemaps data API, FOMO scraping (both gated on permission/keys).
- A statistical probability/scoring model as a *gate* (score is diagnostic only
  until validated).
- Mobile native apps (PWA responsive is enough).
- Telegram/email/push *delivery* (interfaces only).

## 10. Privacy / security requirements

- Single-tenant, private. No third-party analytics/trackers.
- Secrets only in `.env.local` (gitignored); `.env.example` documents keys with
  no values. No secret ever committed or logged.
- Read-only wallet handling: the platform stores **public addresses** only. It
  never asks for, stores, or transmits private keys, seed phrases, or exchange
  credentials. There is no field that could hold one.
- No personal financial credentials are entered anywhere in the product.
- All external calls are server-side; API keys never reach the browser.
- Raw event store may contain third-party data; retention/pruning policy defined
  in ARCHITECTURE.

## 11. Outcome-validation methodology

Adapted from `gold-swing-engine/GATE_FUNNEL_SPEC.md` (the same discipline):
- **Track every candidate, including rejected ones**, from the exact discovery
  and alert timestamps. This is what lets us measure **rejected winners** (false
  negatives) and **accepted failures** (false positives).
- Per candidate record forward returns at 1h/6h/24h/72h/7d/30d, **MFE/MAE**, time
  to peak, liquidity-drain, rug/failure label, holder development, max decision
  stage reached, simulated-entry outcome + slippage.
- **Anti-look-ahead:** forward-window metrics (MFE/MAE, returns) exist **only** in
  the offline outcome/report layer, are never inputs to any live gate/score/alert,
  and are never reported on candidates whose forward window is incomplete
  (partial windows are excluded, not partially counted).
- **Anti-survivorship:** rejected and expired candidates are retained and counted;
  reports must compare against the full discovered population, not just survivors.
- **No-conclusion rules:** no precision/recall/expectancy claim on a rule or state
  with < a documented minimum sample; effects that vanish when the best/worst 3
  cases are dropped are labelled fragile, not real.
- **Banned terms** (as §8) until out-of-sample calibration (≥ documented sample,
  monotone across walk-forward folds) explicitly supports them.

Report set (Deliverable 8): rule precision; rule recall where measurable; rejected
winners; accepted failures; expectancy per state; performance by
market-cap/liquidity cohort, by narrative, by data source, by entry pattern.

## 12. Known legal / compliance questions (must be resolved by owner)

1. **FOMO** — terms of use for import/automation; no automation until answered.
2. **Bubblemaps** — licence terms for iframe embedding and for the data API.
3. **Dex Screener / GeckoTerminal / Helius** — commercial-use terms and
   attribution requirements at our call volumes.
4. **Financial-advice framing** — the product must present as *research
   tooling*, not investment advice; no personalised advice, no guarantees. UI
   copy reviewed against this.
5. **Data retention** — how long raw third-party event JSON is retained.
6. **Jurisdiction** — the owner's local rules on operating token-analysis tooling.

These are tracked in `docs/KNOWN_LIMITATIONS.md` at validation time and are **open
questions**, not answered here.
