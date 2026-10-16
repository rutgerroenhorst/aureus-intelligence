# Red flags: a coin that has rugged or fallen apart does not stay on a tab (2026-10-16)

The owner: coins with red flags keep passing on the tabs ("it has rugged and stands at $3 or $4K and it is still there", chart patterns, all kinds), and they should be blocked for good.

## What was wrong

Every tab judged a coin once and never again. A graduation was "healthy" when its first hour looked fine and stayed so for good (`lib/lab/pump.ts isHealthy`: not born, not Mayhem, not empty, not drained, a pool of $5K or more in the first hour). A buy signal stayed a signal until the next scan,
a runner stayed a runner with a reading that could be hours old. A pool only counts as drained after it has fallen under $5K *and* under 10% of its own peak, and on a constant-product pool the pool value follows the square root of the price, so a coin can lose 90% of its price with a "standing" pool.
Measured on the live site on 2026-10-16 (`scripts/redflag-audit.ts`, every coin checked independently against all of its pools at DexScreener): **37 of the 154 coins shown by default carried a severe flag at that moment**: Graduations 14 of 23 (61%), Runners 18 of 60 (30%), Buy Signals 3 of 30, CATE 1 of 9, Elite 1 of 18.

A second cause, found while looking: DexScreener's batch answer holds ONE pair per coin, and for a coin that has graduated it can be the old pump.fun bonding-curve pair, frozen at the curve's last price with no liquidity figure. Two graduations were shown at $43K ("liquidity -") while their live PumpSwap pool stood at **$2.3K**
(rugged). The earlier fix for $VEIL (lib/dexPairs.ts) only asked for the other pools when the pair had no price at all; now `needsRescue` also covers a priced bonding-curve pair (`isCurvePair`: `dexId` "pumpfun"), everywhere the batch answer is used: this gate, the Check, the lab's two collectors and watch polls, the chain feed, the wallet journal and the exit alerts' prices
(a stop that watches the curve's frozen price never fires).

## The gate

`lib/redFlags.ts` (pure rules), `lib/liveQuotes.ts` (one DexScreener call per 30 coins, kept for a minute, the other pools asked for the rare stale pair), `lib/liveGate.ts` (splits a list into the coins that stand and the coins left out, with their reasons).
Every coin a list is about to show is looked at as it is now. A coin whose numbers could not be read is **kept** (failing open: the gate never empties a list because DexScreener was busy).

| flag | rule (all on the numbers of today) | words on the line |
| --- | --- | --- |
| no pool | DexScreener lists no priced pool, after asking for every pool of the coin | "no live pool: nothing to buy or sell" |
| drained | pool under $5,000 | "pool drained: $700 left" |
| tiny cap | market cap under $10,000 | "market cap only $3.4K" |
| collapsed | down 50% in the last hour, 70% in six or 80% in a day; or (graduations, runners) below half of the price when first seen, or below 35% of its high (the lab's "fallen apart" line, `lib/lab/reports/common.ts isStanding`), the row's numbers moved to today's price | "collapsed: down 81% in 6 hours" |
| pump that turned | up 300% in a day and down 40% in the last hour | "pump that turned: up 450% in a day, down 42% in the last hour" |
| being dumped | 30 trades or more in the hour, sellers at least 3x the buyers, price down 20% or more | "being dumped: 80 sells against 20 buys" |
| no trading | fewer than 5 trades in the last hour, for a pool older than 15 minutes | "no trading: 1 trade in the last hour" |

Why these: each is either mechanical (nobody can buy or sell there; a rug looks like this: the price stands still and the pool is gone) or measured (coins that had already fallen apart doubled half as often as the ones that stood: 8-10% against 16-18% at +1 h to +12 h, 315-805 coins per age, `docs/FILTER_FEEDBACK.md`).
The thresholds are `LIMITS` in `lib/redFlags.ts`; the tests (`lib/redFlags.test.ts`) pin every one of them.

**What is deliberately NOT a hiding flag:** the stories about who holds a coin: one wallet at 24%, linked wallets, a serial creator, a pool that is not locked, "graduated within 2 minutes". They stay as warnings on the card. Among the graduations that were not "born" (264, first pool $5K or more) the coins that carried
one of them did **not** do worse than the rest (10.8% held 2x against 7.7%; 61% down by half after a day against 75%), and the owner's best graduation (6.8x, 21x at its peak) carried two of them ("one wallet holds 24%", "liquidity not locked"): a rule that hid them would have hidden it. If the owner wants them hidden anyway, that is a one-line rule to add.

## Where it applies

- **Graduations** (`lib/graduates.ts liveGateGraduates`, inside `currentGraduates`, so also Home and the coin dossier): every coin shown by default is looked up; the numbers on its card are replaced by today's (mcap, pool, 1 h change, since first seen); a flagged coin moves to the hidden ones with the reason on its card
  (new reasons "collapsed", "dead" next to "drained", "no longer listed"); the tab's own "Hidden: ..." line counts them and "Everything" still lists them.
- **Buy Signals, CATE, Elite, Incubation, Ultra Momentum, Runners** (their routes): each gates a few more coins than it shows (45 of 30, 60 of 50, 80 of 60, ...) so that removing the wrecks leaves a full list; the coins left out come back in `flaggedOut` with their reasons and the page says
  "N coins left out for red flags as they look right now (...)" with a "Show them" switch (`FlaggedLine`).
- **Hot** (the page, `HotChains.tsx isNewSmall`): the same rules on the pool numbers the list already carries (no extra call). The "All pools" view stays everything.
- Not gated: the legacy pages (`/radar-optimized` and its routes) and the base `candidates` list (the tabs above are built from it and gated downstream).

Cost: five to seven DexScreener calls of 30 coins per minute while a Radar is open (the bundle is kept for a minute on the site, the quotes for a minute), no database. Off switch: `RED_FLAGS_LIVE=0` in the environment (a deployment applies it); the tests run with it off unless they hand in a fake exchange.

## Checking that it holds

`corepack pnpm exec tsx scripts/redflag-audit.ts [--local]` asks the site what each tab shows by default and checks every coin against ALL of its pools at DexScreener, independently of the gate. Before the gate: 37 of 154. After the gate it should say 0 on every tab; a coin above zero is one the gate let through
(a minute of lag is normal). Run it when a red-flag coin is seen again; the rules are in one file.

## Limits

DexScreener numbers only: a coin that cannot be sold (a honeypot) or whose creator can still mint shows nothing here; the Check button (test sale, RugCheck, Jupiter's audit) is where those are read, on request. "Chart patterns" are the four changes DexScreener gives (1 h, 6 h, 24 h and the trades of the hour)
plus the lab's own history of a coin; real candle patterns (a staircase of bots, a one-candle spike) would need an OHLC call per coin and are not read. A rug that happens between two refreshes shows for at most the minute the answer is kept.
