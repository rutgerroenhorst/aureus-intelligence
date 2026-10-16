# Feedback on the coins: what to filter, what not, and where the money really goes (2026-10-16)

The owner asked, three days after the alerts were rebuilt: looking at the last days, the coins that were in the system and the coins they entered with the button, is there feedback for the system, coins that should be filtered away more, "purely"?
This page is the answer with its numbers and its limits; the scripts that make every table are named so that it can be redone (section 7). Like the other reviews it holds counts and totals only, no coin names and no wallet.

**Data limits, first.** The laptop's lab daemon was down from 2026-10-13 14:52 to 2026-10-16 03:35 (it was restarted today with `scripts/laptop-up.sh --daemon`), so the lab has no readings for those days; every lab number below is from the days before the gap.
The site itself (alerts, listings, the chain feed) ran the whole time, so the numbers about the messages and the owner's entries are complete up to today.

## 1. The owner's own entries (25 graduations entered with the button, 10 to 14 October)

- **$139 in, $82 out, $27 still held: 0.78x** (-$31). Without the best two coins (6.8x and 4.8x of the money in): 0.49x on $132. 4 of 25 stand at 2x or more now, 18 below half, 8 had something sold. The typical ticket was $2 to $12, the median entry 10 minutes after the graduation.
- That is the base rate, not a verdict on the choices: of the graduations a person could buy (first pool of $5,000 or more, a complete day of readings) 10% held 2x within a day and 87% were down by half after a day; of the 25 entered, 4 (16%) are at 2x or more.
  Radar entries show the same thing (docs/WALLET_REVIEW_2.md: 15% held 2x against 15% for the lab's other coins of the same ages). The selection neither helps nor hurts. What the owner can control is what happens after the entry (section 5) and what they enter.
- Two coins carry the result (6.8x and 4.8x on $7 in), the other 23 together returned 0.49x: the shape of this game is a few winners paying for many losers, so losers must be cut early and winners must not be sold early.

## 2. The Radar tabs against the lab's other coins of the same ages (stored report, computed 2026-10-16 02:00 on data up to 13 October)

| tab | coins matched | held 2x (baseline) | **lost half within a day (baseline)** | verdict |
| --- | --- | --- | --- | --- |
| Buy Signals | 371 | 12.7% (14.7%) | **66.8% [62-72] (56.9%)** | worse on crashes |
| Elite | 133 | 20.8% (14.6%), n=24 | **76.7% [69-83] (55.4%)** | worse on crashes |
| Incubation | 103 | 18.2% (15.3%), n=22 | **81.2% [72-88] (63.0%)** | worse on crashes |
| CATE | 140 | 19.4% (14.4%), n=31 | 51.4% [42-61] (50.8%) | same as the rest |
| Ultra Momentum | 134 | 12.8% (15.4%) | 68.7% [60-76] (64.5%) | same as the rest |

No tab doubles more often than the lab's other coins; three of the five lose half within a day **more** often (by 10 to 21 points, intervals clear of the baseline). The tabs reward activity and momentum, and section 3 says why that is the wrong thing to reward.

## 3. What goes with a better or a worse result (the Radar's coins, n = 1,180 with a finished 72 hours; `scripts/lab-heat-filter.ts`)

Result = the lab's labelled result of the current exit plan from the first look (a multiple of the stake; all coins together 0.77x). The same difference in the earlier and the later half of the time is required.

| at the first look | lowest third | middle | highest third | high minus low, earlier / later half |
| --- | --- | --- | --- | --- |
| trades in the last hour (cuts 493 / 2,768) | 0.89x | 0.79x | **0.64x** | -0.26 / -0.23 |
| volume in the last hour (cuts $27K / $139K) | 0.84x | 0.80x | 0.67x | -0.15 / -0.20 |
| volume / liquidity (cuts 1.3x / 7.1x) | 0.83x | 0.78x | 0.71x | -0.11 / -0.14 |
| liquidity / market cap (cuts 0.30 / 0.47) | 0.68x | 0.73x | **0.90x** | +0.24 / +0.21 |
| market cap (cuts $33K / $93K) | **0.92x** | 0.70x | 0.70x | -0.22 / -0.22 |
| liquidity (cuts $15.7K / $28K) | 0.90x | 0.72x | 0.71x | -0.19 / -0.19 |
| pool age, buy share | no effect (-0.06 / +0.02 and -0.01 / -0.04) | | | |

- **Busy coins crash.** The busiest third by trades lost half within a day 81% of the time against 41% for the quietest third, and doubled no more often (14% against 17%): nothing is gained by buying heat. The tabs' scores reward exactly that.
- **Thin pools next to a big market cap crash**; small coins (under about $33K) and deep pools do better. Not a profit: the best groups are still 0.84x to 0.92x, and only the smallest-market-cap group has an interval that reaches 1.0.
- Four fixed combinations: *not hot* (trades below the top third) 0.84x against 0.64x (+0.19 / +0.21 in the two halves); *not hot and a deep pool* 0.86x against 0.69x (+0.16 / +0.17); adding *market cap below the top third* 0.85x against 0.70x; *quiet only* 0.89x against 0.71x. The doubling chance is the same in
  every group (15% to 17%), so what the filter removes is crashes, not winners. In money: about +0.2 per dollar of stake, four times what the best exit tweak was worth (5 points).
- Caveat: the cut points are terciles of this sample and the halves are not independent of it. The effect is large and the same in both halves, but only coins first seen after today can confirm it (section 7).

## 4. Graduations (`scripts/lab-graduate-features.ts`, the sequel of `scripts/lab-graduate-audit.ts`)

175 graduations with a first pool of $5,000 or more and a day of readings that is complete (the strict window rule of 2026-10-16: 300 of 1,258 graduations qualify, because the laptop sleeps): 10% held 2x, 87% were down by half after a day.

| first look | down by half after a day | held 2x |
| --- | --- | --- |
| the creator bought the whole curve (85 SOL or more) / less | **98%** / 73% | 12% / 6% |
| price change since the graduation: under 16% / 16% or more | 73% / 96-98% | 9% / 9-13% |
| a social link: yes / no | 64% / 93% | 8% / 11% |
| a paid profile: yes / no | 71% / 92% | 8% / 10% |
| top 10 holders (RugCheck): under 14% / 21% or more | 100% / 75% | 8% / 12% |

Every one of these has the same sign in both halves, but they are mostly **one thing seen from different sides: the "born" coin** (the creator and linked wallets bought the curve themselves), which the default view already hides. Inside the 71 graduations that are *not* born (the ones a person sees)
7% held 2x (5 coins) and 72% were down by half after a day, and no feature separates the winners from the rest with that many coins (a social link 64% against 79%, 25 against 38 coins: plausible, not established). **There is no entry filter for the visible graduations yet**; the lab needs a few weeks more of finished days.

## 5. The messages against holding (`scripts/alerts-vs-hold.ts`, 2026-10-13 15:54 to 2026-10-16 morning)

43 messages on 25 positions (7 first profit, 9 quiet steps, 15 line, 12 loss; some positions got several). If every green message had been followed by selling half, every red and orange message by selling the rest, with $0.10 per sale and the fill **five minutes after the message** where the pool still had candles
(16 of 29 sales; 3 candles that were not within a factor of four of the message's price were ignored; the other sales at the message's own price, which is kind to coins that die fast):

| | positions | holding until today | following the messages | difference |
| --- | --- | --- | --- | --- |
| all positions with a message | 25 | $48.81 | **$92.00** | **+$43.19** |
| with a loss message (sell at -30%) | 12 | $21.28 | $34.79 | +$13.51 |
| with a line message (sell the rest under 75% of the top level) | 14 | $38.90 | $59.83 | +$20.93 |
| with a first-profit message (sell half) | 6 | $20.60 | $29.22 | +$8.62 |

The biggest gain was one coin that went from 3.5x to nearly nothing within a day (+$13.81), the biggest cost one coin that fell to 0.64x, triggered the loss message, then ran to 5.7x and stands at 2.4x today (-$9.23); without those two +$38.61. In 11 of the 12 loss messages the coin stands lower today than at the message;
two of the twelve bounced above 2x at some point (one of them is the big miss). It is a short window (2.5 days) in a market where most coins fell, 25 positions, fills partly optimistic: an indication in the direction the lab already measured (holding loses 49% on average, the exit plan 21%), not a proof of the size.

**The owner acted on 5 of the 43 messages** (14 buys and 5 sells in the same 2.5 days): 2 of 7 first-profit, 2 of 9 step, 1 of 15 line and 0 of 12 loss messages were followed by a sale within two hours. The loss message is silent by design; the line message has sound.

## 6. What the data says to do, ranked by how well it is supported

1. **Act on the exit messages.** The largest effect in the data and the one thing fully under the owner's control. (Section 5.)
2. **Do not buy what is hot.** The busiest third of coins by trades or volume returns 0.2x less per dollar, with the same chance of doubling (sections 3 and 4). A fixed rule: skip a Radar coin with more than about 2,800 trades in the last hour, more than about $140K volume in the last hour or more than 7x its pool in an hour.
3. **Stop treating Elite, Incubation and Buy Signals as picks** (section 2): they lose half within a day 10 to 21 points more often than random coins of the same age.
4. **Fewer, bigger tickets.** An order costs a flat $0.10: a round trip on $2 is 10% of the ticket, on $5 4%. The same budget in fewer, bigger tickets gives back about 6% of it with certainty (the entries are no better or worse for it).
5. **Keep "born" hidden** (98% down by half after a day) and treat a coin that has already pumped since its graduation as one that has already run (96% to 98% down by half against 73% for a calm one).
6. **Not supported by the data:** a filter on pool age, buy share, or any entry filter for the graduations that are visible by default.

**Honest ceiling.** The best groups in the lab return 0.85x to 0.92x of the stake with the current exit plan; no combination in the data is clearly above 1.0. Filters and exits move the owner from clearly negative to nearly break-even at best; the profit, when it comes, comes from the one coin in eight that doubles and from not selling it too early.

## 7. Forward test and how to redo it

- The lab daemon has to run (`scripts/laptop-up.sh --daemon`; it stops when the laptop sleeps or restarts, and every stop costs finished days). After 2026-10-30 rerun `scripts/lab-heat-filter.ts`, `scripts/lab-graduate-features.ts` and `scripts/lab-graduate-audit.ts` **only on coins first seen after 2026-10-16**, with the cut points of section 3.
  A rule counts when the difference keeps the same sign in both halves and stays at 0.15x or more; otherwise it goes.
- `scripts/alerts-vs-hold.ts` after four weeks of messages (more positions, a different market).
- Not built from this page (each needs a yes): a "heat" line in the Check and on the Radar cards, the loss message with sound, hiding Elite / Incubation / Buy Signals by default.
