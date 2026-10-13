# Telegram alerts: which messages are worth sending, what to suggest at each level, and how they should look (research and proposal, 2026-10-13)

The owner asked: more modern, "commercial" and clean messages (something that could be shown to other people on social media to create interest, not AI-looking), and a tactical
question: why alert only at 2x and 5x, why not at every x, and could each level say what to take out (for example 50% at 2x, 25% at 10x)? **Nothing here is built yet**: this is the
research, the numbers and the proposal, with the decisions the owner still has to make. The current alerts are described in `docs/EXIT_ALERTS.md`.

Reproduce every number: `corepack pnpm exec tsx scripts/lab-alert-ladders.ts` (read-only, about 3 minutes, laptop database).

## What was run (written down before looking)

- **Coins**: the lab's coins whose whole 72 hours were seen, each entered at its first look: **1,479 coins** (the earlier exit research had 1,123). Phantom readings removed (`lib/lab/paths.ts`),
  5% cost on every sale, a stop at -50% until the first target fills. Every number is a ceiling; the comparison between rules is the point.
- **Volume**: how many messages each ladder of levels would send (a level counts on two readings in a row, which is what the alert needs).
- **Suggested sales**: the current advice (half at 2x, a trailing stop of 40% under the rest) against the owner's idea (50% at 2x, 25% at 10x), more rungs, stops that tighten or step up, a
  break-even stop, no protection at all, and a -30% stop on a fresh position. Each rule is run **twice**: sold AT the level / the price read (the lab's usual, optimistic) and **sold five minutes after
  the crossing** (an alert takes two to four minutes to arrive, and then a person has to act; the system never sells anything). Paired differences against the current advice, 90% bootstrap intervals,
  also on the later 40% of the coins only.

## Results

**1. How many messages.** Per coin that was ever held / per coin that reached 2x (17.6% of the coins did):

| ladder of levels | per coin | per coin that reached 2x | most for one coin |
| --- | --- | --- | --- |
| today: 2x, 5x | 0.23 | 1.3 | 2 |
| 2x, 3x, 5x, 10x | 0.36 | 2.0 | 4 |
| **log ladder: 2x 3x 5x 10x 20x 50x 100x** | **0.37** | **2.1** | 7 |
| every whole x up to 10x, then 15x 20x 30x 50x 100x | 0.60 | 3.4 | 14 |
| **every whole x up to 100x** | **0.95** | **5.4** (p95: 20) | **99** |

So the log ladder sends about 1.6 times today's messages; every whole x sends 4 times as many, and one runner can send dozens. On the owner's own coins of 2026-10-11 to 13 (11 coins, 14 alerts so far) the
log ladder would have made about 26 messages and every whole x about 50, thirty of them from two coins (HIRE, 21x, and Pepper, 11x). Guides on notification fatigue say the same in general: send a push only
for the handful of events a person must decide on within hours, and put the rest in silent messages or digests (see Sources).

**2. What happens after 2x** (289 coins; the moment of the alert = two readings in a row at 2x). Price N minutes after the alert against the price at the alert (10th / median / 90th percentile):
5 min 0.87 / 1.00 / 1.11 (4% down 30% or more); 15 min 0.72 / 0.98 / 1.23 (9%); 30 min 0.58 / 0.95 / 1.36 (16%); 60 min 0.21 / 0.88 / 1.40 (**28%**). The highest price came 0 / 34 / 402 minutes after the alert
(25th / 50th / 75th percentile): **40% of the coins topped within 15 minutes, 57% within an hour**. Of the coins that reached 2x, 57% reached 3x, 33% 5x, 13% 10x, 5% 20x, 2% 50x. A few minutes of delay costs
nothing at the median, but waiting an hour costs a quarter of the coins a third of the price: **the first-profit alert is the one that has to be fast and loud.**

**3. Suggested sales** (mean result in % of the stake; every rule loses on average because the coins are entered at the first look, see docs/EXIT_STRATEGY.md; difference against the current advice in points of
the stake with the 90% interval):

| rule | sold at the level | sold 5 minutes after |
| --- | --- | --- |
| hold, no sales | -9 [-16, -2] | -19 [-27, -10] |
| all out at 2x | -3 [-7, 1] | **+7 [1, 12]** |
| **current advice: half at 2x, trail 40%** | (baseline, -33%) | (baseline, -23%) |
| owner's idea: 50% at 2x, 25% at 10x, trail 40% | -1 [-3, 0] | +1 [-2, 3] |
| half at 2x, then 10% each at 3x 5x 10x 20x | -2 [-5, 1] | +3 [-1, 6] |
| even ladder, 20% at each of 2x 3x 5x 10x 20x | -2 [-5, 1] | +1 [-3, 6] |
| trail tightens (40% / 30% from 5x / 25% from 10x) | -1 [-4, 1] | -1 [-4, 1] |
| rest not protected at all | **-5 [-8, -2]** | **-5 [-8, -2]** |
| rest stopped at break-even (1x) | **-5 [-7, -2]** | **-5 [-8, -2]** |
| rest stopped at 1.5x, fixed | -4 [-6, -1] | -4 [-6, -1] |
| stop steps up with the ladder, 60% of the highest level (2x gives 1.2x, 5x gives 3x) | -2 [-3, -1] | -2 [-4, -1] |
| stop steps up with the ladder, 75% of the highest level (2x gives 1.5x, 5x gives 3.8x, 10x gives 7.5x) | -1 [-3, 1] | -1 [-3, 1] |
| **a stop at -30% on a fresh position, before the first target** | **+4 [3, 5]** | **+3 [1, 5]** |

What holds in both halves of the data and under both ways of filling:
- Selling nothing is clearly the worst; **protecting the rest is worth about 5 points**, but only a stop that moves with the price: break-even and a fixed 1.5x are worse than a trailing or stepped one.
- **More rungs do not measurably help**: the owner's idea, ten percent rungs and an even ladder are all within the noise of the current advice (their intervals include zero) and cost more actions (2.6 sales on a coin
  that reached 2x instead of 1.8). On the 86 coins that reached 5x the rungs do a little better (sold five minutes after: current 315%, owner's idea 325%, 10% rungs 336%, even ladder 362%), and on the other coins a little worse.
- A stop that **steps up with the ladder** at 75% of the highest level is as good as a continuous 40% trail, and gives every level a concrete number to put in an order.
- **The only measured improvement is cutting a loser at -30% instead of -50%** (+3 to +4 points, interval above zero in both models and both halves).

What changed against `docs/EXIT_STRATEGY.md` (1,123 coins, sold at the level): there "half at 2x" beat "all out at 2x" by +6 points [+1, +12]. With 1,479 coins that is -3 [-7, 1] (no difference), and with
a five-minute delay it **reverses to +7 [1, 12] in favour of all out at 2x** (+16 on the later 40%). A stop that a person has to execute after an alert fills late, which takes away much of what the trailing stop
was supposed to add; a first sale at the first alert does not suffer from that. So: the claim "keeping half is better than selling everything at 2x" is **not established**; "sell something at the first double and protect what is left" is.

**What none of this changes**: at the owner's sizes ($2 to $5 a coin) every difference above is a matter of cents, and what is bought matters several times more than how it is sold. The value of better messages is
in attention, learning and what can be shown to others, not in a measurable edge.

## What "x" means once part has been sold (the owner's question, 2026-10-13)

The multiple in the alert is **the coin's price divided by what was paid per token for the tokens still held** (`readPosition` in `apps/web/lib/exitAlerts.ts`). It is about the coin, so taking profit does not change it
(as long as everything was bought at one price; if more was bought later at a higher price and the oldest tokens were sold first, what is left has a higher cost and the multiple of what is left is lower). The owner's *result* is
a different number: (what is still held, at today's price, plus the money already taken out) divided by the money put in. Example: $5 in; at 5x the owner takes the $5 stake out (20% of the tokens); at 10x the rest is worth
$40, plus $5 already out is $45: **the coin is at 10x, the owner's result is 9.0x** (+$40). Today's message puts the first number in the headline ("10x je instap") and the second only in the "Op papier" line, which reads as a
contradiction. Proposal: the levels stay on the coin's price (one clear event per level, whatever was sold meanwhile), the headline shows both, **"koers 10x" and "jouw resultaat 9,0x"**, and every suggested sale is a sum in
dollars computed from what is still held and what is already out (a 10x message after the stake was taken out never says "take your stake out"). On the share picture the same two numbers appear, labelled, without amounts.

## What Telegram can do (Bot API 10.3, August 2026)

Formatting and sending: HTML with bold, italic, code, pre, quotes, **expandable quotes** (7.4); `disable_notification` sends silently; **message effects** such as confetti in private chats (7.4); photo with a caption of at most 1,024
characters (a text message 4,096), which can sit above or below the picture (7.4); `link_preview_options` (7.0). Buttons: link, callback, **copy text** (a "copy address" button, 7.11) and, since Bot API 9.4 (April 2026), a **style** on every
inline button: `primary` (blue), `success` (green) or `danger` (red). **Rich Messages** (10.1, June 2026, extended in 10.2 and 10.3): `sendRichMessage` takes HTML, Markdown or a list of blocks (headings, paragraphs, tables, expandable
details, photos, dividers, footers, buttons); worth testing on the owner's phone before relying on it. Custom emoji need a bot username bought on Fragment. Limits: one message a second to one chat, about 30 a second overall, 20 a
minute in a group. A bot cannot see which message a person saw, and an inbound button press needs a webhook (the site could be given one, behind a secret), which is why the first version needs no callback buttons.

## Proposal

**Message types** (each says one thing, in at most six lines):

| type | when | sound | what it says |
| --- | --- | --- | --- |
| first profit | the first time a held coin is at 2x of what was paid for what is still held | **yes** | take out the stake (a sum in dollars, not "half"); the stop price for the rest |
| next step | 3x, 5x, 10x, 20x, 50x, 100x | no | the stop moves up (a price); what is certain if it is hit; at 10x the optional "bank a quarter" |
| stop reached | the price falls to the stop of the step | **yes** | sell the rest now; top, now, what is kept |
| day summary | 20:00 | no | counts and the best coin; the week gets a card |
| (later) danger | pool down by half within minutes, or the maker sells | **yes** | the reason in one line |
| (optional, off) fresh loser | -30% within 72 hours of the purchase | no | the only measured improvement; only for positions worth enough to matter |

Rules against noise: one message per coin per level (as now), several coins crossing in the same two minutes in one message each but at most six a pass (as now), the stop numbers stepped (75% of the highest level)
so the owner sees "stop up to 3.8x", never a stream of tiny changes, a minimum position size to alert at all (today $0.30), and optional quiet hours in which only the loud types are loud.

**Look**: one dot of colour (green, blue, red) instead of a row of emoji; the first line is `TICKER · koers 2.0x`; one line with the owner's own result (`jouw resultaat`, lower than the coin's multiple once part was sold early); a quote block with the action in plain words; one small line with the pool; buttons: DexScreener (blue),
copy address, and Jupiter (red) on a stop. No exclamation marks, no "idea" icon, no table of seven rows; the details move into an expandable quote. Language per message type can be switched between Dutch and English.

**To share**: a picture (made on the site with `next/og`, no extra service, a few hundred milliseconds) in the Auriga colours: the factor large, the ticker, the time it took, a small price line from entry to top, "+440%", the wordmark and the
date, a line "Not financial advice. Past results say nothing about the future." **No dollar amounts and no wallet on it**, only the factor and the percentage. Sent as a photo with 5x and above (about 6% of the coins) and as a weekly card.
The weekly card should be honest on purpose (how many coins were followed, how many reached 2x, how many reached 10x, the best one): a card with only winners is survivorship bias, which is what the Kennis tab warns about,
and it is also what can get a promoter in trouble.

**Compliance, not legal advice**: the EU's MiCA requires marketing about crypto-assets to be fair, clear and not misleading, and the market-abuse rules on investment recommendations (including by influencers) require, among
other things, that conflicts of interest are disclosed. Sharing results and method is one thing; sharing "buy this now" calls to an audience, or selling access to them, is another. Before building an audience or charging for it,
check the AFM's guidance or ask a lawyer.

## Decisions for the owner

1. The ladder: log ladder (2, 3, 5, 10, 20, 50, 100), as proposed; or only 2, 5 and 10.
2. What the 2x message suggests: take out the stake (half at 2x, the current advice), or everything; and whether 10x says "bank a quarter" (the owner's idea; harmless, not measurably better).
3. Quiet: which types make a sound, optional quiet hours, a minimum position value.
4. Look: Dutch only or Dutch and English; the share picture with 5x and above and weekly, or only on request.
5. What counts as x: the coin's price (proposed: stable, one event per level, unaffected by the owner's own sales, with the result shown next to it), or the result of the whole position as the trigger (a level would then depend on what was sold).
6. A live preview of the new messages in the owner's own Telegram chat (it is the owner's bot and chat, but it is a message sent, so it waits for a yes).

## How it would be built (additive, in steps, each tested and reversible)

1. **Messages and levels**: `apps/web/lib/exitAlerts.ts` (text, pure, with tests) and the positions' highest price (a small additive table: the stop has to be known between ticks); the log ladder, the next-step and stop-reached
   types, silent sends, styled buttons and the copy button; `EXIT_ALERT_LEVELS` stays the switch. Tests for every type and for the counting (a coin that jumps over three levels at once gets one message).
2. **The share picture and the day and week summaries.**
3. **Danger messages** (liquidity and the maker), after a look at how often they would fire.
4. A Rich Message variant only if it shows well on the owner's phone.

## Sources

- Notification fatigue: [SuprSend, best practices for batching and digests](https://docs.suprsend.com/docs/best-practises-for-batching-digest); [Courier, reducing notification fatigue](https://www.courier.com/blog/how-to-reduce-notification-fatigue-7-proven-product-strategies-for-saas); [Datadog, preventing alert fatigue](https://www.datadoghq.com/blog/best-practices-to-prevent-alert-fatigue.md)
- Telegram: [Bot API changelog](https://core.telegram.org/bots/api-changelog) (versions and dates above), [bot FAQ](https://core.telegram.org/bots/faq) (rate limits); button styles, copy button and Rich Messages as documented in
  [aiogram's InlineKeyboardButton](https://docs.aiogram.dev/en/latest/api/types/inline_keyboard_button.html), [sendRichMessage](https://docs.aiogram.dev/en/latest/api/methods/send_rich_message.html) and [InputRichMessage](https://docs.aiogram.dev/en/v3.31.0/api/types/input_rich_message.html) (a mirror of the official description; the official page itself was too long to read in full here)
- Marketing rules: [MiCA article 7, marketing communications (ESMA)](https://www.esma.europa.eu/publications-and-data/interactive-single-rulebook/mica/article-7-marketing-communications); [MiCA and influencers](https://www.makeinfluence.com/en/academy/crypto-and-token-promotions-by-influencers-under-mica-what-changed-from-1-july-2026); [Mondaq on MiCA marketing](https://www.mondaq.com/social-media/1735620/marketing-under-mica-why-casps-are-underestimating-the-risk). Nothing specific to the Dutch AFM was found.
