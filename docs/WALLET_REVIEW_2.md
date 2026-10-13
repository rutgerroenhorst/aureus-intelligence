# What the owner's own buying says, second look: 216 coins since August (2026-10-13)

The owner wrote that they still take losses fairly often, that the best profit was "maybe times 20", that it is "a real disappointment", and asked to check everything bought so far against what the system had said, to find what can be improved, and to recognise coins that
"we should simply not buy any more" or that need a note like "this is such a coin, make sure to sell it in time, for example once it has doubled". This is the answer with the definitions, so it can be repeated. Like the first review (docs/WALLET_REVIEW.md) it holds counts and
totals only: the per-coin list is not in the repository (it is the owner's trading and the repository is public); `scripts/wallet-review.ts` rebuilds it on any machine that has the wallet tables.

> **Corrected the same evening.** The first version of this page said 200 coins and 0.61x. A screenshot of the owner's trading app showed that 16 coins they bought were not in it: a decoder gap had stored 17 purchases as unpriced "received" tokens (section 1). With them the review has
> **216 coins and 0.58x**; the pattern did not change, the numbers did slightly (all of them below are the corrected ones).

## 1. What was and was not looked at

- **Looked at**: every coin the followed Solana wallet first bought from 2026-08-24 to 2026-10-13: **216 coins**, 299 orders. Money multiple = (sold + what is still held at today's price) / put in; a coin without a real pool counts as worth 0.
  "The system knew the coin" = `tokens.first_seen_at` is before the first buy (not `candidates.discovered_at`, see docs/WALLET_REVIEW.md).
- **Recovered by the correction (16 coins, 17 transactions, $62)**: a gasless swap of USDC into a coin can leave a crumb of a second token in the wallet (0.00001 to 6 tokens next to tens of thousands of the coin bought). The decoder called every transaction in which two coins arrived two unpriced transfers, so these purchases had no price paid,
  no position, no exit alert and no place in the reviews (13 of the 17 were from the last week, among them one of the bigger positions: $15 in two buys). `decodeFills` now reads the coin that is at least 1,000 times larger than the other as the coin bought (the 17 cases were 8,000 to 4 billion times); two coins of similar size stay unpriced.
  `scripts/wallet-redecode.ts` re-read exactly those transactions and replaced their rows (laptop and hosted database); the review above and the exit alerts now see them.
- **Not visible: the other-network purchases.** 88 payments (mostly exactly $2, $297 in all, 24 August to 11 October, 49 of them on 3 to 7 September) leave the wallet as USDC through a `DepositToken` instruction of program `99vQwt…` into a shared USDC account, with **no coin in the same or any later transaction** of this wallet. The owner's trading
  app shows them as purchases ("+$1.90, bought at ..."), the $0.10 being the order cost. One of them was identified from the app's activity list by matching the price paid with the pool's candles at two moments: **a BNB Chain coin**. So these are purchases on other networks (the app is multichain: BNB, Base, Monad, ...), paid from the Solana wallet. They are
  about a third of the money the owner put in (about $297 against $651) and **neither this review nor the exit alerts can see them** until the owner's address on those networks is known (`docs/WALLET.md`).

## 2. The money (the 216 coins that are visible)

| | coins | put in | out | held now | multiple | net |
| --- | --- | --- | --- | --- | --- | --- |
| all coins first bought since 2026-08-24 | 216 | $651 | $252 | $128 | **0.58x** | -$272 |
| the last two weeks (since 2026-09-27) | 128 | $447 | $154 | $120 | 0.61x | |

The median coin ended at 0.08x of its cost; 73% lost half or more (68-78%), 53% are dead (no pool), 6% (13 of 216) doubled. The result is carried by a handful of coins: without the best coin the net is -$307, without the best three -$356.
The best coin returned about 10x of the money put in; another one ran to about 18x in price and the owner took out 6.9x, so "maybe times 20" is a coin's peak, not what was taken out.

## 3. What stands out (each one a count, with the caveat)

1. **79% of the coins (171 of 216) were never sold at all.** $482 went into them; $92 is left (0.19x, **-$389**). The 45 coins sold at least once: $170 in, $252 out and $35 still held (1.69x, **+$118**). Caveat: this is not proof that selling causes the difference, because a
   coin that rises gets sold and a coin that only falls does not. What it does say: nearly all of the money that was lost is in coins that were bought and then left alone. The lab's own numbers say the same from the other side: holding for 72 hours loses 49% on average, and the current exit
   (half at 2x, a trail under the rest, a stop at -50%) beats holding by 31 [21, 42] points of the stake for a coin entered at a pool age of one hour (docs/EXIT_PRACTICE.md).
2. **Coins the system had never seen were the worst.** 94 of 216 (44%) were never seen by the system before or after the buy: $258 in, **0.28x (-$185)**, 65% dead, 2 of 94 doubled. The 99 coins known before the buy: $288 in, 0.64x. The 23 coins the system saw only after the buy did best (1.16x, 5 of 23 doubled),
   mostly bought in the first hour of a pool (19 coins bought under an hour old: 1.03x, 3 doubled): the owner's own early finds are the one group that did not lose, and the system's door (60-minute pools) cannot see them. Small groups: indications, not findings.
3. **A $2 position pays 10% of itself in orders.** An order costs a flat $0.10 (about 1% more from $8 up; measured on 113 of the owner's own trades), so a round trip on $2 is $0.20. 299 orders = **at least $29.90 in fees, 4.6% of everything put in** (counted at the flat $0.10; the 1% from $8 up comes on top). Positions of $2 to $2.50 (161 coins): 0.38x; $3 to $5 (43 coins): 0.96x;
   over $5.50 (12 coins): 0.54x. Not a finding (small groups, and the bigger positions are coins the owner liked more), but the fee on a $2 position is certain.
4. **The entries are not better or worse than a random coin of the same age.** For the 92 coins that could be matched to a lab snapshot with a decided 72-hour window: held 2x 20% [12-32] against 13% for the lab's other coins at the same ages (Fisher p = 0.23); lost half within 24 hours 63% against 52% (p = 0.14).
   The lab's default exit plan from the same moment would have returned -28% per dollar. **No entry rule is established by this**, and nothing here supports "filter harder": what was bought looks like the average coin of the lab, a little busier (trades, volume, pool and market cap in the top quarter of coins of that age)
   and no stronger in price (50th percentile against the first look and the share of the high held).
5. **The spikes were not taken.** Of the 93 coins the scanner followed for at least a day after the buy, 16% held 2x within 72 hours and 3% held 5x; 63% fell to half or less within 24 hours. Of the 14 coins that doubled, 3 ended at half of the money put in or less and 3 more at about break-even.
6. **Sessions**: coins bought alone (one or two within two hours): 0.36x; as part of a run of six or more: 0.77x. Interesting, small, not used.
7. **Market cap at the buy**: $30-100K 0.72x (95 coins), $100-300K 0.33x (46 coins, 1 doubled), the rest in between. Same warning as above: 30 or so splits, nothing is established.

## 4. What it means, and what was built from it

- There is **no "do not buy coins like this" rule that the data supports** except one that is not a property of the coin: *the system has never seen it* (point 2; 94 coins, 0.28x). The Check button already says in its memory line that the system never scanned a coin; that line is a note, not part of the verdict.
- What the data does support is on the **exit side**: most losses are coins bought and left alone, and the winners were not sold at their peaks. Built on 2026-10-13 (docs/EXIT_ALERTS.md): the first-profit message ("sell 50% now"), the quiet steps with the line, the **line message** ("sell the rest") because the owner's app cannot place a stop,
  and the quiet **loss message** for a fresh position that has fallen to 0.7x of what was paid without ever having doubled ("sell everything, the lab's coins that fell this far ended at half or lower 79% of the time and came back to 1x in 10%"). At a $2 stake an order is 5% of it: the loss message is about break-even there on average,
  and is quiet for that reason. `EXIT_ALERT_LOSS=0` switches it off.
- The note the owner asked for ("this is such a coin, sell it in time"): the first-profit message is that note, and the Check button's pool-age line gives the base rate for the coin's age (78% of PumpSwap coins lose half within a day when bought at a pool age of one hour, 28% at a day).
- **The coverage gap is closed for Solana**: 17 purchases that no alert or review could see are now positions with a price paid.
- Not done: the other-network purchases (address needed), an entry filter, anything for coins the door cannot see.

## 5. What would make this better

The owner's (public) address on the other network(s), so that the coins behind the 88 payments can be followed and the review is complete; then redo this page. A review in four weeks on the coins bought **after** the new messages went live is the only
way to know whether they helped (the lab can only say what the rules would have done).
