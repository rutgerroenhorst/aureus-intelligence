# What the user's own entries say (2026-10-11)

The user thought about 80% of the coins their wallet bought in the last two or three weeks came through this system, and asked: which are
they, when were they entered, how did they end, what can the lab learn from that, and "if the system is already good, leave it". This is
the answer, with the definitions, so it can be repeated. The per-coin list is not in the repository (it is the user's trading, and the repo is
public); `scripts/wallet-review.ts` rebuilds it on any machine that has the wallet tables.

## What was run

| script | what it does |
| --- | --- |
| `scripts/wallet-review.ts [--since 2026-09-20] [--candles file] [--json file]` | read-only. For every coin first bought since the day: money in, out and still held (valued at DexScreener's price now, 0 for a coin without a real pool), when the system first had the coin, the verdict it had by then, the tabs that had listed it, the pool's age and size at the buy, what the price did after the buy, and the questions below. Never selects or prints the wallet address. |
| `scripts/wallet-candles.ts --in review.json --out candles.json` | GeckoTerminal hourly candles since the buy for those coins (the scanner follows a coin for about a day, the lab's tail for about 100 hours, the user holds for weeks). Resumable, paced, asks with `token=<mint>`. |
| `scripts/lab-activity-check.ts` | the universe-wide check the review pointed to (pool age and first-hour activity against crashing and doubling, fitted on the earlier 60% of the lab's coins and applied to the later 40%). |
| `lib/lab/reports/own.ts` | the part that stays: "Your own entries" in Learning > Tabs, recomputed with every report (counts and rates only). |

## Definitions and a trap

- **First buy** of a coin from `wallet_fills`; **money multiple** = (sold + what is still held at today's price) / put in. A coin that is no
  longer listed with a pool of at least $1,000 is worth 0 (checked by hand on nine coins: DexScreener lists no pair for the dead ones).
- **The system knew the coin** = `tokens.first_seen_at` is before the first buy. **Do not use `candidates.discovered_at` for this**: the
  scanner copies the pool's creation time into it, so it says when the pool was made, not when the system saw the coin (a first version of the
  review used it and put every "known before the buy" an hour or more too early). The door admits a coin only after its pool is 60 minutes old,
  so a coin bought in its first hour cannot have been on a Radar tab.
- Listing on a Radar tab (`coin_qualifications`) exists only since 2026-10-09, so "on a tab before the buy" can be shown for the last two days only.
- Against the lab's other coins: each entry is matched to the lab's snapshot of the coin closest in time (within 3 hours, decided 72 h window),
  the same matching the tabs report uses (`gradeListings`), and compared with every other coin at the same ages.

## Results: 98 coins first bought 2026-09-20 to 2026-10-11

**The money.** $244 in, $88 out, $66 still held: 0.63x, a net of -$90. The median coin ended at 0.09x of its cost; 74% lost half or more
(67-81%), 55% are worth under a tenth, 7% (7 of 98) doubled. Three coins carry all the profit: without the best three the net is -$157.

**Did the system know them?** 69% (68 of 98) before the buy, 80% at some point (so the user's estimate of 80% is right about "known", not
about "found through the Radar": only 9 of the 26 buys since tab history began were on a tab first). 10 coins were first seen after the buy
(one of them is HOTBOT, bought eight days before the lab's runner lane found it) and 20 were never seen.

**The coins the system never saw lost almost everything**: 20 of 20 lost half or more and 16 of 20 are worth under a tenth, against 45 of 68
and 32 of 68 for the coins it knew before the buy (Fisher p = 0.001 and 0.011). It holds in each of the three buy-weeks (2/2, 4/4, 14/14
against 14/18, 12/15, 19/35), so it is not only that recent buys have had less time. The discovery feed is DexScreener's profile feed, so a
coin it never lists is probably one nobody paid to show (not checked for these 20), and in this sample those were the worst coins by far.

**The system's own labels did not separate the coins** (verdict at the buy: setup forming, entry approaching, watch, too extended,
rejected; n = 2 to 21 per label). Universe-wide the same holds: at 24 hours the share that lost half is 54% for coins just discovered (n = 1,391),
61% and 63% for "entry approaching" and "setup forming" (363, 367), 60% for "too extended" (359), 77% for "fundamental watch" (615) and 37% for
rejected ones (570, measured only while they were still followed); the share that doubled is 12-20% in every label. The labels sort coins by what
they just did, which is also what the lab found crash-prone. Descriptive only; nothing was changed because of it.

**Entries against the lab's other coins** (57 matched): held 2x within 72 h of the buy 20% (n = 30) against 15% (p = 0.43); lost half in a
day 58% (n = 38) against 55% (p = 0.74); the lab's example exit plan from the buy: -24%. The picks are not better and not worse than the
coins around them. The Learning page shows the same (53 matched, verdict "no difference").

**What the coins looked like at the buy.** Higher than a typical coin of the same age on trades in the last hour (median percentile 62-66),
volume (64-70), the last 6 hours' price change (68-69, already rising), and younger pools (36). On the lab's own coins, with edges fitted on the
earlier 60% and applied to the later 40% (`lab-activity-check.ts`): the quietest third by first-hour trades lost half in 38% of cases against
83% for the busiest third, with the same chance of doubling (16% against 15%); the example exit plan averaged -18% against -43% (difference
25 points, interval 7 to 43). Pools under 6 hours old lost half 67% of the time against 54% at 6-24 hours and 46% at 1-7 days, again with the
same chance of doubling. So a habit of buying busy, rising, very young coins costs money, and it is the one effect in the lab that replicates
on later coins. It is also not enough to turn the lab's coins into a profit: even the quiet third averages -18% with the example plan.

**Late winners, early spikes (hourly candles for 92 coins).** 24% closed at 2x or more at some hour after the buy (17-32%), 16% at 3x, 8% at 5x,
2% at 10x. 18 of the 22 that doubled did so within a day. The three biggest winners are the exception: their first 3x close came after 4.7,
7.9 and 10.4 days, after the scanner and the lab's tail had stopped following them.

**Exits.** On the 91 coins bought once, the user's actual result averaged 0.46x per coin; holding everything 0.53x; simple rules applied to
the same buys: half out at 2x (the money back) 0.55x to 0.66x, a third at 2x and a third at 5x 0.57x to 0.77x, everything out at 3x 0.65x to 0.70x
(the first figure assumes a sale needs an hourly close at the level, the second that a resting order fills when an hourly high touches it; the truth
is in between). Against what he did the rules gain +0.10 to +0.31 per coin, with paired bootstrap intervals that exclude zero (for example +0.10
[0.04, 0.15] for half out at 2x). Eight coins closed at 3x or more at some hour and ended below 1.5x for him (the best: 7.7x to 1.06x); seven of those
peaked within the first two days. His own way of exiting winners (taking the money out in slices while the price steps up) is not where the money
leaked; the leak is the coins that spiked for a few hours and were not sold. About $20-70 over the three weeks at his sizes; still below break
even (the best rule averages 0.77x per coin).

## What was changed, and what was not

Changed: "Your own entries" in Learning > Tabs (hourly, counts and rates, nothing else on any page); the three scripts; this document.
Not changed: any filter, score, tab or card. Reasons: nothing in 98 coins is strong enough to fit a rule to (the lab's own bar is 30 per group
and the same direction on later coins); the one effect that does replicate (busy and very young coins crash more) changes what the user sees, which
is theirs to decide; and the evidence says the system's selection adds nothing measurable yet, not that it does harm.

## Open, with the user

1. An alert when a coin they hold reaches 2x (and 5x) their average price: the exit rules above are the one thing that would have improved
   their result, and it needs a channel (Telegram bot token, or a free push topic) and a laptop or scheduler that is on.
2. A quiet/busy cue or sort on the Radar (and on the Hot tab, which lists the busiest coins by construction).
3. Following the held coins for weeks instead of days (the biggest winners ignited after 5-10 days), and the never-seen coins from the buy on.

## Limits

98 coins in three weeks, most of them $2; three coins decide the money, so every money figure is shown with and without them. Comparisons by group
are small (n of 9 to 30) except where stated. The hourly candles come from the coin's current pool: before a pump.fun coin graduated its curve
trades are not in them. A coin bought twice (the best winner was) is one line in the money figures and left out of the exit-rule comparison. The
exit-rule figures assume small orders that fill; at $2 that is mostly true, on a thin pool at the top it is not. Nothing here predicts the next three weeks.
