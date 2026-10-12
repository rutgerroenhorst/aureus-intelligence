# The Check button: "this coin is dead or does not belong here"

Added 2026-10-11 at the user's request: a coin on a Radar tab that is dead or not where it belongs should be one press away from a second look, the system should
learn from it, never just agree, and tell the user when a coin comes back on the tab. Extended 2026-10-12 (more checks, and the answer now does something to the list).

## What it does

Every coin card has a small **🔍 Check** button (next to Enter and DexScreener; on every tab with coin cards: Hot, CATE, Buy Signals, Ultra Momentum, Elite, Incubation, Runners, Graduations). Pressing it:

1. **Looks at the coin again right now** and shows every check it ran, one line each, marked ✓ (fine), ⚠ (warning sign), ✗ (serious) or – (could not be checked, with the reason):

   | Check | Source | Marked ⚠ / ✗ when |
   |---|---|---|
   | pool | DexScreener's best pool | ⚠ under $5K, ✗ under $1,000 |
   | trades in the last hour | DexScreener | ⚠ under 10, ✗ none (with almost no volume in the day) |
   | 24 h volume | DexScreener | ⚠ under $3K |
   | 24 h move | DexScreener | ⚠ down 70% or more |
   | buying against selling | DexScreener (20+ trades) | ⚠ selling outweighs buying 3 to 1 |
   | **test sale** | Jupiter's quote for selling about **$5** of the coin into USDC, now: does a route exist, and what price impact does the router report | ⚠ the sale would move the price 3% or more, ✗ 10% or more, or **no route at all** |
   | **mint and freeze authority** | RugCheck, Jupiter's audit as the second opinion | ✗ the creator can still mint more coins or freeze wallets |
   | **rugged** | RugCheck | ✗ marked as rugged |
   | **holders** | RugCheck (largest wallet, linked "insider" wallets); Jupiter's top-10 share when RugCheck has no report | ⚠ one wallet holds 25% or more, ⚠ insiders hold 20% or more, ⚠ top 10 hold 60% or more |
   | liquidity lock | RugCheck | ⚠ less than 50% of the liquidity locked or burned |
   | the creator | Jupiter's audit, RugCheck | ⚠ still holds 20% or more, ⚠ has rugged before; **ℹ its wallet has minted 50+ tokens: shown, not counted** (see below) |
   | **this system's own record** | our database (`prices`, `liquidity_snapshots`) | ⚠ price 80% or more below the highest this system recorded, ✗ 95% or more; ⚠ liquidity under 20% of its recorded peak |
   | the Hot tab's own rule | the tab's simple "new and small" rule | ⚠ no longer fits |

   Only on Solana: the test sale, RugCheck, Jupiter's record and our own record know nothing of the other networks, so on those the lines say "not checked: only on Solana" instead of passing silently.
   A coin that is dead on DexScreener's numbers alone (no pool, a pool under $1,000, or no trades and no volume) is not run through the others: it needs no more proof.
   The coin's decimals (needed to size the test sale) come from Jupiter's record, or from the chain (`getTokenSupply`) when Jupiter does not list the coin. A source that does not answer is asked a second
   time after 0.7 s; if it still fails the line says which part failed (it never says "Jupiter does not know the coin" when the truth is that Jupiter did not answer).
2. **Answers under the card, and does not just agree**: a *serious* finding (✗), or a dead coin, or **two or more** warning signs: "you are right" / "you have a point", with the reasons; *one* warning
   sign: "not sure"; *none*: "I do not agree: the coin is alive and passes the N checks I could run (not checked: ...)". When DexScreener cannot be reached it says so and records nothing (a doubt that
   was never looked at is not kept).
3. **Keeps the check** (`coin_checks`, migration 0038): coin, tab, the numbers and every line (`snapshot` = `{fresh, checks}`), what the site concluded. A double press, or a second device, within a minute gets
   the same answer and one row.
4. **Takes the coin off that tab when the site agrees** (new 2026-10-12; `lib/checkAway.ts`): a coin the site judged dead or seriously wrong leaves the list for 24 hours, or until the tab lists it again
   after the check (a new qualification), whichever comes first. The line above the list says how many coins were left out and has a "Show them" switch. A card whose answer is still open stays on screen
   until the answer is closed. The tab counts and the CATE tiles count what the list shows. **Only the site's own verdict hides a coin**: pressing Check on a healthy coin ("I do not agree") or on one with
   a single warning sign ("not sure") changes nothing, so the button cannot be used to clear a list. Nothing about a tab's own filters is changed.
5. **Learns, critically** (Learning > "Your checks", `lib/lab/reports/checks.ts`): each checked coin is matched to the lab's snapshot closest to the check and compared with the lab's other coins of
   the same age, with the same test as the tabs and "Your own entries": did the coins you doubted really lose half within a day more often? If not, the page says "no difference" or "they do
   better". Your doubt is a hypothesis until the outcomes agree with it. **No filter is ever changed automatically**: that would need this evidence first.
6. **Tells you when a coin is back**: a card whose coin was checked before shows "🔍 Checked · 2 d ago (you doubted it, the site agreed)", and "↩ Back on this tab … the tab listed it again" when
   the learning system has since written a new qualification for that coin on that tab (`coin_qualifications`; only the Cate, Buy Signals, Ultra Momentum, Elite and Incubation tabs keep such a
   record: for Hot, Runners and Graduations the note says only that the coin was checked, and a coin left out comes back after 24 hours).

## How the page keeps this together

- `apps/web/app/radar/CoinCheck.tsx`: the hook, the button, the answer, the badge; a `CheckHub` context lets any card tell the page that a check came back or that its answer was opened or closed.
- `apps/web/app/radar/page.tsx`: merges the saved notes (`/api/radar-bundle` → `checks`) with the checks made on this screen (so a coin leaves the list at once, not at the next 30 s refresh),
  splits every list into "shown" and "left out" with `leaveOut` (`lib/checkAway.ts`, unit tested), and renders the "left out" line.
- The cards are components of their own (`CoinRow.tsx`, `UltraCard`, `HotCard`, `Row`, `GraduateCard`) and the tab buttons too, with keys by coin address: a component defined *inside* the page is a new
  component on every render, so the 30-second refresh threw away what a card remembered (the answer of a Check, a half-finished Enter) and lost clicks that landed during a render.
- The Hot tab stays on the network the user is looking at when the ranking changes (it used to switch to whichever network became hottest, under the click).

## Calibration (2026-10-12)

Run read-only over the 42 coins the hosted Radar listed that morning (`elite`, `cate`, `buy_signals`, `runners`, `graduates`, `ultra_momentum`), with the real sources. First version: **agree 15 (36%), not sure 14, disagree 13**:
"the creator's wallet has minted 50+ tokens" fired on 17 of the 42 coins (up to 191,441 tokens: launch tools mint thousands of tokens from one wallet, and Jupiter's count cannot tell a launch tool from a serial
launcher) and "insiders hold 10%+" on 8; together they supplied the second warning sign for most of the 15. Changes: the mint count is **shown but not counted** (state `note`), and the insider line moved
from 10% to 20%. Second run: **agree 8 (19%), not sure 10, disagree 24**; the 8 agreements are coins with a pool under $1,000, mint and freeze authority still open, no trades with one wallet holding 60%, or a
pool under $5K that fell 91%. These lines are hypotheses: the Learning page grades the verdicts against how the coins end, and the numbers should be re-run when it has enough checks to say.
Re-run it (read-only, writes nothing, about two minutes): `corepack pnpm exec tsx scripts/check-calibration.ts` (add `LAB_SYNC_URL=<hosted connection string>` to include this system's own record of each coin).

The test sale was first judged by the dollars the quote brings in against $5. That was wrong, found by looking at the three fresh graduations it flagged ("a $5 sale would lose 19-28%"): the loss was the
same at $0.50, $1, $5 and $20 and the router's price impact was 0.1-0.2%, so it was not depth or a tax but DexScreener's price differing from Jupiter's by 10 to 30% on fast-moving young pools (DexScreener
lags). The test now judges only whether a route exists and the price impact the router reports (the quote's own figure, so no second price is involved). A sale-tax token is not caught by it: a quote does not
include a tax a token charges on transfer.

## Limits, honestly

- It measures the **coin**, not the tab's own rules: the tabs have long, different filters and they are not re-run. "Does not belong" is therefore judged by the coin's health (and, on Hot, its simple
  rule), not by the tab's score.
- The thresholds are fixed lines (the $1,000 pool is the line the lab and the wallet review already use for "no real pool"); a coin can pass them and still be bad, and a young honest coin can trip two
  of them. The answer is an opinion, not a verdict. The test sale is a quote at one moment for $5: it shows a coin that cannot be sold or that loses most of a small sale, not what a large sale would do.
- RugCheck and Jupiter are free services that are sometimes busy; a line then says "not checked" with the reason, and a repeat within a minute returns the same answer (the cap and the cache are what keep
  the free services from being hammered).
- The site is public and every check asks DexScreener, Jupiter (twice), RugCheck and the database, so the whole site does at most **15** checks a minute (Jupiter's free API allows about 60 requests a
  minute), and the input must be a token address of a known network on a known tab.
- "Your checks" needs coins with a decided 72-hour window (about three days) and only knows coins the Radar admitted; with a handful of checks it will say "too few coins to say".
- Pressing Check on a coin you think is *good* is not what this is for; there is no "I like this" button.
- Test presses count as the user's doubts in Learning: delete them from `coin_checks` after trying it (local and hosted database).
