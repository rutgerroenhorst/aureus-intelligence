# FEATURE_CATALOG.md — Aureus Intelligence

Feature engine `fe-0.1.0` (feature schema version `0.1.0`). Source of truth:
`packages/feature-engine/`. Every feature is a **pure function of its input** —
identical input + identical engine version ⇒ identical output. A feature returns
a value **only** when its inputs are present and fresh; otherwise it is
`MISSING` (no data), `UNAVAILABLE` (the source that would provide it is not
configured — e.g. no Helius), or `STALE` (real but past its TTL). Values are never
fabricated.

Every `FeatureValue` carries: `featureId, version, status, value, unit,
calculatedAt, observationWindow, sourceInputs, dataQuality, missingReason,
explanation`.

| # | feature_id | unit | window | needs on-chain? | meaning |
|---|---|---|---|---|---|
| 1 | `liquidity_retention_15m` | ratio | 15m | no | liquidity now ÷ ~15m ago |
| 2 | `liquidity_retention_1h` | ratio | 1h | no | liquidity now ÷ ~1h ago |
| 3 | `liquidity_retention_6h` | ratio | 6h | no | liquidity now ÷ ~6h ago |
| 4 | `marketcap_liquidity_ratio` | ratio | instant | no | market cap ÷ pool liquidity (froth) |
| 5 | `unique_buyer_growth` | ratio | consec. windows | no | buyers this window ÷ previous |
| 6 | `unique_seller_growth` | ratio | consec. windows | no | sellers this window ÷ previous |
| 7 | `buyer_seller_ratio` | ratio | latest window | no | buyers ÷ sellers |
| 8 | `buyer_concentration` | fraction | latest window | **yes** | share of buy volume from top buyers |
| 9 | `wallet_group_diversity` | ratio | instant | **yes** | independent holder groups ÷ holders |
| 10 | `deployer_funding_risk` | score01 | instant | **yes** | deployer+funding reputation risk |
| 11 | `insider_concentration` | fraction | instant | **yes** | supply held by insider-linked wallets |
| 12 | `holder_concentration` | fraction | instant | **yes** | supply held by top-10 holders |
| 13 | `bundle_contamination` | fraction | instant | **yes** | supply bought in a launch bundle |
| 14 | `smart_wallet_count` | count | instant | **yes** | reputable wallets participating |
| 15 | `smart_wallet_net_flow` | usd | 1h | **yes** | net USD flow of smart wallets |
| 16 | `smart_wallet_hold_ratio` | fraction | instant | **yes** | share of smart wallets still holding |
| 17 | `lp_change_rate` | per_hour | 1h | no | fractional liquidity change / hour |
| 18 | `price_drawdown_from_local_high` | fraction | 6h | no | drawdown from local high |
| 19 | `price_distance_from_range` | fraction | 6h | no | position in recent range (0 low, 1 high) |
| 20 | `attention_velocity` | per_hour | social | no | rate of change of organic attention |
| 21 | `boost_dependency` | fraction | social | no | share of attention that is paid boost |
| 22 | `source_agreement` | fraction | instant | no | cross-source agreement on liquidity (needs ≥2 sources) |
| 23 | `data_completeness` | fraction | instant | no | fraction of expected input classes present |
| 24 | `data_freshness` | score01 | instant | no | worst-class freshness (1 fresh … 0 stale) |

## Status semantics (binding)
- **OK / PARTIAL** — value present.
- **MISSING** — required observations absent (e.g. no baseline point for retention;
  single source for `source_agreement`).
- **UNAVAILABLE** — the enabling source is not configured; specifically, features
  8–16 are `UNAVAILABLE` whenever Helius is not LIVE. They are **never guessed**.
- **STALE** — the latest observation is past its class TTL (PRD §6).

## Live behaviour (verified)
On a real Dex Screener Solana candidate with no Helius key, features 4, 7, 23, 24
compute; retention/growth are `MISSING` (single snapshot); all on-chain features
are `UNAVAILABLE`. This is the intended, non-fabricated result.
