# RULE_CATALOG.md — Aureus Intelligence

Rule engine `re-0.1.0`. Source of truth: `packages/rule-engine/`. **No general
confidence score exists.** Each rule is deterministic and yields exactly one of
`PASS / FAIL / INCOMPLETE / NOT_APPLICABLE`, with `rule_id, rule_version, family,
required_features, threshold/config, severity, evidence, evaluated_at, expiry,
explanation, invalidation`.

**Hard-fail dominance (binding):** any `SAFETY` rule returning `FAIL` makes the
family `FAILED`; **no positive rule in any family can compensate it.** Missing
data yields `INCOMPLETE`, never a guessed `PASS`.

18 rules across 5 families (deliberately small — no rule-bloat).

## SAFETY (6) — hard gates
| rule_id | severity | result logic |
|---|---|---|
| `SAFE-01-CRITICAL-DATA` | CRITICAL | any of insider/holder/bundle/funding features not OK → **INCOMPLETE** (Safety can't PASS) |
| `SAFE-02-BLACKLIST-FUNDING` | CRITICAL | blacklist match, or `deployer_funding_risk ≥ 0.8` → **FAIL**; unknown → INCOMPLETE |
| `SAFE-03-INSIDER-CONCENTRATION` | HIGH | `insider_concentration > 0.35` → **FAIL** |
| `SAFE-04-BUNDLE-CONTAMINATION` | HIGH | `bundle_contamination > 0.30` → **FAIL** |
| `SAFE-05-LIQUIDITY-DRAIN` | CRITICAL | `liquidity_retention_1h < 0.5` or `lp_change_rate < −0.5/h` → **FAIL** |
| `SAFE-06-AUTHORITY-SELLABILITY` | CRITICAL | non-sellable, or active mint/freeze authority → **FAIL**; unknown → INCOMPLETE |

## QUALITY (4)
| rule_id | severity | result logic |
|---|---|---|
| `QUAL-01-INDEPENDENT-DEMAND` | MEDIUM | `unique_buyer_growth ≥ 1.1` and `buyer_seller_ratio ≥ 1` → PASS |
| `QUAL-02-CAPITAL-RETENTION` | MEDIUM | `retention_1h ≥ 0.8` and `retention_6h ≥ 0.6` → PASS |
| `QUAL-03-SMART-PARTICIPATION` | LOW | diversity ≥ 0.1, ≥1 smart wallet, hold ≥ 0.6, funder-risk < 0.8 → PASS |
| `QUAL-04-BOOST-DEPENDENCY` | MEDIUM | `boost_dependency > 0.6` → **FAIL** (paid-attention correction); no social → NOT_APPLICABLE |

Quality status: **CONFIRMED** iff QUAL-01..03 all PASS and QUAL-04 ≠ FAIL;
**WEAK** if none pass; else **DEVELOPING**.

## ENTRY (4) — separate from quality
| rule_id | severity | result logic |
|---|---|---|
| `ENTRY-01-STRUCTURE-RECLAIM` | INFO | range present + reclaim/retest confirmed → PASS |
| `ENTRY-02-NOT-OVEREXTENDED` | INFO | `price_distance_from_range > 0.9` → **FAIL (overextended)** |
| `ENTRY-03-INVALIDATION` | INFO | a local invalidation level exists → PASS |
| `ENTRY-04-EXECUTION` | INFO | slippage ≤ 3% and reward-to-risk ≥ 2.0 → PASS |

Entry status: `OVEREXTENDED` if ENTRY-02 FAIL; `READY` if all four PASS;
`WAIT_FOR_LEVEL` if structure present but not all pass; else `TOO_EARLY`.

## POSITION_RISK (2) — only with an open position (else NOT_APPLICABLE)
| rule_id | severity | result logic |
|---|---|---|
| `PRISK-01-LP-DRAIN` | HIGH | `liquidity_retention_15m < 0.7` or `lp_change_rate < −0.5/h` → FAIL |
| `PRISK-02-SMART-EXIT` | HIGH | `smart_wallet_net_flow < 0` → FAIL |

## DATA_QUALITY (2)
| rule_id | severity | result logic |
|---|---|---|
| `DQ-01-FRESHNESS` | HIGH | `data_freshness < 0.5` → FAIL (blocks ENTRY_READY) |
| `DQ-02-SOURCE-CONFLICT` | HIGH | `source_agreement < 0.8` → FAIL; single source → NOT_APPLICABLE |

## Config & versioning
Thresholds live in one frozen `RuleConfig` (`DEFAULT_RULE_CONFIG`), hashed into a
`param_hash` (FNV-1a) stored on every evaluation, so results from different
thresholds are never mixed. No `probability` / `confidence` / `A+` labels are
emitted anywhere (banned until prospective validation).
