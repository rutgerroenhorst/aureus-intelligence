# Graduations without the laptop: the chain feed

Written 2026-10-12 after the user asked why the Graduations tab only works while the laptop is on, and whether it could run 24/7 from the site itself.

## Why it was laptop-only

The tab needs to know about every pump.fun graduation (a coin that fills its bonding curve and moves to a real pool on PumpSwap), at the second it happens. The only free source that
*pushes* that is PumpPortal's websocket (`subscribeNewToken`, `subscribeMigration`, docs/DATA_SOURCES.md). A websocket has to be held open by a process that never stops; a Vercel function
lives for a few seconds per request, so the stream could only be held by the laptop (`apps/worker/src/pumpFeed.ts`, one connection guarded by a database lock). When the laptop slept (it did for
hours: 09:08 to 20:31 UTC one day) nothing was recorded, and the hosted tab showed a snapshot the laptop had pushed, with a warning that it was old.

Every other tab does not use the stream. Their coins come from **polled** HTTP sources (DexScreener's profile/boost/pair lists, Jupiter's lists, GeckoTerminal's trending and new pools) which the
site's own scanner asks every ~10 minutes; that works from a serverless function. The stream was needed for two things only: the exact second of the graduation, and what the creator did at launch
(how much they bought, whether it is a Mayhem Mode coin), which decides the coin's *kind* (born graduated / Mayhem / organic).

## How it works now (no websocket, no laptop)

`apps/web/lib/graduateFeed.ts`, run every 3 minutes by the database's own clock (pg_cron job `aureus-graduates`, `scripts/cron-setup.ts`) calling `/api/cron/graduates` (same secret as the other jobs):

1. **The list of graduations is on the chain.** pump.fun's migration authority (`39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg`) signs every migration and signs nothing else, so
   `getSignaturesForAddress` on that one account *is* the list of graduations, in order, with block times. Public RPC endpoints (PublicNode first, the official one as fallback) serve it for free.
   The feed remembers the newest signature it handled and asks only for what came after it (at most 30 transactions per tick; a longer backlog is worked off over the next ticks; a transaction that
   cannot be read stops the tick and is retried next time, so nothing is skipped).
2. **Each migration transaction says which coin it was**: the instruction on pump.fun's program (`6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`) has the authority as account 1 and the mint as account 2.
   Searchers re-send identical migrations; the feed keeps the first copy of each mint.
3. **Who created it and what they bought** (needed for "born graduated"): the bonding curve is the owner of the largest pre-migration token balance in the transaction; the creating transaction is the oldest
   signature of that curve; the creator's launch buy is about (SOL spent minus 0.02) divided by 1.01. Only coins that graduated within 2 minutes of launch need this (the others cannot be "born graduated").
4. **Names, supply, launchpad, creator, audit and trading numbers** come from one Jupiter call for up to 50 mints (`lite-api.jup.ag/tokens/v2/search?query=a,b,c`): name, symbol, `createdAt`,
   `graduatedAt`, `totalSupply` (2 billion = Mayhem Mode), the dev wallet, mint/freeze authority, holders, the 5-minute to 24-hour windows with price change and buy/sell counts. DexScreener's
   `tokens/v1` is the fallback for the market numbers. (Many launchpads copy pump.fun's "...pump" ending, so the mint's suffix is not used to decide anything.)
5. **A compact record per coin** is kept in `pump_graduates.facts` (migration 0039, additive: columns `via` and `facts`; chain rows have `via = 'chain'`, the laptop's stream rows `'stream'`):
   the first reading, the peak liquidity, the highest price, the reading about an hour in, and the newest reading with its windows. Young coins are re-read every tick, coins under 90 minutes every
   third tick, and of the last day only those still standing (and not hidden by default) every tenth. Rows older than 4 days are deleted.
6. **One writer at a time**: the lease `grad-feed` in `scan_lease`; a tick that finds it held does nothing.

`apps/web/lib/graduates.ts` builds the tab from these rows the same way as from the stream's: the kind (born graduated = created-to-migrated under 2 minutes and a creator buy of at least 50 SOL;
Mayhem; organic), healthy or drained, the one-hour verdict. Where the creator's buy could not be read it is assumed to be 100 SOL for a coin that graduated within 2 minutes (it cannot be less), which is
what makes it "born".

## Which source the tab shows

In this order (`currentGraduates`): the stream's own rows when this process has them (the laptop) → the snapshot the laptop pushed, if it is **at most 8 minutes old** (it pushes every 3 minutes while awake) → the chain rows (the last 6
hours) → an older pushed snapshot (with the warning). So with the laptop awake nothing changes (the stream has the exact second and everything the lab learns from); when it sleeps, the site takes over
within 8 minutes of the laptop going quiet (it was 20 minutes until 2026-10-12 evening, which left a phone looking at a frozen list), and the tab says which source it is reading and how old it is ("Read from the chain every 3 minutes by the site itself (no laptop needed)").

## Checked against the stream

On 2026-10-12, over the same hours, the chain feed found 177 graduations where the laptop stream (asleep for part of that time) had 7. For the graduations both saw, the kind and the creator's buy
matched, and the chain feed also knew launch times the stream had missed (it reads the launch from the curve, the stream only if it was connected at the time). Note that this is one
comparison on one day; the feed is simpler than the stream in one way (it never sees a launch that did not graduate), which is fine for this tab and not for the lab's launch tables, which stay
on the stream.

## What it costs (free plans)

Measured live: the first tick after deployment (23 graduations to catch up) took 7.0 s and 360 ms of CPU; the next 14 ticks (the clock keeps the answers for 6 hours; 1.4 new graduations a tick on average,
about a dozen coins re-read) averaged **0.6 s of running time and 71 ms of CPU** (at most 0.9 s and 182 ms). Every 3 minutes that is 480 calls a day: about 34 s of CPU a day (about 0.3 hours a month of
Vercel's 4), about 5 minutes of function time a day (a few GB-hours a month of the 360), 14,400 invocations a month of the 1,000,000. The feed adds its CPU to the day's budget (`addUsage`). It asks the free public Solana RPC for one list and a few transactions per tick, Jupiter
once per 50 coins and DexScreener once per 30 coins (plus, since 2026-10-13, one call of the all-pools endpoint for the rare coin whose batch pair has no price, `lib/dexPairs.ts`, docs/GRADUATION_AUDIT.md). Database reads are small: the due list is a few dozen rows of a handful of numbers (see docs/LIMITS.md for the measured size).
Stopping it: `select cron.unschedule('aureus-graduates')` in the hosted database (or `scripts/cron-setup.ts remove`, docs/RESTORE.md); the tab then goes back to the laptop's snapshots.

## Limits, honestly

- The feed sees a coin at most 3 minutes after it graduated, not at the second (the block time is exact, the first look is not). The first minutes of a graduation, where most of the damage happens,
  are therefore a coarser record than the stream's. For deciding what to look at that is enough; for the lab's study of minute-by-minute behaviour the laptop's stream remains the source.
- It depends on free public RPC endpoints (rate limited, now and then slow). A refused call is retried against the other endpoint, and an unreadable transaction is retried at the next tick.
- If pump.fun ever changes its migration instruction or authority, the feed finds nothing new (and says so in its lease row); the tab then falls back to the laptop's snapshot with the warning.
- Every migration the authority signs is kept as a row; what shows on the tab is decided by the tab's existing filters (real pool, still standing, not born graduated or Mayhem), exactly as for the stream's rows.
