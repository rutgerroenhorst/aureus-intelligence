# Exit and entry rules used in practice for pump.fun memecoins, tested on the lab's own coins (research, 2026-10-13)

The owner asked: research the best strategy that is used for coins like these (pump.fun launches that moved to PumpSwap, for example the example coin $HW2), as far as **exits** go, and maybe **extra entry signals**.
Method, as for all outside research here: read what is said and by whom, grade the evidence, write the rules down as exact definitions, test them on the lab's coins, and build only what holds.
Nothing was built or changed in the product. Reproduce every number: `corepack pnpm exec tsx scripts/lab-exit-practice.ts` (read-only, about 3 minutes, laptop database).

## 0. A correction first

The first version of this research, and the alert research of the same morning (`docs/ALERT_REDESIGN.md`), used coins whose 72-hour window was "decided". A coin that has died is decided at once, a living coin only after 72 hours,
so the most recent coins in the sample were mostly dead ones (318 of 1,479), and **that made selling early look better than it is**. The claim "the more is sold at the first alert, the better" came from this and is withdrawn.
Every number below counts a coin only when its entry plus 72 hours was over by the latest reading (`MATURE=0` in the script gives the old selection back). The graduation lane the lab started on 2026-10-09 has no mature
cohort yet, so it is not in these numbers; the coins here are the Radar's PumpSwap coins of 2026-09-12 to 2026-10-10 (and other pools for comparison).

## 1. What is used in practice, and how good the evidence is

| rule or claim | where it comes from | what it rests on | what our data say |
| --- | --- | --- | --- |
| Take the "initials" out at 2x (sell half), keep a moonbag | nearly every guide ([DEXTools](https://www.dextools.io/tutorials/memecoin-trading-strategy-take-profits), Madeonsol, Substack posts) | folk practice, no data | the same as the current advice if the rest has a trailing stop; **a moonbag with no exit is clearly worse** (-10 [-15, -5] at the first look) |
| Ladders: 25% each at 2/3/5/10x; 50% at 2x + 25% at 3x + 25% at 5x; 20% at 3x, 5x, 30% at 10x, 20x; 25% at 3x, 6x, 12x + moonbag | [Madeonsol exit guide](https://madeonsol.com/blog/solana-memecoin-exit-strategy-guide), [Altrady](https://www.altrady.com/blog/crypto-trading-strategies/pump-fun-solana-memecoin-trading), a Substack post | no evidence cited on the Madeonsol and Altrady pages (read in full); the post is anecdotes | **none beats the current advice measurably**; the two with large late rungs are worse at the first look (-7, -8); every ladder costs more orders (1.3 against 1.2 a coin, each $0.10) |
| Trailing stop 15-50% (25-35% "the sweet spot"), tightening 40/30/20/15%, time-decay trail | Madeonsol | no backtest | tight trails (20-25% under the high from the entry) did best at the first look (+9 [2, 16], +7 [1, 15]) but not elsewhere; tightening and time-decay trails no better |
| "A plain 10% trailing stop beat profit ladders once fills were counted honestly" | a vendor's replays (Meme Hunter at sindex.io; the page was blocked, seen only in a search summary) | the vendor's own data, not shown | same direction (10% trail -15% against ladders -22 to -25% at the first look) but **not significant** (+6 [-2, 13]) |
| Hard stop 30-50% below the entry | Altrady | no evidence | **a hard stop without profit-taking is much worse** (-14 to -22); as the opening stop of the current advice it is fine, and -30% instead of -50% was +3 [1, 5] (alert research) |
| Time exit if nothing moves in 6-12 hours | Altrady, Madeonsol | none | small and borderline: +2 [-1, 5] (PumpSwap, first look), +8 [2, 13] against the current advice but +4 [-3, 9] against the proposal at a 6 h entry |
| Volume and holder signals (price up on falling volume, 1-minute buy volume under 30% of the 5-minute average, holder growth slowing) | Madeonsol, bot documentation | none | **not testable**: the lab has no volume history at that resolution |
| Liquidity as a warning (exit when the pool falls) | guides | none | **adds nothing on PumpSwap**: tested as "sell when the pool is down to half of its high", the result is the same as without it (0 [-1, 0]); the guard would have fired on most coins, but after the price stop. The likely reason (an explanation, not measured separately): the pool is an automated market maker whose LP tokens are burned, so its value falls with the *square root* of the price and is down by half only when the price is down by three quarters |
| "Graduation pump, then a dump" | guides; the vendor [Scorp](https://trader.scorplabs.online/blog/pump-fun-graduation-raydium-migration): 15,548 graduations since 2026-05-31, pool of $5,000 or more still there: 56.5% at +5 min, 43.8% at +30 min, 25.8% at +6 h, 19.7% at +24 h | a tracked dataset (the vendor's) | **confirmed** on 2,311 of our PumpSwap coins (section 3); our level is higher (75%, 58%, 45%, 37%) because the Radar screens its coins, the shape is the same |
| Buying every migration loses | a paper-trading experiment ([vaanai/MAL pull request 94](https://github.com/vaanai/MAL/pull/94): 415 migrations; every configuration had a negative mean, the least bad 381 trades at 9.4% winners; "do not merge") | unverifiable, honestly negative | consistent: the first-look entry averages -21% here even with the best exits |
| Graduation can be predicted from the first trades (fast accumulation, a high share of non-bot trades, known creators) | [Marino, Naviglio, Tarantelli, Lillo, "Predicting the success of new crypto-tokens: the Pump.fun case"](https://arxiv.org/abs/2602.14860) (655,770 tokens, 2025-09-01 to 10-01, 0.63% graduate) | conditional frequencies, no machine learning, no out-of-sample metric | about *reaching* the migration, not about what a buyer after it earns; the paper's own break-even check is mostly not met; 92% of tokens had at least one dump |
| A predictor that looks good in development fails later | ["Auditing Collector-Generated Graduation Labels on Pump.fun"](https://arxiv.org/abs/2607.02823): AUROC 0.86 in development, **0.46 on two later weeks** (calibration off by a factor 15) | a pre-specified held-out split | the reason hypotheses here are registered first and judged only on coins that come later |

Entry signals people name (checked against what the lab can test):

| signal | source | in the lab |
| --- | --- | --- |
| top 10 holders under 25-30%, no single holder above 2-3% | DEXTools, guides | RugCheck top holders are collected for graduates; the one-wallet 20% rule is hypothesis H4 (it did not protect); the tail research found top-5 of 60% or more mostly dead |
| bundled supply above 20% in the first block, snipers above 20% | guides, Mobula documentation | RugCheck "insider networks": hypothesis H10, collecting |
| the creator's history (a serial launcher) | guides; Scorp: "the dev wallet tells you more about a graduate's next 30 minutes than the graduation itself" | H9 (one-off creators), H7, H8, collecting; Jupiter's `dev_mints` is now collected |
| organic or independent buyers, holder growth | guides | H5 (organic score), H12 (300 or more different buyers), collecting |
| smart-money wallets (GMGN, KOL buys) | tracker blogs | no wallet labels here; the same sources warn that a high win rate can be "performance laundering" (closing winners, holding losers) |
| minimum pool of $30,000-50,000 | Altrady | see L6 below: the opposite sign at a 1 h entry |

## 2. How it was tested (written down before looking)

- **Coins**: every lab coin with at least three clean readings whose entry plus 72 hours was over by the latest reading; one row per coin; phantom readings removed. Populations: **PumpSwap** (the first-look pool is PumpSwap: a pump.fun graduate, 763 coins at the first look),
  other pools (387) and all (1,161).
- **What "the first look" is** (corrected 2026-10-13): the lab's first reading of a coin, not the moment of its graduation. The Radar's door admits a pool only once it is 60 minutes old (and up to $150K market cap), so the first look is at a pool age of **1.0 / 1.3 / 17.1 hours** (10th / median / 90th percentile).
  An earlier version of this page, and of the chat answers built on it, read "74% lose half at the first look" as the graduation moment. The graduation lane (coins seen at their graduation by the chain feed and the stream, since 2026-10-09) has no finished cohort yet; the forward test in section 5 is for it.
- **Entry**: at the first look, and 6 hours later (the first reading at least six hours after the first look; the coin has to be alive and priced then). Later entries 1, 3, 12 and 24 hours after the first look are in section 4.
- **Fills and costs**: a trigger on a reading is sold **five minutes later** at the price then (an alert, then a person), with the owner's real cost per sale (a flat $0.10, +1% from $8; `docs/ALERT_REDESIGN.md`), stake $3, 72-hour horizon.
- **Rules**: 29, fixed in the header of the script (baselines; the five ladders of the guides, each as written and with a 40% trail; seven trailing stops from 10% to 50%; a tightening and a time-decay trail; three hard stops; five overlays on the
  proposal). None was added or changed after looking.
- **Judging**: paired differences against the current advice (half at 2x, trail 40%, stop -50% before the first sale) and against the proposal, 90% bootstrap intervals; the later 40% separately; and the honest test: the best rule on the earlier 60% of the coins judged on the later 40%.
  With 29 rules, three populations and two entry moments there are about 170 comparisons, so a few intervals above zero are expected by chance: a rule counts only if it holds on all coins, on the later 40% and at both entry moments.

## 3. Results

**The path of a PumpSwap coin after its first look** (2,311 coins; price and pool as a multiple of the first look; a coin that died stays at its last reading):

| after | price, 10th / median / 90th | share below the first-look price | pool, 10th / median / 90th |
| --- | --- | --- | --- |
| 5 min | 0.13 / 0.97 / 1.35 | 55% | 0.35 / 0.98 / 1.17 |
| 30 min | 0.01 / 0.71 / 1.42 | 70% | 0.04 / 0.82 / 1.24 |
| 1 h | 0.01 / 0.55 / 1.31 | 76% | 0.04 / 0.70 / 1.17 |
| 3 h | 0.01 / 0.36 / 1.22 | 81% | 0.04 / 0.58 / 1.14 |
| 6 h | 0.01 / 0.25 / 1.18 | 83% | 0.04 / 0.48 / 1.12 |
| 24 h | 0.00 / 0.10 / 0.99 | 90% | 0.00 / 0.29 / 1.07 |

The median PumpSwap coin is at 0.55 of its first-look price after an hour and at 0.10 after a day. "Graduation pump, then dump" is the normal course, not the exception.

**Exits** (mean result in % of the stake after costs; difference against the current advice in points of the stake, 90% interval; the full 29 rules are in the script's output):

| rule | PumpSwap, entered at the first look (763) | PumpSwap, entered 6 h later (558) | all coins, first look (1,161) |
| --- | --- | --- | --- |
| hold 72 h | -49% (-27 [-36, -19]) | -30% (-18 [-26, -10]) | -25% (-11 [-20, -2]) |
| **current advice**: half at 2x, trail 40%, stop -50% | **-21%** | **-12%** | **-14%** |
| 75% at 2x, same trail and stop | -20% (+1 [-2, 3]) | -8% (+4 [1, 7]) | -13% (+1 [-2, 3]) |
| all out at 2x, stop -50% | -19% (+2 [-4, 8]) | -3% (+8 [3, 14]) | -12% (+2 [-4, 6]) |
| initials, moonbag with no exit | -31% (-10 [-15, -5]) | -15% (-3 [-6, 0]) | -19% (-5 [-10, -2]) |
| 25% each at 2/3/5/10x, trail 40% | -23% (-2 [-8, 2]) | -8% (+4 [0, 9]) | -16% (-2 [-7, 2]) |
| 50% at 2x, 25% at 3x, 25% at 5x, trail 40% | -21% (0 [-6, 5]) | -7% (+5 [0, 11]) | -15% (-1 [-6, 3]) |
| 20/20/30/30% at 3/5/10/20x, trail 40% | -24% (-3 [-8, 2]) | -10% (+2 [-4, 8]) | -17% (-3 [-7, 1]) |
| trail 10% from the entry, nothing else | -15% (+6 [-2, 13]) | -8% (+4 [-6, 12]) | -12% (+2 [-5, 8]) |
| trail 20% from the entry, nothing else | **-13% (+9 [2, 16])** | -10% (+2 [-6, 9]) | -11% (+3 [-4, 9]) |
| trail 25% from the entry, nothing else | -14% (+7 [1, 15]) | -11% (0 [-8, 8]) | -12% (+2 [-4, 8]) |
| trail 40% from the entry, nothing else | -20% (+1 [-5, 8]) | -17% (-6 [-14, 2]) | -13% (+1 [-4, 7]) |
| tightening trail 40/30/20/15% | -27% (-5 [-13, 1]) | -15% (-3 [-11, 4]) | -20% (-6 [-12, -1]) |
| hard stop -30%, hold otherwise | -35% (-14 [-21, -8]) | -22% (-10 [-19, -2]) | -21% (-7 [-14, 0]) |
| hard stop -50%, hold otherwise | -41% (-20 [-27, -13]) | -26% (-14 [-22, -7]) | -25% (-11 [-19, -4]) |
| proposal + time stop 6 h (never 1.3x) | -18% (+3 [-1, 6]) | -4% (+8 [2, 13]) | -12% (+2 [-1, 5]) |
| proposal with stop -30% | -17% (+4 [-1, 7]) | -9% (+3 [-3, 9]) | -11% (+3 [-1, 6]) |

What holds:
1. **Every rule loses on average** (-3% to -49%): these coins are a negative-expectation universe at the first look, and the exit cannot change that; the best exits are worth 5-10 points, the entry moment about as much (section 4).
2. **Selling nothing is clearly worse** than any exit (-27, -18, -11 points), **an unprotected moonbag is worse** than a trailed one, and **a hard stop without profit-taking is much worse** (-14 to -22 at the first look).
3. **Nothing in circulation beats "sell about half at 2x and trail the rest"** in a way that survives: the ladders of the guides are equal or worse, 75% and 100% at the first alert are equal at the first look (and better at the 6 h entry only on the
   earlier coins, not on the later 40%: +1 [-4, 4] for the best-chosen rule), the tightening and time-decay trails are not better.
4. **Tight trailing stops straight from the entry (20-25% under the high, nothing else)** are the one family that looks better for PumpSwap coins entered at the first look (+9 [2, 16], +7 [1, 15], later 40% +17 and +13), in line with the vendor's claim,
   but it does not hold up elsewhere (6 h entry 0 to +2, all coins +2 to +3, intervals through zero) and the rule picked as best on the earlier coins (10%) gave +6 [-4, 15] on the later ones (the later-40% figures above are against the proposal). **A candidate, not a finding.**
5. **A time stop** (sell when 6-12 hours after the entry the coin never reached 1.3x) is a small plus at the first look (+2 [0, 4]) and a larger one at a 6 h entry against the current advice (+8 [2, 13]); against the proposal it is +4 [-3, 9]. Borderline.
6. **The liquidity guard does nothing** (see the table in section 1: the price stop fires first).

**Entry timing on the age of the pool** (the current exit; PumpSwap coins entered when their pool is N hours old, alive and priced then; stake $3, real cost, 5 minutes late; redone on the pool's age on 2026-10-13, the first version counted hours after the first look):

| pool age | coins | lose half within 24 h | touch 2x within 72 h | hold for 72 h | the current exit | later entry minus the 1 h entry [90%] |
| --- | --- | --- | --- | --- | --- | --- |
| 1 h | 519 | **78%** | 24% | -54% | -22% | |
| 2 h | 514 | 63% | 21% | -44% | -18% | +5 [-14, 21] |
| 3 h | 507 | 56% | 17% | -43% | -9% | +13 [-6, 32] |
| 6 h | 488 | 47% | 16% | -35% | -22% | 0 [-16, 16] |
| 12 h | 419 | 37% | 20% | -24% | -9% | +14 [-5, 30] |
| 24 h | 402 | 28% | 12% | -26% | -21% | +2 [-13, 15] |

Waiting makes the crash rarer (78% of the entries at a pool age of one hour lose half within a day, 28% of the entries a day later) and the doubling rarer too (24% to 12%). The effect on the average result of the current exit is **within noise**: every interval includes zero (0 to +14 points), and
the current exit beats holding by 31 [21, 42] points at one hour, which is the only large, clear number in the table. Other pools: the share that loses half within a day does not fall with age (45-51% for the first six hours, 34-37% later), and the average of "hold" there is carried by a few big winners, so nothing can be said.
These rows are what the Check button's age line quotes (`apps/web/lib/ageRates.ts`).

**What became of a fresh loser** (`scripts/lab-fresh-loser.ts`, read 2026-10-13, the basis of the loss message; every lab coin whose first look is at least 73 hours before the latest reading, entered at the first look; 537 coins, 354 on PumpSwap):

| | PumpSwap | other pools | all |
| --- | --- | --- | --- |
| fell to 0.7x of the first look or lower within 72 h | 90% (319 / 354) | 87% (154 / 177) | **89%** (477 / 537) |
| of those: ended at half or lower | 84% | 69% | **79%** |
| of those: ended at 0.3x or lower | 78% | 57% | 71% |
| of those: back at 1x or more | 8% | 15% | **10%** |
| of those: reached 0.7x within 6 h | 72% | 71% | 71% |

A coin that is 30% under what was paid in its first days is, in this data, usually a coin that keeps falling. It is also nearly every coin: 89% of the lab's first-look entries fell that far. So the loss message is not rare; it is quiet, once per position, and it is a statistic, not a forecast of the coin in hand
(the lab entered at the first look, the owner enters at all kinds of moments). The −30% stop on a fresh position was worth +3 [1, 5] points of a $3 stake against the current exit, fee included (the one measured improvement; the alert research has the table, section 1 the −30% rows with a wider interval).
At a $2 stake an order costs 5 points of it, at $5 two points, so for the smallest positions the message is about break-even on average; the proposal had it only for positions of $4 or more, the built message goes down to a position worth $1 because the owner's
typical positions are $2 to $5, says the cost in the message and is quiet. `EXIT_ALERT_LOSS=0` switches it off.

**Entry conditions, exploratory** (six conditions fixed before looking; PumpSwap coins; the current exit; "a" against "b"; a difference is "a minus b"; they decide nothing until they hold on coins that come later):

| condition | at a 1 h entry (a / b: coins, result) | difference [90%] | at a 6 h entry | difference [90%] |
| --- | --- | --- | --- | --- |
| L1 the pool is still 70% or more of its size at the first look / smaller | 472 / 172: -20% / +23% | -43 [-98, -3] | 259 / 136: -25% / +1% | -26 [-57, 0] |
| L2 the price is above its first-look price / below | 242 / 460: -19% / -2% | -17 [-42, 4] | 133 / 425: -15% / -11% | -4 [-22, 16] |
| L3 the price is already 2x or more of the first look (chasing) / not | 33 / 669: -14% / -7% | -7 [-41, 33] | 35 / 523: -4% / -12% | +8 [-20, 38] |
| L4 within 10% of the highest since the first look / 30% or more below it | 210 / 313: -21% / +5% | -26 [-57, 2] | 51 / 425: -22% / -12% | -11 [-32, 11] |
| L5 rose 10% or more in the last hour / fell 10% or more | 175 / 341: -22% / +3% | -25 [-53, 1] | 93 / 165: -11% / -13% | +2 [-30, 37] |
| L6 a pool of $20,000 or more / smaller | 299 / 345: -28% / +8% | -36 [-65, -12] | 189 / 206: -22% / -11% | -11 [-33, 9] |

At a one-hour entry the coins that were *strong* (pool kept or grown, price above its start, at its high, rising, big pool) did worse than the ones that had already fallen, which is hypothesis H2 ("buying at a fresh high is worse than buying a dip", registered before)
seen from another side; two of the six intervals exclude zero, with about twelve comparisons that is not more than chance, and a group that has already fallen is partly coins with nothing left to lose. At a six-hour entry the differences are gone.
The guides' "minimum pool of $30,000-50,000" has the opposite sign at a one-hour entry. **No entry condition is established.**

## 4. What it comes to

- There is no exit rule in circulation for these coins that is better than what the owner already uses, measurably. What is *supported*: sell something at the first double, never leave the rest without an exit, do not use a hard stop alone, and a stop at -30% on
  a fresh position is a small plus. Tight trailing stops from the entry and a time stop are candidates.
- The **entry moment** matters at least as much as any exit: a PumpSwap coin bought when its pool is an hour old has a 78% chance of losing half within a day; at six hours 47%, at a day 28%. (Whether waiting pays on average is not established: every interval includes zero.)
- The signals people name for entries are mostly **registered hypotheses with no verdict yet** (H1-H12 in the Learning Lab; the ones with a verdict in the early data are H3 "volume dried up", p=0.002, and H2 "buying a high", p=0.04, both still to be confirmed on coins
  first seen after 2026-10-10); the new work here adds one more thing to check, "tight trails from the entry".
- Predictors have a bad record out of time (the audit paper: 0.86 to 0.46), which is why nothing here was tuned on the old coins.

## 5. Forward test, fixed now

Re-run `scripts/lab-exit-practice.ts` after 2026-10-27 and look **only at coins first seen after 2026-10-13** (the graduation lane will have mature cohorts by then). The claims, with the bar for believing them: (a) entering PumpSwap coins an hour or more after the first look beats
the first-look entry on the mean (here 0 to +14, all within noise); (b) a 20-25% trail from the entry beats the current advice by 5 points or more with the interval above zero; (c) a stop at -30% on a fresh position stays at about +3; (d) 50%, 75% and 100% at the first alert stay equal.
Anything that fails stays out.

## 6. Not built, and what could be (all need the owner's yes)

- ~~A "this coin is N minutes old" line in the Check button with the base rate from this table~~: **built 2026-10-13** (`apps/web/lib/ageRates.ts`, the "Pool age" line of the Check; a note, never part of its verdict; the rates are copied from the table above and carry their date, so they have to be redone when this table is).
- No separate "pool down by half" danger message in the alert redesign: on PumpSwap the price stop already covers it.
- Nothing about the exits changes: the alert redesign keeps the current advice (decision 2 in `docs/ALERT_REDESIGN.md`).

## Sources

Read: [Altrady, Pump.fun & Solana memecoin trading guide](https://www.altrady.com/blog/crypto-trading-strategies/pump-fun-solana-memecoin-trading); [Madeonsol, Solana memecoin exit strategy guide](https://madeonsol.com/blog/solana-memecoin-exit-strategy-guide); [Scorp Trader, what happens at the migration](https://trader.scorplabs.online/blog/pump-fun-graduation-raydium-migration);
[vaanai/MAL pull request 94](https://github.com/vaanai/MAL/pull/94); [Marino et al., arXiv 2602.14860](https://arxiv.org/abs/2602.14860); [Auditing collector-generated graduation labels, arXiv 2607.02823](https://arxiv.org/abs/2607.02823); [The Memecoin Phenomenon, arXiv 2512.11850](https://arxiv.org/abs/2512.11850) (context: Q4 2024, under 2% graduate).
Seen only in search summaries (the pages were blocked or missing): the Sindex "Meme Hunter" replays, the DEXTools take-profit tutorial and 2026 checklist, the GMGN smart-money guides, the Substack post on round-tripping (read: anecdotes only).
