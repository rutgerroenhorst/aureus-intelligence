# Your wallet in the system

The system reads what your Solana wallet bought and sold from its **public address only** (no key, no seed phrase, nothing is ever signed),
and keeps the trade journal (Results > My Trades, Home) in step with it, so you no longer depend on pressing Enter.

## What it does

- `lib/wallet.ts` reads the chain through the free public RPC: the official endpoint has the whole history, PublicNode only the last day or so;
  calls are paced and a refused endpoint cools down. A transaction becomes a **buy or sell** of one coin when the coin moves against SOL,
  wrapped SOL, USDC or USDT in your wallet (gasless swaps, where a relayer pays the fee and your SOL never moves, work: your swaps are against USDC).
  Token-account rent is taken out of a SOL price only when you pay your own fees. Coins that arrive without a payment (airdrops, spam) are recorded
  as transfers and never counted as buys. Coin-for-coin swaps have no price and are only counted.
- `lib/walletSync.ts` stores every transaction signature (`wallet_txs`, read gradually and resumable), what each did (`wallet_fills`) and updates
  **one journal row per coin you bought**: the real average price (so the real market cap at entry), the dollars put in, what was sold and when.
  A row you made with the Enter button (same coin, within a day and a half of the real buy) is corrected, not duplicated, and keeps its tab.
  New rows are marked `source = 'wallet'`.
- Trades added from the wallet history have **no recorded price path** (`peak_known = false`): their peak is shown as "-" and the example exit plan
  leaves them out instead of judging them on a made-up peak. Entries from now on are followed from the moment they are made.
- The laptop worker and `scripts/lab-daemon.ts` sync every 5 minutes; opening the journal does a quick check (at most once a minute).

## Deposits ("Deposited in total" on Results > My Trades)

Added 2026-10-11. A deposit is **SOL that another address sent to the wallet** (a system-program transfer, `decodeFlows` in `apps/web/lib/wallet.ts`), in a transaction that is not a
trade, valued in dollars at the SOL price of that hour (DefiLlama). A withdrawal is the same the other way round. Stored in `wallet_flows` (migration 0037; the sender is kept in the database
and masked on screen), shown as one card plus a list on the Results page's My Trades tab, copied to the hosted database by the laptop loop (and by `scripts/wallet-push.ts`).

What is deliberately **not** counted: anything in a transaction where a coin, USDC, USDT or wrapped SOL moved (a trade, or swapping SOL for USDC, which this wallet does right after every
deposit, and paying USDC to a trading app for a $2 buy), rent that comes back from closed token accounts, fees and failed transactions. USDC that arrives with no SOL moving is not counted as
a deposit either, because it can just as well be the proceeds of a sale made through an app: if money is ever sent in as USDC, the figure misses it.

First reading, 2026-10-11: 24 deposits, 4.3774 SOL, $473.33 at the prices of those hours, from three sending addresses, the first on 2026-08-24 (the wallet's first transaction) and the last
that evening; no withdrawals. Checked against the chain: the SOL that came in was swapped for USDC within minutes each time. Transactions read before this feature existed were looked at once more by
`corepack pnpm exec tsx scripts/wallet-flows.ts` (3 of 145 could not be read at that moment and are tried again the next time it runs; `--reprice` recomputes the dollars, `--dry-run` only prints).

### Purchases with a crumb of a second token (found and fixed 2026-10-13)

A gasless swap of USDC into a coin can leave a crumb of a second token in the wallet (0.00001 to 6 tokens next to tens of thousands of the coin bought). `decodeFills` used to call every transaction in which two coins arrived two unpriced transfers (`side = 'in'`, no quote, no dollars), so 17 of 511 transactions
(16 coins, $62, 13 of them in the last week) were purchases that no alert and no review could see. It now reads the coin whose amount is at least `DUST_RATIO` (1,000) times that of every other coin on the same side as the coin traded (the 17 cases were 8,000 to 4 billion times) and keeps the crumbs as transfers; two coins of
similar size stay unpriced transfers, nothing is guessed. Found from a screenshot of the owner's trading app: its list showed a coin the wallet journal had only as "received". `scripts/wallet-redecode.ts [--hosted] [--dry-run]` re-reads the transactions that are stored only as transfers (two or more, one with a real amount) and replaces their rows,
then updates the journal; idempotent, laptop first, then `--hosted`. Run it again whenever the review shows coins with an "in" row and no buy.

### The 88 USDC payments that deliver no coin to this wallet (2026-10-13)

88 transactions (24 August to 11 October, $2 to $25, $297.30 in all, mostly exactly $2, 49 of them on 3 to 7 September) pay USDC through a `DepositToken` instruction of one program into one shared USDC account (the same account receives payments from many other wallets within the same second; the fee payer is the same
gasless relayer as for the owner's normal swaps; now and then a large sum leaves that account to one address). The owner confirmed they are purchased coins and the app's activity list shows them as "+$1.90, bought at ..." (the $0.10 is the order cost). **They are purchases on other networks**: one was identified by matching the price the app shows with the pool's candles
at two moments (a BNB Chain coin, GeckoTerminal candles); the app is multichain, the coin goes to the owner's wallet on that network, and no coin arrives in this Solana wallet. The wallet journal, the exit alerts and the wallet reviews therefore do not see them (about $297 against $651 of Solana purchases). They are not counted as deposits
or withdrawals. To cover them the owner's (public) address on those networks is needed (the 0x address the app shows for BNB, Base and so on); reading what an address bought is then a chain read like the Solana one. The decoding and probes are scratch work (git-ignored); the review is in `docs/WALLET_REVIEW_2.md`.

## Privacy

The address is only in the database tables `wallet_watch` (laptop and hosted). It is not in the repository, no API returns it and logs show it masked
(for example `7xKX…gAsU`). The journal itself (your trades, amounts and coins) is shown on the site like before, and the site's address is public: anyone with the
address can see it. Decide whether the site should be behind a password.

## Operating it

```bash
WALLET=<address> corepack pnpm exec tsx scripts/wallet-sync.ts      # follow an address and read its whole history (resumable)
TO_URL=<hosted url> corepack pnpm exec tsx scripts/wallet-push.ts   # copy what was read to the hosted database and update its journal
WALLET=<address> corepack pnpm exec tsx scripts/wallet-scan.ts      # read-only table of every coin, nothing is stored
```

Stop following: `DELETE FROM wallet_watch;` (the rows already in the journal stay). Remove what the sync added: `DELETE FROM my_trades WHERE source = 'wallet';`.
Rows the sync corrected (your own Enter or manual rows) are restored from `backups/2026-10-10-before-overnight/hosted-my_trades-before-wallet.json`.

## Limits

Prices come from the swap itself, not from a chart. A coin bought through a coin-for-coin swap or received by transfer has no cost and no journal row. Dollars for
SOL trades and deposits use DefiLlama's hourly SOL price (which answers with nothing when more than about 500 hours are asked in one call; until 2026-10-11 the lookup asked for up to 1,000
and silently fell back to today's price for old times; every trade of this wallet is quoted in USDC, so no stored trade was affected, but the first deposit totals were: fixed, with a test). The Jupiter holdings call and the chain disagree for a moment after a trade. History before the first transaction
the RPC still serves cannot be read. Migrations 0031 and 0032 only add tables and nullable columns.
