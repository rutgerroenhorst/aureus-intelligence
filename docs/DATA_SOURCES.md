# Free data sources: what was tested, what is used, what is not

Everything here was probed against the live service on 2026-10-10 from the laptop. "Used" means the Learning Lab or the site reads it now.
All are free and keyless unless stated. Limits are the ones observed or published; be polite, the lab spaces its calls.

## Used

| source | what it gives | used for | limits seen |
| --- | --- | --- | --- |
| **PumpPortal websocket** `wss://pumpportal.fun/api/data` | every pump.fun launch (mint, creator wallet, creator's first buy in SOL, Mayhem Mode flag, name, symbol) and every graduation to PumpSwap, live. `subscribeNewToken` and `subscribeMigration` are free, token/account trade subscriptions are paid (0.01 SOL per 10,000 messages) | `apps/worker/src/pumpFeed.ts`: tables `pump_launches` (72 h) and `pump_graduates`; graduations enter the lab's watch list from minute 0 (lane `graduate`); features `pump_mayhem`, `dev_buy_sol`, `grad_minutes`, `creator_launches`; the Radar's Graduations tab | **one connection at a time** (more can get the address banned for an hour): a database lock guarantees it. About 20-30 launches and about one graduation a minute. Cannot run on Vercel (serverless), only on the laptop |
| **DexScreener** `tokens/v1`, `search`, token profiles/boosts (existing) | pairs, price, liquidity, volume, trades, price change | the scanner, the watch list polling, the price tail | about 300 calls a minute for pair data |
| **DexScreener orders** `/orders/v1/solana/{mint}` | what the team paid for, with the time of each payment: token profile, boosts (with amount), ads, community takeover. Works for old coins too | `lib/lab/statics.ts`: features `paid_profile`, `profile_delay_min`, `boost_amount`, `boost_n`, `ad_n`, `cto`, read as of each snapshot (nothing paid later is counted); backfilled for every lesson | 60 a minute. Nearly every coin in the Radar's universe has a paid profile (the discovery feed is the profile feed), so the information is in the timing and the boosts, not in "has one" |
| **DexScreener metas** `/metas/trending/v1` and `/metas/meta/v1/{slug}` | trending narratives with market cap, volume and 1h/6h/24h change (AI, dog, cat, x402, brainrot, stonks, trump, ...) and the pairs inside each | `lib/lab/regime.ts` (hourly), the market strip | the same 60 a minute |
| **Jupiter tokens v2** `lite-api.jup.ag/tokens/v2/{search,recent,toporganicscore,toptraded,toptrending}/...` | organic score, holders, launchpad, developer mint/migration counts, and per window (5m/1h/6h/24h) traders, organic buyers, net buyers, buy/sell volume, organic buy/sell volume, holder/liquidity/volume change | runner discovery (the top lists), `organic_score`, `holders`, `lp_pump`/`lp_other`, the dossier | no limit hit; 100 per list call |
| **Jupiter price v3** | SOL price and its 24 h change | market strip | none hit |
| **RugCheck** `api.rugcheck.xyz/v1/tokens/{mint}/report` | score, risks, rugged flag, liquidity lock per market, total holders, top holders with an **insider** flag, **insider networks** (linked wallets and what they still hold), creator wallet and balance, the creator's other tokens, mint/freeze authority, first detected time | the dossier (`lib/dossier.ts`) | not hit; the full report is large (50-100 KB) |
| **DefiLlama** `api.llama.fi/overview/dexs/solana`, `.../summary/dexs/pump`, `coins.llama.fi/chart/coingecko:solana` | Solana DEX volume per day (5 years), pump.fun volume, SOL price history | regime features `regime_sol_24h`, `regime_dex_vol` (history can be backfilled), the market strip | none hit |
| **alternative.me** `/fng/` | fear and greed index | market strip | none |
| **GeckoTerminal** `ohlcv/hour?token=<mint>`, `pools/multi`, token info | hourly candles, unique buyers/sellers per window, GT score | the candle repair, the dossier chart, unique-buyer features | **often 429 from a shared address** (30 a minute published, far less in practice once other tools share the address): everything that uses it is best effort. Always pass `token=<mint>`: without it a pool whose other token is listed first returns the OTHER token's price (SOL at $100) |

## Tested, not used (and why)

| source | result |
| --- | --- |
| Solana public RPC `getTokenLargestAccounts` | 429 on the first call: not usable without a paid or keyed endpoint (Helius). RugCheck's top holders cover the need |
| pump.fun frontend API `frontend-api-v3.pump.fun/coins/{mint}` | 404: the path has moved; PumpPortal covers launches and graduations |
| Bubblemaps legacy API | rejected the token parameter; undocumented, unofficial |
| GeckoTerminal "holders" and "top holder addresses" | the top-holder addresses are Pro-only; the distribution is Beta |
| TrenchBot / Solana Tracker / Mobula sniper and bundle detectors | paid or keyed; the idea is useful (supply sniped in the first block, bundled wallets, fresh-wallet ratio, insiders that hold but never bought) and RugCheck's insider networks are the free approximation |
| Helius (enhanced RPC, webhooks) | needs a key; with one the system's on-chain safety checks (currently DEGRADED) and sniper/bundle analysis become possible. A free key is a person's sign-up, not something to create here |

## Things that were not known and are now measured or watched

- **Mayhem Mode** (pump.fun): an opt-in setting where an AI agent trades the coin for its first 24 hours, with an extra billion tokens (2B supply, unused tokens burned after a day) and no fees. About **22% of launches** use it. Its early volume is partly the agent's, so volume features mean less for these coins. Flag: `pump_mayhem`.
- **Instant graduations**: in the first half hour of recording, every graduation whose launch the feed also saw was graduated within a minute of launch by a creator buying about **85 SOL** (the whole bonding curve) in the creating transaction, and several were worth $370-490K ten minutes later. That is not how an organic graduation looks (the usual one takes hours and fills from many buyers). The lab splits graduations by this (`grad_minutes < 2`, `dev_buy_sol >= 50`) and will report how those coins end (Learning > Overview > Anatomy of pump.fun graduations).
- **Launchpads**: pump.fun is no longer the only source of runners. Jupiter's launchpad field shows stonk.fun, bags.fun, Meteora's Dynamic Bonding Curve, ember, Jupiter Studio and others, and press coverage in 2026 puts LetsBonk (Raydium LaunchLab) ahead of pump.fun in launches for months. The Radar's discovery searches PumpSwap; the launchpad is now a feature (`lp_pump`, `lp_other`) so the lab can say which ones produce winners.
- **Narratives**: DexScreener's metas include "x402" (a payment protocol for AI agents, +9.8% in a day when probed), "Brainrot", "Knockoff Legends", "Stonks", "Character", next to the usual AI, cat, dog, trump. These are free heat signals for the themes the lab tags by name.
- **Paid promotion has timestamps**: the moment a profile or boost was paid for is on record per coin. HOTBOT's profile was paid 11 minutes after its pool appeared.
