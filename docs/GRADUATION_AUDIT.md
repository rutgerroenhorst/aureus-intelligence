# Graduations: why $VEIL never showed, and does the tab hide the coins that run? (2026-10-13)

The owner sent a chart of a coin that "went to about 3 million yesterday" (VEIL, a pump.fun graduation of 2026-10-12) and wrote that the system could easily have bought it very early, "50k, 70k, whatever", and asked why it was
never in the system. This page is the answer, with the numbers, the fix, and the audit it led to (does the Graduations tab's default view hide the coins that run?). Everything is read-only against the laptop database, plus
GeckoTerminal's free candles for the price path.

## 1. What happened to $VEIL

| time (UTC, 2026-10-12) | what | source |
| --- | --- | --- |
| 18:58 | pump.fun graduates it (an organic one: the creator bought 0 SOL, so not a bundled "born" launch) | the laptop's event stream, table `pump_graduates` |
| 19:01 | its PumpSwap pool is created: market cap $52K at the open of the first 5-minute candle, $84-97K by the end of it | GeckoTerminal candles (market cap = price x 1 billion tokens) |
| 19:00-19:35 | traded between about $85K and $110K | same |
| 19:40-20:00 | $109K, $154K, $203K, $241K, $258K, $307K (a person looking at the tab an hour after the graduation could have bought at about $300K) | same |
| 20:25 | jumps from $371K to $786K | same |
| 20:40-21:00 | $1.1M, $1.6M, $2.3M, $4.1M | same |
| 21:05 | the high: $4.85M. Afterwards $2-3M for hours, about $3.8M the next morning | same |
| 20:02-23:11 | the lab polls it twelve times and gets "gone" every time; the Graduations tab says "no longer listed" | table `lab_signals_ts` |

So the owner is right that it was easy to get early: for the first 35 minutes it sat at $85-110K (the first candle opened at $52K), for the first hour under about $310K, and it ran **about 55x** from the end of the first candle ($87K at five minutes) to the high.
It was **not** hidden by a rule about kinds of coins (it was not "born", not "Mayhem", not small). **The system could not read its price.**

### Why

DexScreener's batch endpoint (`tokens/v1/solana/<mint>,<mint>...`, 30 coins a call, used by the lab, the Graduations feed, the exit alerts, the Check button, the wallet sync and the dossier) answers with **one pair per coin**. For a coin that is on
many venues (VEIL ended with fifteen pools on six venues) that one pair can be the old pump.fun **bonding-curve pair**, which after the graduation has no liquidity and no price (a frozen $43K "market value" and `priceUsd` empty). The
code then read "no price" = "gone": the lab closed it as `gone` after twelve polls and a later look at "runners" never adopted a closed coin again; the tab showed it as "no longer listed"; an exit alert for a held VEIL could not have been sent
(no price); the Check button would have called it dead. The other endpoint (`latest/dex/tokens/<mint>`) lists **every** pool of the coin, and there the PumpSwap pool is plain to see (checked 2026-10-13, pool $181K, 445 trades in the last hour).
What that endpoint answered at 19:30 the evening before cannot be known now.

How common is it? `scripts/dex-pair-check.ts` over 1,430 coins (96 hours of graduations and every coin the followed wallet ever bought): 1,021 answered with a price, 2 with a pair without a price, 407 not at all; of the 409 that read as dead, exactly **one**
had a live priced pool with $1,000 or more behind it: VEIL. One coin in 1,430, and it was the biggest winner of the period. That is the typical shape of a leak: rare, and exactly where the money was.

### The fix (2026-10-13)

When the batch answer for a coin has no price, the code asks the other endpoint for that coin's pools and takes the most liquid priced pool (`apps/web/lib/dexPairs.ts`: `bestPricedPair`, `fetchAllPairs`, `rescuePair`; at most 8 such extra calls a pass, so a bug can never
turn into hundreds). In every place the batch endpoint is used: `lib/lab/lanes.ts` (the watch polls) and `lib/lab/collectors.ts` (the price tail), `lib/graduateFeed.ts` (the Graduations feed), `lib/coinCheck.ts` (the Check button; and the pool age line), `lib/walletSync.ts`,
`lib/dossier.ts`, and `apps/worker/src/exitLoop.ts` (`dexQuotes`, the exit alerts). In the lab a coin that was closed as `never_listed` or `gone` is **re-adopted as a runner** when Jupiter's lists carry it again with real liquidity. Tests: `apps/web/lib/dexPairs.test.ts` (7),
and a rescue case in the Check, the exit loop and the lab tests. A live Check of VEIL after the fix: pool on PumpSwap, $181K, +8,361% in 24 hours, "this system never scanned it" noted.

## 2. Does the default view hide the coins that run?

`scripts/lab-graduate-audit.ts` (written down before looking): every graduation the laptop's stream recorded (10 to 12 October), the tab's own rule applied to the **first hour's** readings only (what a person looking at the tab an hour after the
graduation would have seen), and what the coin did: the highest level the price **held** (half an hour, several readings) within 24 hours of the first reading, as a multiple of the first reading.
**Corrected 2026-10-16:** the first version (867 coins) called a window "over" when the latest reading of any coin was 25 hours past the first reading; the laptop sleeps and the lab daemon stops for hours, so coins whose readings had a hole in their day
were counted. A coin now counts only if the readings ran throughout its 25 hours (a gap of more than 6 hours in everybody's readings ends the horizon): **300 of the 1,258 graduations**. The conclusions did not change; the intervals are wider.

| group (what the default view said after the first hour) | coins | held 2x | held 5x | held 10x | median multiple |
| --- | --- | --- | --- | --- | --- |
| all | 300 | 8% (24) | 2% (7) | 1% (3) | 0.36x |
| **shown** | 47 | 13% (6) | 4% (2) | 2% (1) | **0.99x** |
| born (graduated within 2 minutes of launch with a creator buy of 50 SOL or more) | 105 | 12% (13) | 2% (2) | 0% | **0.01x** |
| Mayhem Mode | 31 | 3% (1) | 3% (1) | 3% (1) | 0.27x |
| empty (first pool reading under $1,000) | 67 | 6% (4) | 3% (2) | 1% (1) | 0.46x |
| drained | 3 | 0% | 0% | 0% | 0.05x |
| small (pool under $5K) | 47 | 0% | 0% | 0% | 0.13x |

**Read this table with care.** The "empty" and "Mayhem" rows hold the biggest "runners" (22x, 19x, 8x): every one of them started from a pool of $10 to $26, a base price that is not a price anyone could pay. Nobody could have bought those. Restricted to coins whose first pool reading was
at least $5,000 (175 of the 300, the runs a person could actually have bought):

| group | coins | held 2x | held 5x | held 10x | median multiple |
| --- | --- | --- | --- | --- | --- |
| all | 175 | 10% (18) | 2% (4) | 1% (1) | 0.13x |
| shown | 44 | 11% (5) | 5% (2) | 2% (1) | 0.99x |
| born | 104 | 13% (13) | 2% (2) | 0% | 0.01x |
| drained / small | 3 / 24 | 0% / 0% | 0% / 0% | 0% / 0% | 0.05x / 0.08x |

- Of the 18 buyable coins that held 2x, **13 (72%) were hidden** by the default view, all of them "born"; of the 4 that held 5x, 2 were hidden (both born); the only 10x was shown.
- The hiding is **justified on average** (the median born graduation ends at 0.01x of its first reading, the median shown one at 0.99x), **but about one in eight born graduations did double** in the first day.
- For a buyer one hour later the picture changes: 62 born graduations were still alive an hour after their first reading (and were followed for another day), and **none** of them doubled again (0 of 62); the shown group still doubled 13% of the time (4 of 31).

So the rule "hide the kinds that mostly drain" costs the runs of the first hour for a few born coins, and nothing for a buyer an hour later. The Graduations tab now has a yellow strip, **"Hidden, but running now"** (a hidden coin that has doubled or more since it was first seen, with a pool of
$20K or more, at most 12 hours old, at most five of them, with what it was hidden for), so a run in a hidden kind is visible without switching the hiding off. It is not a signal: look, then Check.

## 3. What this does not fix

- The Radar tabs (Hot, CATE, Buy Signals, Ultra Momentum, ...) only admit a pool once it is 60 minutes old and up to $150K market cap. VEIL was at about $307K an hour after its pool opened, so it would not have been on those tabs anyway. **The Graduations tab is the only place
  for a coin like this**, and it only shows what the stream or the chain feed has seen.
- The laptop's event stream records the graduation within seconds; the hosted chain feed reads the migration authority every 3 minutes (docs/GRADUATIONS_FEED.md). Neither is a buy signal.
- Coins that DexScreener does not list at all (a new pool it has not indexed yet) are still unpriced for as long as DexScreener does not know them.
- The audit's sample is three days; the forward test (docs/EXIT_PRACTICE.md, section 5) looks at coins first seen after 2026-10-13.

## Re-running

```
corepack pnpm exec tsx scripts/lab-graduate-audit.ts     # read-only, laptop database, about a second
corepack pnpm exec tsx scripts/dex-pair-check.ts --hours 96 --wallet     # how often does the batch endpoint hand back a pair without a price
```
