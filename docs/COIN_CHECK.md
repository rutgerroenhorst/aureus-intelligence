# The Check button: "this coin is dead or does not belong here"

Added 2026-10-11 at the user's request: a coin on a Radar tab that is dead or not where it belongs should be one press away from a second look, the system should
learn from it, never just agree, and tell the user when a coin comes back on the tab.

## What it does

Every coin card has a small **🔍 Check** button (next to Enter and DexScreener; on the Runners, Graduations and Hot tabs as well as the others). Pressing it:

1. **Looks at the coin again right now** (DexScreener's best pool: liquidity, 24 h volume, trades in the last hour, price change; `apps/web/lib/coinCheck.ts`).
2. **Answers under the card, and does not just agree**:
   - *dead* (no pool listed, a pool under $1,000, or no trades for an hour with under $1,000 of volume in a day): "you are right, it is dead";
   - *two or more warning signs* (pool under $5K, under 10 trades in the last hour, 24 h volume under $3K, down 70% or more in 24 hours, selling outweighing buying 3 to 1, and on the
     Hot tab no longer "new and small"): "you have a point", with the signs;
   - *one* warning sign: "not sure", with the sign;
   - *none*: "I do not agree: the coin is alive and I see no warning sign in these numbers".
   When DexScreener cannot be reached it says so and records nothing (a doubt that was never looked at is not kept).
3. **Keeps the check** (`coin_checks`, migration 0038): coin, tab, what was measured, what the site concluded. A double press, or a second device, within a minute gets the same answer and one row.
4. **Learns, critically** (Learning > "Your checks", `lib/lab/reports/checks.ts`): each checked coin is matched to the lab's snapshot closest to the check and compared with the lab's other coins of
   the same age, with the same test as the tabs and "Your own entries": did the coins you doubted really lose half within a day more often? If not, the page says "no difference" or "they do
   better". Your doubt is a hypothesis until the outcomes agree with it. Nothing about the Radar's filters is changed automatically.
5. **Tells you when a coin is back**: a card whose coin was checked before shows "🔍 Checked · 2 d ago (you doubted it, the site agreed)", and "↩ Back on this tab … the tab listed it again" when
   the learning system has since written a new qualification for that coin on that tab (`coin_qualifications`; only the Cate, Buy Signals, Ultra Momentum, Elite and Incubation tabs keep such a
   record: for Hot, Runners and Graduations the note says only that the coin was checked).

## Limits, honestly

- It measures the **coin**, not the tab's own rules: the tabs have long, different filters and they are not re-run. "Does not belong" is therefore judged by the coin's health (and, on Hot, its simple
  rule), not by the tab's score.
- The thresholds are fixed lines (the $1,000 pool is the line the lab and the wallet review already use for "no real pool"); a coin can pass them and still be bad, and a young honest coin can trip two
  of them. The answer is an opinion from five numbers, not a verdict.
- The site is public and every check asks DexScreener, so the whole site does at most 30 checks a minute, and the input must be a token address of a known network on a known tab.
- "Your checks" needs coins with a decided 72-hour window (about three days) and only knows coins the Radar admitted; with a handful of checks it will say "too few coins to say".
- Pressing Check on a coin you think is *good* is not what this is for; there is no "I like this" button.
