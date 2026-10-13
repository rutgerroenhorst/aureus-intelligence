# Exit strategies: what the data says (2026-10-11)

> **Update 2026-10-13 (docs/ALERT_REDESIGN.md):** with 1,479 coins instead of 1,123 and sales five minutes after the alert instead of at the level, "half at 2x" no longer beats "all out at 2x" (-3 points with
> instant fills, and **+7 points for all out** with the five-minute delay, which is how an alert is acted on). What still holds: selling nothing is clearly worse, protecting what is left is worth about 5 points
> (with a stop that moves with the price: break-even and a fixed stop are worse), more rungs (5x, 10x) do not measurably help, and a stop at -30% on a fresh position is the one measured improvement (+3 to +4).
> Read result 3 and result 4 below with that in mind. **Costs:** the 5% on every sale used in the simulations is right for a $2 order and too much for a larger one: in the owner's app (FOMO, where no stop can be set) an order
> costs a flat $0.10 plus about 1% from $8 up (measured on the owner's own trades, docs/ALERT_REDESIGN.md). The rules were re-run with that cost for stakes of $2, $3 and $5 and the ranking did not change.

The user asked: what is a good way out of a coin, is it different per coin, narrative or meme, or simply "out at 2x your entry"? And why was 5x in the alerts too?
This is the answer with the definitions, so it can be repeated: `corepack pnpm exec tsx scripts/lab-exit-segments.ts` (read-only, about two minutes, rebuilds every number below
from the laptop database; `scripts/lab-exit-rules.ts` is the older, smaller version of the first table).

## What was run, written down before looking

- **Coins**: every lab coin whose whole 72 hours were seen, entered at its first look (what the Radar offers): **1,123 coins**, first looks 2026-09-12 to 2026-10-08. All of them are the Radar's
  coins (lane "fresh"): no watch-list coin (pump.fun graduations, runners) had a complete window in this selection.
- **Rules** (fixed list of 15): hold; a plain stop at -50%; everything out at 1.5x, 2x, 3x or 5x; half out at 2x with a trailing stop of 25%, 40% or 55% on the rest, or none; half at 2x
  and the rest at 5x; a third at 2x, a third at 5x and a trailing stop on the last third; half at 3x; the lab's example plan (quarters at 2x, 5x, 10x, stop -50%, trail 40%); a tight plan
  (stop -30%, half at 2x, trail 30%). Resting sells fill at their level, stops and trails at the price read, **5% cost on what is sold**. Every number is a ceiling, and the comparison
  between rules is the point, not the level.
- **Segments**: the narrative tag of the coin's name (`lib/lab/narrative.ts`: ai_agent, tool, animal, person, other), how the lab found the coin, the lane, the pool's age at the first look and
  the size of the pool and of the market cap at the first look (thirds). A segment needs 30 coins.
- **The test of "the best exit is different here"**: the rule that is best in a segment on the **earlier 60%** of the coins (by first look) is applied to the **later 40%** of that segment and
  compared, coin by coin, with the one rule that was best overall on the earlier 60%. Differences are means of paired differences with 90% bootstrap intervals (resampling coins).

## Results

**1. Nothing here makes the entries profitable.** Every rule loses on average: -20% to -29% of the stake (the median coin -39% to -79%, `lab-exit-rules.ts`). The coins the Radar offers at the first look
mostly fall; how you leave moves the average by a few points, what you buy moves it by tens of points (below).

**2. The gains are in a few coins.** 15.7% of the coins reached 2x, 9.4% 3x, **5.4% 5x**, 2.6% 10x, 0.9% 20x (held for about half an hour). Of the coins that reached 2x, 60% went on to 3x,
**35% to 5x and 16% to 10x**. Holding for 72 hours, the best 5% of the coins (56) make **94%** of all the gains there are. Any rule that sells everything early gives that tail away
(on the 61 coins that reached 5x, "all out at 2x" keeps 10% of the peak, the example plan 22%, holding 43%).

**3. Everything out at 2x is the worst of the sensible rules.** Paired, same coins, in points of the stake:

| comparison | difference | 90% interval |
| --- | --- | --- |
| half at 2x (trail 40%) minus **all out at 2x** | **+6** | [+1, +12] |
| half at 2x with a trail 40% under the rest minus half at 2x **with no stop** | **+5** | [+1, +9] |
| all out at 2x / 3x / 5x minus the example plan | -5 / -4 / -5 | each excludes 0 |
| third at 2x + third at 5x minus half at 2x (trail 40%) | **-1** | [-3, 0] |
| half at 2x + the rest sold at 5x minus half at 2x (trail 40%) | -5 | [-10, 0] |
| half at 2x, trail 25% / 55% minus trail 40% | -2 / -3 | [-6, +1] / [-5, -2] |
| tight plan (stop -30%, half at 2x, trail 30%) minus the example plan | +3 | [0, +6] (the best mean, -20%, still a loss) |

So: take some out at 2x, keep the rest running, and **put a stop under the rest** (that is what the half at 2x depends on); a trail of about 40% under the highest price was at least as good as
the narrower and wider ones tried.

**4. Why 5x was in the alerts.** It came from the user's own wallet review (docs/WALLET_REVIEW.md): on his 91 coins "a third at 2x and a third at 5x" averaged 0.57x to 0.77x per coin against
0.55x to 0.66x for "half at 2x" alone, the best of the simple rules there. On the lab's 1,123 coins that difference is gone (-1 point, interval -3 to 0): **a sale at 5x adds nothing measurable
on top of "half out at 2x and a stop under the rest"**. What 5x is good for is a moment to look again at a coin that is, as it turns out, one of the 5% that carry the gains (35% of the coins
that reach 2x get there). The alert at 5x stays, and from 2026-10-11 it says the same as the one at 2x (half out while the money is not back, and the stop under the rest), not "take another third out".

**5. Different per narrative, meme or coin? No reliable evidence.**

| name tag | coins | reached 2x | 5x | 10x | best rule on its own coins (mean) |
| --- | --- | --- | --- | --- | --- |
| ai_agent | 41 | 22% | 10% | 7% | hold, +43% (everything else -43% to -11%) |
| tool | 48 | 19% | 13% | 10% | tight plan, +3% (the others -32% to +2%) |
| animal | 279 | 16% | 6% | 3% | tight plan, -18% |
| other | 747 | 15% | 4% | 2% | tight plan, -22% |
| person | 8 | too few | | | |

AI-agent and tool coins ran further more often (5x: 10% and 13% against 4% to 6%), and holding did best for AI-agent coins, but that is 41 and 48 coins, a handful of runners decide it, and the
intervals are wide: a hint, not a rule. In the segments large enough for the out-of-sample test (animal, other) a segment's own best rule did **not** beat the global one on later coins.
Across all 13 segments that could be read, a segment's own rule beat the global rule on later coins in 3 (pools 1 to 6 hours old at the first look, middle-sized pools, middle-sized market caps)
and was worse in none, but the global rule chosen on the earlier coins (a plain stop) turned out a poor rule on later ones (-21% then, -34% later; in hindsight the tight plan was best on the
later coins, -18%), the three segments each preferred a different rule, and there is no story that holds them together. Not enough to give any narrative its own exit rule.
**One rule for everything is as good as the data can tell; per coin the best exit is only known afterwards.**

**6. What matters more than the exit: what is bought.** Under the same rules, coins whose pool was small at the first look averaged -6% to -9% when held, middle ones -38% to -40%, large ones
-32% to -33%; coins whose pool was already 24 hours old at the first look -6%, 6 to 24 hours old -20%, 1 to 6 hours old -29%. This agrees with the wallet review (busy, rising, very young coins crash more) and is a difference of
20 to 30 points, several times any difference between exits. It is descriptive, from the lab's coins, and changes nothing on the Radar.

## What changed in the product

Only the idea line of the Telegram alerts (docs/EXIT_ALERTS.md): half out while the money is not back, and "een stop 40% onder de hoogste koers op de rest"; at 5x the same, without a further sale.
Levels (2x and 5x), confirmation and everything else are unchanged. The alert is an idea, nothing is sold by the system.

## Limits, honestly

- The coins are entered at the first look, which is not how the user trades; his own results are in the wallet review (98 coins, three weeks, three coins carry all the profit).
- Hourly-ish readings: a stop or trail that fills at the price read flatters a coin that falls between two readings, and a thin pool fills worse than the lab assumes. At $2 to $5 a position that
  is mostly fine; at the top of a pump it is not.
- Three weeks of coins, one market: the later 40% were worse for several rules than the earlier 60%, so the ranking of rules is unstable over time; the robust findings are the ones above that
  hold in both halves (a stop under what is kept, not selling everything at 2x, nothing making the entries profitable).
- Narrative tags are keywords in names (crude on purpose). Person-name coins (8) and the AI/tool groups (41, 48) are too small for any conclusion.
- Nothing here predicts the next three weeks.
