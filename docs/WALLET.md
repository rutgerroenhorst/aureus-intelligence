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

## Privacy

The address is only in the database tables `wallet_watch` (laptop and hosted). It is not in the repository, no API returns it and logs show it masked
(`FSsd…aAGH`). The journal itself (your trades, amounts and coins) is shown on the site like before, and the site's address is public: anyone with the
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
SOL trades use DefiLlama's hourly SOL price. The Jupiter holdings call and the chain disagree for a moment after a trade. History before the first transaction
the RPC still serves cannot be read. Migrations 0031 and 0032 only add tables and nullable columns.
