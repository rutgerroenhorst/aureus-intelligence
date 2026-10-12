# Auriga: the brand

Renamed from "Aureus" on 2026-10-12, at the user's request: a name and a look that fit what the system is (a radar that hunts memecoin trends, shields against bad coins,
filters hard and keeps profit under control) and that does not look like a generic AI dashboard.

## Name

**Auriga** is Latin for the charioteer. Roman charioteers were the first sports superstars (Diocles is counted the richest athlete ever): power held by the reins, speed under control.
It is also the constellation that holds the star Capella. Do not claim that "aur-" means gold: *auriga* comes from *aurea*, the bridle.

## Mark

A heavy **A without its crossbar**, leaning forward, with a **coin where the bar would be**. The lean is applied to the points, never as a skew, so the coin stays a true circle.
It works alone (like the swoosh), in a shield (protection) and in a roundel; at 28 px it is still an A with a coin.

| What | Where |
|---|---|
| The mark and the wordmark as React components | `apps/web/components/AurigaLogo.tsx` |
| Colours and the wordmark font as constants | `apps/web/lib/brand.ts`; the same colours as CSS variables (`--brand`, `--brand-text`, `--brand-soft`, `--brand-bg`, `--brand-fg`) at the top of `apps/web/app/globals.css` |
| Logo sheet, packagings, colour sheet (source of the drawing) | `brand/auriga/make_auriga.py` |
| App icons: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `auriga.svg` | `brand/auriga/make_icons.py` writes them into `apps/web/public/icons/` (macOS `qlmanage` renders the PNGs) |
| Name, theme colour, icons in the installed app | `apps/web/app/layout.tsx`, `apps/web/public/manifest.webmanifest` |

## Colours: three, and none of them is red, orange or green

| Name | Hex | Used for |
|---|---|---|
| nero | `#0b0b0c` | the page, the icon tile |
| bianco | `#f3f0e8` | text, the legs of the mark (warm, not pure white) |
| blu corsa | `#2f5bff` | the coin, fills, borders. 3.8:1 on the page: large or bold things only |
| the same blue, lighter | `#7f97ff` | small text and links on the page (7:1) |

**The rule: the brand blue is the interface and never a signal.** Green is profit, amber is "middle" or a warning, red is loss, everywhere in the product. A brand colour in one of those three
would read as a signal (a red background next to a green profit figure), which is why the user ruled them out for the brand. So:

- **Blue:** the logo, the selected tab (Radar tabs, Results tabs), the selected network, the active page in the menu, the Enter and DexScreener buttons, links, and what used to be teal ("info").
- **Not touched, still green / amber / red:** profit and loss figures, the ✓ ⚠ ✗ marks of the Check, the Check's verdict colours, the heat bars of the networks, the health dot in the menu, the category headings
  (Hot is orange), the warning on a failed save.
- Colours were compared on a sheet of four candidates (yellow-gold, racing blue, silver, navy with gold); racing blue won because it is the only real colour that is far from all three signal colours
  and a genuinely different look from the gold and cyan the site had before. Yellow was dropped: it sits next to the amber of "middle" and looks like Binance. The catch of blue: many crypto apps are blue.

The old navy / cyan theme (`--bg-*`, `--cyan-ice`, the electric blue `#2585ff`, teal `#30b0c0`) was re-pointed to this palette; the pages that style themselves with those variables follow without edits.

## Type

The wordmark is **AURIGA** in bold geometric capitals, tracked wide (0.14 em). The logo sheets use Futura Bold. The web app uses **Jost 700**, a free (OFL) Futura look-alike loaded with `next/font/google`
(variable `--font-wordmark`), with Futura as the first fallback on devices that have it. Only the wordmark uses it; the interface keeps the system font.

## What was deliberately not renamed

A rename of these would break stored data, secrets or running jobs, so they keep the old name. None of them is visible in the product.

- Package scope `@aureus/*`, the repository name, the database name and role `aureus`, the environment variables `AUREUS_*`, the Redis keys `aureus:*`.
- Browser storage keys `aureus:*` (watchlist, entries, market-cap band): renaming them would silently empty a person's saved lists.
- The `User-Agent` strings `Aureus-*` sent to the data sources, the Vault secret names `aureus_telegram_*`, the SQL functions `aureus_watchdog` / `aureus_dur`.
- **The Telegram bot's username** (kept out of this public repository, like its token and chat id) cannot be changed: a new username means a new bot and pairing again. Its display name can be set in BotFather. The messages the bot sends say Auriga.
- **The site's address** `aureus-intelligence-nu.vercel.app` still has the old name. A new address would mean reinstalling the app on the phone.
- **The installed phone app** keeps its old home-screen icon and name until it is removed and added again: iOS stores them at install time. The name and colours inside the app are new at once.

## How the choice was made

Names looked at first (round 1 to 4): Cupel and Lydite (assay and touchstone, too quiet), Aureole (a halo; spiritual, rejected as soft), then names with the energy of Nike, Adidas, Ferrari and Lamborghini:
Scudo, Corazza, Vaglio, Lampo, Auriga. Auriga won. Marks that failed on the way and should not be redrawn: a lotus (reads as spa or yoga), a brush circle (a loading spinner), mountain peaks
(a generic "image" icon), a pyramid (a pyramid scheme), a pointed rosette (a gear below 100 px).
