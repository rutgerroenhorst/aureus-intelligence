# Coin outcome study — 438 live Solana pairs

Collected from the public Dex Screener API (`research/collect.mjs`), analysed by
`research/analyze.mjs` + `research/combos.mjs`. Every threshold the system uses for
market quality traces back to this table instead of to an opinion.

## Sample
438 live Solana pairs (421 usable), gathered from 38 diverse search terms plus the
latest token-profile and boost feeds. Outcome classified from the 24h state.

| outcome | n | med liq | med vol24 | med tx24 | med buy-share | med age (h) | med FDV |
|---|---|---|---|---|---|---|---|
| RAN_HARD (+100%) | 18 | $39,038 | $676,487 | 18,767 | 0.629 | 10.8 | $249k |
| RAN (+25%) | 5 | $19,876 | $194,017 | 1,616 | 0.528 | 23.1 | $345k |
| FLAT | 129 | $52,402 | $3,386 | 58 | 0.500 | 5,734 | $2.6M |
| DUMPED (−25%) | 13 | $7,080 | $181,792 | 2,961 | 0.468 | 29.0 | $79k |
| COLLAPSED (−70%) | 19 | $2,846 | $135,274 | 3,342 | 0.528 | 4.2 | $2.3k |
| **DEAD** | **237** | $3,832 | **$10** | **4** | 0.498 | 1,568 | $8.6k |

**The dominant fact: 54% of the universe is already dead** — median 24h volume of $10
and 4 transactions. Base rate of "ran" is **5.5%**.

## Gates measured

| gate | kept | precision | recall | bad leak |
|---|---|---|---|---|
| accept everything (baseline) | 421 | 5% | 100% | 100% |
| vol24 ≥ $250k | 38 | 39% | 65% | 4% |
| + liq ≥ $30k | 22 | 41% | 39% | 0% |
| + h6 > 0 | 16 | 44% | 30% | 0% |
| **+ fdv/liq ≤ 20** | **7** | **100%** | **30%** | **0%** |
| EXCLUDE (vol24<$1k or liq<$5k) | 107 | 21% | **96%** | 3% |

## What is causally meaningful vs contaminated

**Contaminated (don't treat as prediction):** `vol24` and `tx24` are partly *produced by*
the move that defines the outcome — "high volume predicts having run" is close to
tautological. They are used as **tradability** requirements (can an order clear, can I
exit), not as forecasts.

**Genuinely structural:**
- **fdv/liquidity ≤ 20** — adding this one ratio moved precision 44% → 100% while
  keeping recall. A token valued at >20× the pool that must absorb the exit is paper.
- **h24 up but h6/m5 rolling over = spent move.** The shape table is unambiguous:

| outcome | h6 still up | m5 up |
|---|---|---|
| RAN_HARD | 61% | 44% |
| RAN | 80% | 100% |
| DUMPED | 23% | 15% |
| COLLAPSED | 5% | 21% |

  This is exactly the trap that costs money: a coin that already ran on the day but is
  rolling over on the shorter horizons.
- **Liquidity depth** — winners' median pool $19.8k–39k; dead $3.8k, dumped $7.1k.

**Noted but not used:** age is *inversely* associated with good outcomes here
(winners median ~11h, dead ~1,568h). That is substantially a sampling artifact — search
returns established/flat tokens while the boost feeds return fresh launches. Treated as a
hypothesis, not a rule.

## How it maps onto the two decisions

| decision | gate | study numbers |
|---|---|---|
| **1. Worth watching?** (`FUNDAMENTAL_WATCH`) | exclusion gate: liq ≥ $15k, vol24 ≥ $1k, fdv/liq ≤ 50 | 96% recall, 3% bad leak — keeps nearly every winner, removes almost all junk |
| **2. Actually entryable?** (`ENTRY_READY`) | composite: liq ≥ $30k, vol24 ≥ $250k, turnover ≥ 2×, h6 > 0, fdv/liq ≤ 20, not a spent move | 0% bad leak in the study |

Implemented as `marketQuality()` in `packages/watch-engine`, constants in `EVIDENCE`.

## Limitations — read before trusting this
1. **Cross-sectional, not forward-tested.** Features were measured at the same instant as
   the outcome. True predictive power requires snapshotting features at t0 and measuring
   at t+24h — that is what `watch_phase_snapshots` does going forward.
2. **Survivorship bias.** Fully rugged tokens may be absent or unlisted, so the real bad
   rate is likely *worse* than 61%.
3. **n=23 winners.** The 100%-precision composite gate rests on 7 kept rows. That is a
   promising signal, not a validated edge. Do not read it as "100% win rate".
4. **One point in time.** A single market session; regime changes are not captured.
