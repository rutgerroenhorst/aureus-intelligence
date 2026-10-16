# Red flags: a coin that has rugged, fallen apart or is held by insiders does not stay on a tab (2026-10-16)

The owner: coins with red flags keep passing on the tabs ("it has rugged and stands at $3 or $4K and it is still there", chart patterns, all kinds), and they should be blocked for good.
Later the same day, after seeing "insider networks hold 99%" on the card of a coin that was still listed: every coin with a red flag on who holds it or what its wallets do is not wanted at all ("holders or wallets or whatever"). That is the second half of this document ("Holders and wallets").

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

## Holders and wallets (the second request)

Until then who holds a coin was only a warning on the card, and only on the Graduations tab (the other tabs never showed it). Now it hides the coin, on every tab, the same way the market flags do.

| flag | rule | words on the line |
| --- | --- | --- |
| insider networks | RugCheck's networks of linked wallets hold 20% of the supply or more | "insider networks hold 99%" |
| one wallet | the largest **wallet** holds 20% or more | "one wallet holds 32%" |
| top ten | the ten largest wallets hold 60% or more | "the 10 largest wallets hold 78%" |
| the creator | the creator's own wallet still holds 20% or more | "the creator still holds 31%" |
| rugged | RugCheck marks the coin as rugged | "RugCheck marks it as rugged" |
| creator history | RugCheck lists "creator history of rugged tokens" | "the creator has rugged before" |

The thresholds are `HOLDER_LIMITS` in `lib/redFlags.ts`: the 20% the Graduations card has always warned from, and the Check's own 60% (top ten) and 20% (creator). One rule file, one place to change them.

**A wallet is an address somebody can sign for** (`lib/solanaKeys.ts`). The first count on the live tabs (56 of the 112 coins on the tabs with a holder flag, 22 of 30 Buy Signals "held by one wallet") was wrong, and it was the old card line that had been wrong all along: for **30 of the 35** coins with a largest holder of 20% or more, that holder was an account a program controls: 22 pump.fun bonding curves (20 to 25% of the supply of many graduates stays in the coin's own curve, unsellable),
4 PumpSwap pools, 4 other programs' accounts. Only 5 were wallets. A program-derived address is by construction off the ed25519 curve, so the rules count only addresses on the curve (checked against the chain: of 156 holder accounts 153 agreed with "owned by the System Program = wallet", and the other three were program-derived addresses that happen to be owned by the System Program or to have no account: the curve test was right and the ownership test wrong).
The Check's "one wallet holds N%" line and the card's old line count wallets now too.

**Insider networks are RugCheck's own figure and it is noisy**: for half of the coins that carry it (8 of 16 on 2026-10-16) it is more than the other holders leave of the supply (it double counts; 279% for one large coin), and no single large wallet of any of those 16 was flagged as an insider. It is used as it stands, because (a) it is the number the card has always printed and the owner reacts to,
(b) it predicts in the lab's data: of the 13 graduations (not "born", 264 in all, first look) whose networks held 20% or more, **none held 2x** (0 of 13, against 10% of the rest). The cost is that large community coins with airdrop-sized networks (networks of 9,000 to 32,000 wallets) are left out of the Runners tab for it; if the owner wants those back, a cap on the network's size is a one-line rule.

**What is deliberately NOT a hiding flag** (the owner can say yes to any of them; each is one line):
- the launch stories: graduated within 2 minutes, the creator bought 5 SOL or more at launch, a serial creator. Of the graduations that were not "born" (264) these coins held 2x about as often as the rest (15%, 10% and 10% against 10%) and they are 24%, 12% and 35% of all of them: hiding them would hide a third of the winners and a quarter of the coins;
- liquidity not locked (RugCheck reads 0% locked for several established coins on the Runners tab whose liquidity sits in concentrated-liquidity pools, Orca and Meteora DLMM, where there is nothing to lock in the usual sense) and mint or freeze authority still open (RugCheck lists "mint authority still enabled" for several of the Runners, mostly bridged or large coins, while Jupiter's audit says "disabled" for every coin on the tabs: the two sources disagree).

Measured on the lab's graduations that were not "born" (first look, `docs/FILTER_FEEDBACK.md`): the lab's largest-wallet and top-ten figures counted program accounts, so they say nothing about wallets; there is no evidence for or against the wallet rules, and their thresholds are the Check's own.

## Where it applies

- **Graduations** (`lib/graduates.ts liveGateGraduates`, inside `currentGraduates`, so also Home and the coin dossier): every coin shown by default is looked up; the numbers on its card are replaced by today's (mcap, pool, 1 h change, since first seen); a flagged coin moves to the hidden ones with the reason on its card
  (new reasons "collapsed", "dead" next to "drained", "no longer listed"); the tab's own "Hidden: ..." line counts them and "Everything" still lists them.
- **Buy Signals, CATE, Elite, Incubation, Ultra Momentum, Runners** (their routes): each gates a few more coins than it shows (45 of 30, 60 of 50, 80 of 60, ...) so that removing the wrecks leaves a full list; the coins left out come back in `flaggedOut` with their reasons and the page says
  "N coins left out for red flags as they look right now (...)" with a "Show them" switch (`FlaggedLine`).
- **Holders and wallets** (the same places): `gateLive` (`lib/liveGate.ts`) looks at who holds the coins that pass the market rules, and `liveGateGraduates` does the same for the Graduations default view (new hidden reason "holders", words on the card; a coin RugCheck has not read yet is judged on the lab's snapshot of it for the insider networks and the creator's history only, never on its largest wallet). The coins left out come back in `flaggedOut` with the words ("insider networks hold 99%"), and the Graduations tab counts them in its "Hidden" line.
  The "Hidden, but running now" strip on the Graduations tab shows only the kinds it was made for (born, Mayhem, small pools, no reading yet): a coin hidden for a red flag stays out.
- **Hot** (the page, `HotChains.tsx isNewSmall`): the same rules on the pool numbers the list already carries (no extra call). The "All pools" view stays everything.
- Not gated: the legacy pages (`/radar-optimized` and its routes) and the base `candidates` list (the tabs above are built from it and gated downstream).

Cost, market rules: five to seven DexScreener calls of 30 coins per minute while a Radar is open (the bundle is kept for a minute on the site, the quotes for a minute), no database. Off switch: `RED_FLAGS_LIVE=0` in the environment (a deployment applies it); the tests run with it off unless they hand in a fake exchange.

Cost, holder rules (`lib/holderFacts.ts`): RugCheck's report of a coin (free and keyless; 16 KB for the median coin, up to 2 MB for one with an airdrop-sized network; answered all 98 coins on the live tabs in 56 ms (median) to 2.9 s).
**Its limit is 15 requests in a window of about a second** (header `x-rate-limit-limit: 15`; measured: 44 requests in 4.8 s went through, with refusals only when more than 15 came inside one window). A first version with six workers asking at once was refused after 15 answers and, because a refusal stopped everything for five minutes, then stood still (seen on the local site); now requests are spaced:
one start every 130 ms for the whole instance (about 7 a second), four at a time, at most 300 a minute, 40 new coins per list. A refusal (429) stops every call for 15 seconds; three refused tries in a row, five minutes. What was read is kept 30 minutes; a fact that is late to refresh is still used for up to 6 hours, so a flagged coin does not slip back in;
a coin RugCheck does not know yet is asked again after 10 minutes, a failed call after one. Only coins that pass the market rules are looked up, new coins first, then the oldest facts; a coin that has not been read yet is kept (failing open) and is read by the next refresh.
The facts are also kept in one small row of the database (`lab_reports`, kind `holders`, about 66 bytes a coin, written at most every 2 minutes, read once when an instance starts), so a page opened after hours is judged at once for every coin seen in the last 6 hours; the hosted database sends that row once per cold start (a few KB).
An empty database reads about 45 coins in the 6 seconds one list waits and the rest on the next refreshes: for the first minutes after the first deployment (and for a coin never seen before) a coin that has not been read yet is still listed. Off switch: `HOLDER_FLAGS_LIVE=0` (also the tests' default).

## Checking that it holds

`corepack pnpm exec tsx scripts/redflag-audit.ts [--local] [--no-holders]` asks the site what each tab shows by default and checks every coin against ALL of its pools at DexScreener, independently of the gate. Before the gate: 37 of 154. After the gate it should say 0 on every tab; a coin above zero is one the gate let through
(a minute of lag is normal). The second table does the same for holders and wallets: every coin of the tabs is read at RugCheck (one call every 1.2 s, about a second a coin) and judged by the same rules, and the script ends with what the gate left out per tab (`flaggedOut`). Run it when a red-flag coin is seen again; the rules are in one file.

**What it did on the day (2026-10-16, production).** Counted with the wallet rule on the lists before the deploy: 20 of 117 coins shown by default carried a holder flag (Graduations 3 of 10, Buy Signals 4 of 30, CATE 1 of 7, Runners 12 of 50, Elite 0 of 20). After the deploy the audit reads 0 of 98 on every tab (market rules: 3, one of them a coin sitting on the 5-trades line). What the gate left out then: Buy Signals 16 (3 for holders), Runners 42 (12 for holders: eleven insider networks, one wallet),
CATE 1, Incubation 2; Graduations worth a look 9 of 62, three hidden for holders (insider networks 99% and 64%; a creator who rugged before). The owner's best graduation so far (6.8x, 21x at its peak) carried "one wallet holds 24%" on its card; that "wallet" was a program account (wallets only: 3.4%, insider networks 10%, creator 0%), so it passes the rules.
A first count with the program accounts left in, 56 of 112, is what made the wallet test necessary (see above).

## Limits

DexScreener and RugCheck numbers only: a coin that cannot be sold (a honeypot) or whose creator can still mint shows nothing here; the Check button (test sale, RugCheck, Jupiter's audit) is where those are read, on request. RugCheck's top-20 holders and its insider figure are what they are (see above); a coin it has no report for is not judged on holders. The Hot tab is not judged on holders (its other networks have no RugCheck). "Chart patterns" are the four changes DexScreener gives (1 h, 6 h, 24 h and the trades of the hour)
plus the lab's own history of a coin; real candle patterns (a staircase of bots, a one-candle spike) would need an OHLC call per coin and are not read. A rug that happens between two refreshes shows for at most the minute the answer is kept.
