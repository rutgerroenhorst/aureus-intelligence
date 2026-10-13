# What the owner's own buying says, second look: 200 coins since August (2026-10-13)

The owner wrote that they still take losses fairly often, that the best profit was "maybe times 20", that it is "a real disappointment", and asked to check everything bought so far against what the system had said, to find what can be improved, and to recognise coins that
"we should simply not buy any more" or that need a note like "this is such a coin, make sure to sell it in time, for example once it has doubled". This is the answer with the definitions, so it can be repeated. Like the first review (docs/WALLET_REVIEW.md) it holds counts and
totals only: the per-coin list is not in the repository (it is the owner's trading and the repository is public); `scripts/wallet-review.ts` rebuilds it on any machine that has the wallet tables.

## What was and was not looked at

- **Looked at**: every coin the followed Solana wallet first bought from 2026-08-24 to 2026-10-13 and that arrived in that wallet through a swap (`wallet_fills`): **200 coins**, 279 orders. Money multiple = (sold + what is still held at today's price) / put in; a coin without a real pool counts as worth 0.
  "The system knew the coin" = `tokens.first_seen_at` is before the first buy (not `candidates.discovered_at`, see docs/WALLET_REVIEW.md).
- **Not visible**: **88 payments** (mostly exactly $2, $297 in all, 24 August to 11 October, 49 of them on 3 to 7 September) that leave the wallet as USDC through a `DepositToken` instruction of program `99vQwt…` into a shared USDC account (`7uTT…`, about $200K in it; many other
  wallets pay into the same account within the same second; the fee payer is the same gasless relayer as for the owner's normal swaps). The owner says they are purchased coins. **No coin arrives in the wallet after such a payment** (three samples checked, nothing within 30 minutes), so the coins
  are somewhere this review cannot see: another network (the app is multichain: Base, BNB, Monad, ...) or kept inside the app. Without the owner's address on that network or a look at the app's history the review does not cover them, **and neither do the exit alerts**. That is $297 of the $473 deposited.
  It is the first thing to settle (`docs/WALLET.md`).

## The money (the 200 coins that are visible)

| | coins | put in | out | held now | multiple | net |
| --- | --- | --- | --- | --- | --- | --- |
| all coins first bought since 2026-08-24 | 200 | $587 | $247 | $113 | **0.61x** | -$228 |
| the last two weeks (since 2026-09-27) | 113 | $388 | $149 | $104 | 0.65x | |

The median coin ended at 0.08x of its cost; 71% lost half or more (65-76%), 55% are dead (no pool), 7% (13 of 200) doubled. The result is carried by a handful of coins: without the best coin the net is -$262, without the best three -$312.
The best coin returned about 10x of the money put in; the best coins' prices ran to roughly 18x, so "maybe times 20" is the coin's peak, not what was taken out.

## What stands out (each one a count, with the caveat)

1. **78% of the coins (156 of 200) were never sold at all.** $432 went into them; $84 is left (0.19x, **-$348**). The 44 coins sold at least once: $155 in, $247 out and $29 still held (1.78x, **+$121**). Caveat: this is not proof that selling causes the difference, because a
   coin that rises gets sold and a coin that only falls does not. What it does say: nearly all of the money that was lost is in coins that were bought and then left alone. The lab's own numbers say the same from the other side: holding for 72 hours loses 49% on average, and the current exit
   (half at 2x, a trail under the rest, a stop at -50%) beats holding by 31 [21, 42] points of the stake for a coin entered at a pool age of one hour (docs/EXIT_PRACTICE.md).
2. **Coins the system had never seen were the worst.** 87 of 200 (44%) were never seen by the system before or after the buy: $220 in, **0.28x (-$158)**, 66% dead, 2 of 87 doubled. The 91 coins known before the buy: $269 in, 0.67x. The 22 coins the system saw only after the buy did best (1.20x, 5 of 22 doubled),
   mostly bought in the first hour of a pool (18 coins bought under an hour old: 1.11x, 3 doubled): the owner's own early finds are the one group that made money, and the system's door (60-minute pools) cannot see them. Small groups: indications, not findings.
3. **A $2 position pays 10% of itself in orders.** An order costs a flat $0.10 (about 1% more from $8 up; measured on 113 of the owner's own trades), so a round trip on $2 is $0.20. 279 orders = **at least $27.90 in fees, 4.7% of everything put in** (counted at the flat $0.10; the 1% from $8 up comes on top). Positions of $2 to $2.50 (152 coins): 0.38x; $3 to $5 (38 coins): 1.07x;
   over $5.50 (10 coins): 0.55x. Not a finding (small groups, and the bigger positions are coins the owner liked more), but the fee on a $2 position is certain.
4. **The entries are not better or worse than a random coin of the same age.** For the 84 coins that could be matched to a lab snapshot with a decided 72-hour window: held 2x 22% [13-34] against 13% for the lab's other coins at the same ages (Fisher p = 0.14); lost half within 24 hours 61% against 53% (p = 0.33).
   The lab's default exit plan from the same moment would have returned -25% per dollar. **No entry rule is established by this**, and nothing here supports "filter harder": what was bought looks like the average coin of the lab, a little busier (trades, volume, pool and market cap in the top quarter of coins of that age)
   and no stronger in price (50th percentile against the first look and the share of the high held).
5. **The spikes were not taken.** Of the 78 coins the scanner followed for at least a day after the buy, 17% held 2x within 72 hours and 4% held 5x; 62% fell to half or less within 24 hours. Of the 12 coins that doubled, 3 ended at half of the money put in or less and 3 more at about break-even.
6. **Sessions**: coins bought alone (one or two within two hours): 0.34x; as part of a run of six or more: 0.88x. Interesting, small, not used.
7. **Market cap at the buy**: $30-100K 0.75x (91 coins), $100-300K 0.37x (42 coins, 1 doubled), the rest in between. Same warning as above: 30 or so splits, nothing is established.

## What it means, and what was built from it

- There is **no "do not buy coins like this" rule that the data supports** except one that is not a property of the coin: *the system has never seen it* (point 2; 87 coins, 0.28x). The Check button already says in its memory line that the system never scanned a coin; that line is a note, not part of the verdict.
- What the data does support is on the **exit side**: most losses are coins bought and left alone, and the winners were not sold at their peaks. Built on 2026-10-13 (docs/EXIT_ALERTS.md): the first-profit message ("sell 50% now"), the quiet steps with the line, the **line message** ("sell the rest") because the owner's app cannot place a stop,
  and the quiet **loss message** for a fresh position that has fallen to 0.7x of what was paid without ever having doubled ("sell everything, the lab's coins that fell this far ended at half or lower 79% of the time and came back to 1x in 10%"). At a $2 stake an order is 5% of it: the loss message is about break-even there on average,
  and is quiet for that reason. `EXIT_ALERT_LOSS=0` switches it off.
- The note the owner asked for ("this is such a coin, sell it in time"): the first-profit message is that note, and the Check button's pool-age line gives the base rate for the coin's age (78% of PumpSwap coins lose half within a day when bought at a pool age of one hour, 28% at a day).
- Not done: the 88 payments, an entry filter, anything for coins the door cannot see.

## What would make this better

The owner's address (public) on the other network(s) and a look at the app's activity list for a few of the $2 payments, so that the coins behind the payments can be followed and the review is complete; then redo this page. A review in four weeks on the coins bought **after** the new messages went live is the only
way to know whether they helped (the lab can only say what the rules would have done).
