# Outside research: what was checked, what held, what was built

Anything written about memecoins by someone else (an AI chat, a blog, a paper) is treated as a list of hypotheses. A claim is only used when
it can be checked against sources and against the coins this system has actually followed, with the definition fixed in advance.
The checks below are reproducible: `scripts/lab-ideas-check.ts` and `scripts/lab-exit-rules.ts` (read-only, laptop database).

## First check: do the sources exist? (2026-10-11)

| claim in the text | result |
| --- | --- |
| "Meme Coin Factories" (arXiv, September 2026): manipulation on pump.fun | exists (arXiv 2609.10246): wash trading, hidden creator addresses, coordinated sells, copycat coins, social media manipulation; a manipulation-as-a-service finding. Summaries also cite that the top 1% of creators make most coins (reported as 58.57%) and that wash trading goes with a higher graduation rate; the abstract has no thresholds |
| a paper on graduation labels | exists (arXiv 2607.02823): a model with AUROC 0.86 in development scored 0.46 on the later cohort, and the collector's labels did not measure what they claimed. Supports what the lab already does: forward tests only, later coins as the judge, outcomes checked rather than assumed |
| CoinGecko: most pump.fun coins stop trading on launch day | found: 68.67% of 18.67 million coins stopped on launch day, 4.55% still traded after 90 days (a different figure from the 79% in the text) |
| Bitquery: 79% never traded again, 99% of "curve-skip" pools drained | not found anywhere; treated as unverified |
| "PumpFun Launch-to-Graduation Corpus" (HuggingFace), "RED-PUMP-2026" (Zenodo) | no dataset page found (the Zenodo record that came up was unrelated); nothing was downloaded. Their labels would be graduation, not what a coin does after it |

## Second check: do the ideas hold on our own coins?

Radar coins at their first look, outcomes decided over 72 hours (n about 1,090 decided). Base rates: 15% held 2x, 64% lost half within a day,
the example exit plan averaged -23%.

| idea | result on our data | used? |
| --- | --- | --- |
| "verify who made the pool": a PumpSwap pool for a coin that was not launched on pump.fun (mint not ending in "pump") | no difference: lost half 75% against 74%, held 2x 17% against 16% (380 and 907 coins) | no |
| wait for the first pullback that holds above the base, enter on a 15% bounce | 350 coins formed it. Against a reading of the same coin at about the same age: held 2x 14% against 21% (p = 0.07), plan -25% against -15%. The apparent gain against the first look (37%) is selection: it is only measured on coins that later rose. No evidence of an edge | no, and it saves building it |
| copycats (same symbol within 24 h) | no signal: 3+ copies held 2x 14% (2/14) against 15%, first of several against later copy no difference | no |
| wash-like trading (trades per wallet), independent buyers (unique buyers) | the figures exist for about 200 coins seen since the collectors started; none has a decided window yet | registered as forward hypotheses H11 and H12 |
| holders at the first look (RugCheck: one wallet, insider networks, lock) | 63 graduations an hour old: too few; born graduated 25 of 25 drained or halved against 63% for the rest | H10 already running; born graduated already filtered |
| risky Token-2022 extensions (permanent delegate, transfer hook, pausable), mint/freeze authority | 40 recent coins: none enabled except harmless metadata (one transfer-fee config at 0); mint/freeze authority on for 1 of 40 | not worth a feature: RugCheck lists these as risks |
| creator history (serial launchers) | creators do repeat (12 of 180 with two graduations; 3 of 30 born coins came from a creator with an earlier born coin) but too few to test | H9 already running |
| narrative radar (social data, trending lists) | DexScreener's trending narratives only list coins that are already big; social data is paid or restricted | not built |
| which exit rule works best | nine simple rules on 1,091 coins entered at the first look: all lose 20% to 28% on average. The example plan against holding: +3 points [-12, +16]. Selling early keeps little of the big winners (60 coins that reached 5x: holding kept 43% of the peak, the plan 22%, "sell all at 2x" 10%) | no change: selection matters, not the exit rule |

## What the check found by itself

Where a coin trades. Coins on PumpSwap (a pump.fun graduate's pool) lost half within a day 75% of the time against 40% on Raydium
(834 and 386 coins), while the chance of a 5x is the same (5.3% against 5.7%) and the example exit plan averaged -31% against -8%. It holds
inside every age band (1-6 h: 78% against 43%; 6-24 h: 67% against 24%; 1-7 d: 49% against 37%). It is descriptive (the two groups may differ in more
than the venue), but nothing else in the lab separates coins this strongly.

## What was built

- `lib/lab/reports/structure.ts`: the venue comparison above, recomputed with every report, with a finding only when the gap is large, clearly
  beyond chance and the same in every age band with enough coins. It appears as a headline on the Learning page and as the first item under
  "Needs you" ("show the exchange on the cards, or add a switch that hides PumpSwap coins"). Nothing on the cards changed.
- hypotheses H11 (wash-like trading) and H12 (independent buyers), registered 2026-10-10 23:50 UTC, forward only.
- the two scripts above.

## Left alone, on purpose

Entry rules from chart patterns (pullback, breakout and retest, liquidity sweep) until a definition beats the same coin at the same age; social and
narrative scanners; paid data; any of the outside datasets; anything that would add information to the coin cards.
