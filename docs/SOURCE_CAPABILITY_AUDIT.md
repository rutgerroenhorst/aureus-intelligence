# SOURCE_CAPABILITY_AUDIT.md — Aureus Intelligence

Status: **binding pre-implementation audit.** No ingestion adapter may claim a
capability that is not recorded as *verified* here. Where a capability the
product prompt assumed does **not** exist, that is stated explicitly and the
design is adjusted rather than faked.

Audit date: 2026-07-22. Verified rows were checked against live public
documentation on this date. Rows marked *(from prior knowledge, re-verify at
build time)* were not re-fetched and MUST be confirmed by the ingestion adapter's
integration test before that adapter is trusted.

Legend for **Evidence status** (this maps 1:1 to the `evidence_status` column in
the schema): `VERIFIED` (checked live this date), `ASSUMED` (from prior
knowledge, unconfirmed), `MISSING` (does not exist), `GATED` (exists but needs
credentials/permission we do not yet have).

---

## 0. Executive corrections to the product brief

The brief made four assumptions that this audit contradicts. These corrections
are load-bearing for the architecture:

1. **"Dex Screener realtime streams / WebSocket."** — **MISSING.** Dex Screener
   publishes a REST API only; no WebSocket or SSE stream is documented. All
   "realtime" behaviour against Dex Screener is **polling**. The architecture
   uses a polling scheduler with per-endpoint rate budgets, not a socket
   subscription. Do not build a `DexScreenerWebSocketClient`.

2. **"GeckoTerminal as a new-pools firehose."** — **RATE-CONSTRAINED.** The free
   public tier is **10 calls/minute**. That is far too low to be the primary
   discovery poller. GeckoTerminal is therefore demoted to a **secondary
   verification + OHLCV** source, called on-demand for specific pools, not swept
   continuously.

3. **"Bubblemaps API for cluster data."** — **GATED.** A programmatic
   cluster/decentralisation API exists commercially but requires a paid key we do
   not hold. Free usage is the **iframe embed** only, which returns a picture, not
   parseable cluster membership. Therefore cluster *analysis* is produced from
   **our own Helius holder-graph computation**, and Bubblemaps is an **iframe
   evidence link** + an adapter interface stub. We never parse the iframe or
   fabricate cluster membership.

4. **"FOMO scraping."** — **PROHIBITED until permission.** No public documented
   API. Adapter is **interface-only** with **manual URL/post import** and exact
   mint resolution. No automated scraping is implemented.

The net effect: **Helius (on-chain) is the analytical backbone.** Dex Screener is
the market-data breadth layer (polled). GeckoTerminal is targeted verification.
Bubblemaps and FOMO are evidence-link/manual-import adapters only.

---

## A. Dex Screener

- **Base URL:** `https://api.dexscreener.com`
- **Auth:** none (public).
- **Transport:** REST only. **No WebSocket / SSE** — *VERIFIED MISSING* on
  2026-07-22 (no streaming endpoint in the reference).
- **Cost:** free.

### Verified endpoints (2026-07-22)

| Endpoint | Method | Purpose | Rate limit (documented) |
|---|---|---|---|
| `/latest/dex/pairs/{chainId}/{pairId}` | GET | Single pair snapshot | 300 req/min *(ASSUMED — reference showed "not specified"; treat as 300 and back off on 429)* |
| `/latest/dex/search?q=` | GET | Search pairs | 300 req/min *(ASSUMED)* |
| `/token-pairs/v1/{chainId}/{tokenAddress}` | GET | All pools for a mint | 300 req/min *(ASSUMED)* |
| `/tokens/v1/{chainId}/{tokenAddresses}` | GET | Batch token/pair data (comma-sep, ≤30) | 300 req/min *(ASSUMED)* |
| `/token-profiles/latest/v1` | GET | Newest token profiles (discovery) | **60 req/min (VERIFIED)** |
| `/token-profiles/recent-updates/v1` | GET | Recently changed profiles | **60 req/min (VERIFIED)** |
| `/token-boosts/latest/v1` | GET | Newest boosts (paid promo signal) | *(ASSUMED 60)* |
| `/token-boosts/top/v1` | GET | Top boosted tokens | *(ASSUMED 60)* |
| `/orders/v1/{chainId}/{tokenAddress}` | GET | Paid orders (profile/boost/ads) for a token | *(ASSUMED 60)* |
| `/community-takeovers/latest/v1` | GET | Community-takeover events | **60 req/min (VERIFIED)** |
| `/ads/latest/v1` | GET | Latest ads | **60 req/min (VERIFIED)** |
| `/metas/trending/v1` | GET | Trending metas (narrative signal) | **60 req/min (VERIFIED)** |

### Data quality notes
- Prices, liquidity, txns, volume are **derived aggregates**, not raw chain
  truth. Store them tagged `source='dexscreener'` and never treat as settlement.
- Fields include an update timestamp; capture it as `observed_at` (source clock),
  distinct from our `ingested_at`.
- `chainId` for Solana is `solana`.
- **Boosts / paid orders are the "paid promotion" correction signal** required by
  the Quality Engine's Attention module — a boosted token's attention must be
  discounted, not rewarded.

### Implication
- Discovery poll: `/token-profiles/latest/v1` + `/token-boosts/latest/v1` on a
  60 rpm budget (one call every ≥1s, we run ~1 call / 3–5s).
- Per-candidate refresh: `/tokens/v1/solana/{mint}` and
  `/token-pairs/v1/solana/{mint}`.

---

## B. GeckoTerminal

- **Base URL:** `https://api.geckoterminal.com/api/v2`
- **Auth:** none for public tier.
- **Required header:** `Accept: application/json;version=20230302` *(ASSUMED — current
  versioned header; adapter test must confirm the live version string).*
- **Rate limit:** **10 calls/min free (VERIFIED 2026-07-22)**; 250/min on paid.
- **Transport:** REST only.

### Endpoints (network id for Solana = `solana`) — *ASSUMED, confirm at build*
| Endpoint | Purpose |
|---|---|
| `/networks/solana/new_pools` | Newly created pools |
| `/networks/solana/pools/{pool}` | Pool detail incl. reserve_in_usd |
| `/networks/solana/pools/{pool}/ohlcv/{timeframe}` | OHLCV (minute/hour/day) |
| `/networks/solana/pools/{pool}/trades` | Recent trades |
| `/networks/{network}/tokens/{address}` | Token info |

### Implication
Because of the 10 rpm ceiling, GeckoTerminal is **not** a sweep source. It is
called: (a) to confirm a pool's creation time / reserves as a *second source*
against Dex Screener; (b) to pull OHLCV for the Entry Engine's structure
detection when a candidate has already passed Safety. A token-bucket limiter with
a hard 10 rpm cap and request coalescing is mandatory.

---

## C. Solana RPC + Helius

- **Solana JSON-RPC:** standard methods (`getSignaturesForAddress`,
  `getTransaction`, `getAccountInfo`, `getTokenLargestAccounts`,
  `getTokenSupply`, `getProgramAccounts`, `getSlot`, `getBlockTime`). Public RPC
  is heavily rate-limited and unreliable for production; a provider is required.
- **Helius:** **GATED — requires API key** (user must supply). Provides:
  - Enhanced/parsed transactions API (human-readable swap/transfer events);
  - Webhooks (push on address activity — deployer/funding/LP/large-holder
    monitoring);
  - DAS (Digital Asset Standard) for token metadata & holders;
  - standard RPC over their endpoint.
- **Rate/credits:** plan-dependent (free dev tier has a monthly credit cap and a
  per-second ceiling). *ASSUMED — the adapter must read the actual plan limits
  from the dashboard and record them in `source_health`; do not hardcode.*

### What Helius gives us that nothing else does
- **Deployer identity & funding chain:** trace the mint's creator and who funded
  that creator (backward transfer graph).
- **LP events:** add/remove liquidity, authority changes.
- **Holder graph:** current large holders → the basis for our *own* cluster and
  bundle detection (replacing the gated Bubblemaps API).
- **Mint/freeze authority & sellability:** read authorities from mint account;
  simulate/inspect for transfer-tax / freeze traps.

### Implication
Helius is the **analytical backbone**. Webhooks push events into the ingestion
queue; the transaction API backfills history for a newly discovered mint. All
on-chain findings carry `block`/`slot` references as `raw_source_ref`.

---

## D. Bubblemaps

- **Free:** **iframe embed** — `https://app.bubblemaps.io/sol/token/{mint}` (or the
  current embed path) rendered in an `<iframe>`. Returns a *visual*, not data.
- **API:** **GATED** — a commercial "iframe API" / decentralisation-score API
  exists but needs a paid key we do not hold.
- **Decision:** implement `BubblemapsAdapter` as an **interface** with two modes:
  `iframe` (default — produce an embeddable evidence URL only) and `api`
  (stubbed, throws `NotConfiguredError` until a key + verified endpoint exist).
  **We never scrape the iframe and never synthesize cluster membership.** Cluster
  analysis used by the engines comes from our Helius-derived holder graph, tagged
  `source='aureus_cluster'`, clearly distinct from `source='bubblemaps'`.

---

## E. FOMO

- **Public API:** **MISSING / undocumented.**
- **Terms:** automated scraping not permitted without explicit permission.
- **Decision:** `FomoAdapter` is **interface-only** with a **manual import** path:
  the user pastes a FOMO post URL or content; the adapter requires the post to
  resolve to an **exact mint address** before it is stored as a
  `social_observation` with `source='fomo'`, `evidence_status='MANUAL'`. No
  crawler, no automation, until permission/terms are established and recorded
  here.

---

## F. Cross-source rules (binding)

1. **Address-first identity.** A record is keyed by `(chain, mint)` and, for
   market data, `(chain, pool)`. Token name/ticker is a *label*, never identity.
   Two sources disagreeing on a name is not a conflict; two sources disagreeing on
   liquidity for the same pool **is** a `data_quality_issue`.
2. **Every observation stores** `source`, `observed_at` (source clock),
   `ingested_at` (our clock), `evidence_status`, `data_quality_confidence`, and
   `raw_source_ref` (URL/slot/tx). The original discovery snapshot is **immutable**.
3. **No fabrication.** If a source is down or a field is absent, the field is
   `NULL` with a recorded `data_quality_issue`; it is never inferred to a
   plausible value.
4. **Rate limits are enforced centrally** (token-bucket per source) and the
   *observed* limit (including any 429s) is written to `source_health`. Hardcoded
   limits above are starting budgets, not truth.

---

## G. Open verification tasks (carried into build)

- [ ] Confirm Dex Screener per-endpoint 429 thresholds empirically (docs
  under-specify the `/latest/dex/*` and `/tokens/v1` limits).
- [ ] Confirm GeckoTerminal versioned `Accept` header string against live API.
- [ ] Record actual Helius plan limits from the user's dashboard into
  `source_health` seed.
- [ ] Establish whether the user has (or will buy) a Bubblemaps data key; until
  then `api` mode stays stubbed.
- [ ] Obtain FOMO terms / permission in writing before any automation.
