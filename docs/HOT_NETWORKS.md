# Hot networks: the ranking at the top of the Radar and the Hot tab

Added 2026-10-11. The Solana market is not always the hot one. The Radar now ranks the networks from the hottest down, in a strip above the
tabs, and the first tab ("Hot") shows what is trending on the hottest network (or on the one tapped in the strip). Everything else on the
Radar (CATE, Buy Signals, Elite, Runners, Graduations, the Learning Lab) is still **Solana only**.

## Which networks, and why those

The networks come from what the FOMO app (fomo.family, the gasless multi-chain trading app the user trades in) lets you trade, plus the two
largest memecoin networks it is not (yet) confirmed to carry. `apps/web/lib/chains.ts` is the single list.

| network | in FOMO | source of that statement |
| --- | --- | --- |
| Solana | yes (launch network) | FOMO's own site and every explainer |
| Base | yes, since September 2025 | DataWallet's FOMO explainer |
| BNB Chain | yes, since October 2025 | the same explainer |
| Monad | yes, since its mainnet in November 2025 | the same explainer |
| Ethereum | **not confirmed** | one newer snippet lists it; no second source found, so no FOMO mark in the strip |
| Robinhood Chain | **not confirmed** | the same snippet; the mark is also left off |

FOMO's perpetuals run on Hyperliquid / Trade[XYZ] (outside the app's own networks, and not for US persons); they are not part of this.
The FOMO marks are a convenience for the user ("can I trade this in the app?"). If FOMO adds or drops a network, change `fomo` in `chains.ts`.

## How "hot" is measured

Free sources only (docs/DATA_SOURCES.md): GeckoTerminal's own *trending pools* list of every network (top 20; page 2 repeats page 1) and
DefiLlama's DEX volume per network. For each network, after leaving out blue chips and stablecoins (WETH, USDC, BNB, ...), giants
(market cap above $2B) and dust (pool under $5K), four things are measured:

1. the share of trending coins that gained 20% or more in the last 6 hours (are coins moving?),
2. the share of trending coins younger than 48 hours (are new coins arriving?),
3. the median 24-hour price change of the trending coins,
4. how DEX volume on the network moved over the last 7 days (DefiLlama).

Each of the four is turned into a **rank among the networks**, and the four ranks are averaged: so a $2B network and a $30M one are compared
on direction, not size. The result is the order (1 = hottest) and a 0-100 "heat" bar that is relative to the other networks in the same
ranking (the hottest gets 100, the coldest 0). A network that could not be read this time (rate limit) is ranked last with 0 and says so.
When the market as a whole is down (on 2026-10-11 every network's DEX volume was down 25-56% over the week), the ranking still says which
one is **least bad / most alive**, it does not say the market is good.

**It describes today. It does not predict.** A hot network is where trending coins are moving now, not where the next 10x will come from.

## What is on a Hot tab

The 20 trending pools of the chosen network, in GeckoTerminal's order, with age, 1 h / 6 h / 24 h change, market cap, liquidity, **Enter**
and **DexScreener** (the same two buttons as every tab; nothing else on the card). Two chips: "New and small" (default: market cap up to
$300M, younger than 30 days or up 100% on the day, pool of at least $10K, 24 h volume of at least $10K) and "All trending". On Base, Ethereum
and BNB Chain most trending coins are old or large, so the default list is short, on purpose.

**Enter** writes the coin to the trade journal with its network (`my_trades.chain`, migration 0033, default `solana`). The journal then
follows its price on that network (DexScreener's chain ids), the Results table shows a small network badge for anything that is not Solana,
and Home links to DexScreener on the right network. Addresses are checked per network (`isTokenAddress`): a Solana address on Base is
refused and the other way round.

## What it does not do (yet)

- **No safety check on non-Solana coins.** The Solana tabs run RugCheck and holder checks; nothing equivalent runs for Base/BNB/Ethereum/Monad
  coins here. On EVM networks honeypots (cannot sell) and high sell taxes are common. A free option exists (GoPlus / honeypot.is token
  security) but it adds lines to every card, so it was not added without the user's say-so.
- **No lessons for other networks.** The Learning Lab (lessons, watch lanes, hypotheses) works on Solana coins only. Entries on other networks
  are in the journal and will be graded on price like any other, but the lab does not learn from them.
- **No wallet sync for other networks.** The wallet reader (docs/WALLET.md) reads a Solana address. An EVM address would need its own reader.
- The other Radar tabs are not per network. Making them so means a scanner per network with that network's safety checks.

## How it runs

- `apps/web/lib/hotChains.ts` reads and ranks (about 15-20 seconds: GeckoTerminal allows about 30 calls a minute, so the six networks are read
  one after the other). That limit is shared with everything else on the same address (the worker's own ingestion uses it too), so a refusal now
  and then is normal: a refused network is tried once more after the others, and one that stays refused **keeps its last reading for up to 30
  minutes** (the line under the strip then says "last read N min ago"); after that it is shown as "could not be read" and ranked last. `saveHotReport` stores the result as one row in `lab_reports` (kind `hotchains`); a round in which more networks could
  not be read than in the stored ranking does **not** replace it while that one is under 30 minutes old.
- `apps/worker/src/hotLoop.ts` (started by the worker and by `scripts/lab-daemon.ts`) refreshes the row every 4 minutes
  (`HOT_EVERY_MINUTES`), locally and, when `LAB_SYNC_URL` is set, on the hosted database too. `HOT_LOOP=0` switches it off.
- `GET /api/hot-chains` serves the stored row and says how old it is. When the row is older than 5 minutes (laptop off) the hosted site
  refreshes it itself after answering (one at a time, at most once a minute), and computes it inline only when there is no row at all.
- The Radar page asks every 60 seconds. The ranking strip and the Hot tab follow the hottest network on their own until a network is tapped.
- Tests: `apps/web/lib/hotChains.test.ts`.
