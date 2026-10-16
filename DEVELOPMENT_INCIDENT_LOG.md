# Development Incident Log

## Data Loss: 2026-09-11

### Timeline

**Phase 1 Validation (Earlier)**
- Baseline: ~1,284+ candidates in database
- V2 snapshots: ~1,284+ records
- Model: v2.0-conservative-allowlist.2
- Status: Validated configuration

**Reset #1: Volume Deletion (During Session)**
- Command: `docker compose down -v`
- Effect: Deleted persistent PostgreSQL volume
- Impact: Complete loss of Phase 1 candidate dataset
- Recovery: None available (no backups)

**Reset #2: Unsafe db:test-reset (Later in Session)**
- Command: `corepack pnpm db:test-reset --target-db=test`
- Actual target: aureus database (not a separate test DB)
- Effect: Reset replacement development database
- Impact: Fresh post-migration state (5 candidates initial seed)
- Root cause: Safety guard was only a CLI flag, not database routing

### Current Database State

```
Database:    aureus
Volume:      aureus-intelligence_aureus_pgdata
Candidates:  6
V2 scores:   0 (reset)
Baseline:    Fresh post-migration
```

### Corrective Action

Implemented `db:test-reset-safe.ts`:
- Parses actual DATABASE_URL before destructive action
- Refuses unless target database ends in `_test`
- Never touches canonical `aureus` database
- Hard safety checks prevent future incidents

### Historical Record

This incident serves as a record that:

1. Original ~1,284 candidate dataset is NOT recoverable
2. Current development database is a fresh post-migration baseline
3. Counts before this date are archived history, not current system state
4. Database safety guards have been strengthened

### Development Implications

- All development work proceeds from fresh baseline
- No legacy data references available
- Wallet intelligence features will be built with current limited data
- Forensics will display current fresh schema state

---

## Missed Winner: 2026-10-12 / 2026-10-13 ($VEIL, a graduation that ran about 55x)

### What happened

- The pump.fun event stream recorded the graduation (2026-10-12 18:58 UTC). Every price lookup in the system (lab watch, Graduations feed, Check button, wallet sync, dossier, exit alerts) uses DexScreener's batch endpoint, which answers with ONE pair per coin.
  For a coin on many venues that pair was the old bonding-curve pair, which has no price after the graduation. The code read "no price" as "gone": the lab closed the coin after twelve polls, the Graduations tab said "no longer listed", and `discoverRunners` never re-adopted a closed coin.
- The coin traded at $85-110K for 35 minutes and under $310K for the first hour, then reached $4.85M. The owner saw it on someone else's screen the next day and asked why the system never showed it.

### Impact

- One coin in 1,430 checked (`scripts/dex-pair-check.ts`), but the biggest winner of the period. A held coin like this would also have produced no exit alert, and the Check button would have called it dead.

### Corrective action

- `apps/web/lib/dexPairs.ts` (ask the all-pools endpoint for a coin whose batch pair has no price, at most 8 times a pass) used in all seven places; the lab re-adopts closed `never_listed`/`gone` coins as runners; a "Hidden, but running now" strip on the Graduations tab; tests for every place.
- Details and the audit it led to: `docs/GRADUATION_AUDIT.md`.

### Lesson

- A silent "no data" is not "dead". When a source answers with something unusable for a coin that other sources know, fall back to the source that lists everything, and measure how often it happens before deciding it does not matter.
- An early explanation ("hidden because it was a born coin") was wrong; the data said otherwise (`organic`, twelve "gone" polls). Check the record before telling the owner why.

## Wrong Research Numbers: 2026-10-13 (decided-window bias)

### What happened

- The first exit-research numbers of the day (told to the owner in chat: "the more is sold at the first alert the better", "all out at 2x +7 points") rested on coins whose outcome was "decided" when they were last read. A coin that died is decided at once; a living coin only after 72 hours. The newest
  318 of 1,479 coins were therefore mostly dead ones, which made selling early look good.
- A second misreading: "74% lose half at the first look" was taken to mean the moment of graduation; the lab's first look is at a pool age of about 1.3 hours.

### Corrective action

- Both claims were withdrawn to the owner in chat and in the documents. Everything was redone on coins whose entry plus 72 hours was over by the latest reading (`MATURE` filter in `scripts/lab-exit-practice.ts` and `scripts/lab-alert-ladders.ts`; `MATURE=0` restores the old behaviour); the entry-timing table was redone on the pool's age (`docs/EXIT_PRACTICE.md`).

### Lesson

- Any statistic over "decided" outcomes needs a maturity filter on the entry time, or recent cohorts are biased towards the quick deaths. See `docs/EXIT_PRACTICE.md`, section 0.

## Invisible Purchases: 2026-10-13 (the wallet decoder)

### What happened

- The owner said that 88 payments of mostly $2 were purchased coins and asked why the system could not see them. A screenshot of their trading app (found with it: 15 entries) was matched against the wallet journal by time, amount and price: most entries were in the journal, but two were stored only as unpriced "received" tokens.
- Cause: `decodeFills` treated every transaction in which two coins arrived as two plain transfers. A gasless $2 swap can leave a crumb of a second token (0.00001 to 6 tokens) next to tens of thousands of the coin bought, so **17 purchases (16 coins, $62, 13 of them in the last week, one of $15) had no price paid, no position, no exit alert and no place in the wallet reviews**.
- The 88 payments themselves are a different thing: deposit orders into a shared account for purchases on other networks (a BNB Chain coin was identified by matching the price at two moments); they deliver nothing to this wallet and stay invisible until the owner's address on those networks is known.

### Corrective action

- `decodeFills` reads the coin that is at least 1,000 times larger than the other (the 17 cases: 8,000 to 4 billion times) as the coin traded; similar sizes stay unpriced. Four new tests. `scripts/wallet-redecode.ts` re-read and replaced the 17 transactions in both databases and updated the journal. The wallet review was redone (216 coins, 0.58x instead of 200 coins, 0.61x) and the numbers given to the owner earlier the same day were corrected in `docs/WALLET_REVIEW_2.md`.

### Lesson

- Everything built on "the wallet's buys" (alerts, reviews, journal) inherits the decoder's blind spots; a screenshot of the owner's own app is the cheapest independent check. A silent fall-through to "unpriced transfer" is a data hole: count what falls through (82 transactions had an "in" row; 17 of them were real purchases).

## Rugged And Held-By-Insiders Coins Stayed On The Tabs: 2026-10-16

### What happened

- The owner kept seeing coins that had rugged ("it stands at $3 or $4K and is still there"), collapsed, or stopped trading, and later coins whose card said "insider networks hold 99%". Every tab judged a coin once, when it qualified: a graduation was "healthy" after a good first hour for good, a signal stayed a signal until the next scan, a runner kept a minute-old reading.
  An independent live check (`scripts/redflag-audit.ts`) found **37 of the 154 coins shown by default** carrying a severe flag at that moment (Graduations 14 of 23).
- A second cause: DexScreener's batch answer holds one pair per coin, and for a graduated coin it can be the old bonding-curve pair, frozen at the curve's last price with no liquidity figure; two graduations showed $43K while their live pool stood at $2.3K.
- The holder flags were warnings on a card, and the first count of them on the tabs was wrong: the "largest wallet" of 30 of the 35 coins with a 20% flag was a program account (22 pump.fun bonding curves, 4 pools, 4 others), so the old card line "one wallet holds N%" had been a false alarm for most coins since it was written.

### Corrective action

- `lib/redFlags.ts` (the rules), `lib/liveQuotes.ts` + `lib/liveGate.ts` (every list judged on the coin as it is now, failing open), `lib/dexPairs.ts` `needsRescue` (the stale curve pair, in seven places), `lib/holderFacts.ts` + `lib/solanaKeys.ts` (RugCheck's holder shares, program accounts left out by the ed25519 curve test, kept 30 minutes in memory and in one database row),
  the Graduations tab's new hidden reasons, `scripts/redflag-audit.ts` (independent check: market and holders). 37 of 154 became 0 of 130 on the market rules; the holder rules hide the coins the audit reports. Details: `docs/RED_FLAGS.md`.

### Lesson

- A judgement made once at qualification is a stale judgement: re-judge on what the coin looks like when it is shown, and keep an independent audit that does not use the gate's own data path.
- A warning that has never been checked against ground truth can be wrong for most of the coins that carry it. Before turning a warning into a block, count what it fires on (here: the largest "wallet" was usually the coin's own bonding curve) and keep the evidence next to the rule.

