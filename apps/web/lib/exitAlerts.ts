/**
 * Exit alerts: tell the user when a coin they hold has reached 2x or 5x what they paid for what they still hold.
 *
 * Why this and not another rule: the wallet review (docs/WALLET_REVIEW.md) found that simple exits beat how the exits really went
 * (+0.10 to +0.31 per coin), and that the leak was coins that spiked for a few hours and were not sold. A coin cannot be watched
 * all day on a phone; a message when it crosses a level can. The levels are a suggestion to take part of the money out, not an order.
 *
 * Everything here is pure (no network, no database): the worker loop (apps/worker/src/exitLoop.ts) feeds it fills and prices.
 */

export interface Fill {
  /** epoch seconds */
  t: number;
  side: string;
  tokens: number;
  usd: number | null;
}

export interface Position {
  mint: string;
  /** tokens still held (the sells take the oldest tokens first) */
  held: number;
  /** price paid per token for what is still held, USD */
  basis: number;
  /** dollars paid for what is still held */
  cost: number;
  /** epoch seconds of the oldest lot still held: a position is identified by it */
  started: number;
  /** all dollars ever put into this coin, and all dollars taken out */
  bought: number;
  sold: number;
}

/**
 * What is still held of a coin and what it cost, first in first out: a sale uses up the oldest tokens, so a coin that was sold in full and
 * bought again later is a new position at the new price (the old average would say "8x" for a re-buy that is down 90%).
 * Airdrops and transfers are ignored. Null when nothing is held, or when a buy has no price (the cost cannot be known).
 */
export function openPosition(mint: string, fills: Fill[]): Position | null {
  const rows = fills.filter((f) => (f.side === "buy" || f.side === "sell") && f.tokens > 0).sort((a, b) => a.t - b.t);
  const lots: Array<{ t: number; tokens: number; price: number }> = [];
  let bought = 0;
  let sold = 0;
  for (const f of rows) {
    if (f.side === "buy") {
      if (f.usd == null || !(f.usd > 0)) return null;
      lots.push({ t: f.t, tokens: f.tokens, price: f.usd / f.tokens });
      bought += f.usd;
    } else {
      sold += f.usd ?? 0;
      let left = f.tokens;
      while (left > 1e-9 && lots.length) {
        const lot = lots[0]!;
        const take = Math.min(lot.tokens, left);
        lot.tokens -= take;
        left -= take;
        if (lot.tokens <= 1e-9) lots.shift();
      }
    }
  }
  const held = lots.reduce((a, l) => a + l.tokens, 0);
  if (!(held > 0)) return null;
  const cost = lots.reduce((a, l) => a + l.tokens * l.price, 0);
  return { mint, held, basis: cost / held, cost, started: lots[0]!.t, bought, sold };
}

/** The levels (multiples of what was paid) an alert is sent for. */
export const LEVELS_DEFAULT = [2, 5];
/** Below this a position is dust: nothing worth a message. */
export const MIN_VALUE_USD = 0.3;
/** The pool must be real, and big next to the position, or the price on the screen is not a price anyone could sell at. */
export const MIN_POOL_USD = 2_000;
export const POOL_TO_POSITION = 5;
/** Checks in a row that must show the level before it is reported: one glitchy print is not a crossing. */
export const CONFIRM_CHECKS = 2;

export interface Quote {
  price: number;
  /** pool liquidity, USD */
  liq: number;
}

export interface Reading {
  /** price now over the price paid for what is still held */
  multiple: number;
  /** what the held tokens are worth now */
  value: number;
  /** a message may be sent for this position now (a real pool, the position is more than dust and small next to the pool) */
  alertable: boolean;
  /** the levels the multiple is at or above */
  reached: number[];
}

export function readPosition(pos: Position, q: Quote, levels: number[] = LEVELS_DEFAULT): Reading {
  const multiple = q.price / pos.basis;
  const value = pos.held * q.price;
  const alertable = Number.isFinite(multiple) && q.price > 0 && value >= MIN_VALUE_USD && q.liq >= MIN_POOL_USD && q.liq >= POOL_TO_POSITION * value;
  return { multiple, value, alertable, reached: levels.filter((l) => multiple >= l) };
}

// ---- text (Dutch, short: coin, level, what is held, one idea, a link)

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const comma = (s: string) => s.replace(".", ",");

export const fmtUsd = (v: number): string => `$${comma(v.toFixed(2))}`;
export function fmtPrice(p: number): string {
  if (!(p > 0)) return "$0";
  if (p >= 1) return `$${comma(p.toFixed(2))}`;
  const lead = Math.max(0, -Math.floor(Math.log10(p)));
  return `$${comma(p.toFixed(Math.min(12, lead + 2)))}`;
}
const fmtPool = (v: number): string => (v >= 1e6 ? `$${comma((v / 1e6).toFixed(1))}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`);
export const fmtMultiple = (m: number): string => `${m >= 10 ? Math.round(m) : comma(m.toFixed(1))}×`;

export interface AlertFacts {
  symbol: string;
  level: number;
  multiple: number;
  value: number;
  bought: number;
  sold: number;
  price: number;
  basis: number;
  liq: number;
  link: string;
}

export function alertText(a: AlertFacts): string {
  // the money is (almost) back when what was sold is at least nine tenths of what was put in
  const recovered = a.sold >= a.bought * 0.9;
  const idea = recovered
    ? a.level >= 5
      ? "Je inleg is er (bijna) al uit. Idee: haal er nog eens een derde uit en laat de rest lopen."
      : "Je inleg is er (bijna) al uit. Idee: haal er nog een deel uit en laat de rest lopen."
    : "Idee: haal de helft eruit, dan heb je je inleg terug.";
  return [
    `🔔 <b>${esc(a.symbol)}</b> staat nu op <b>${a.level}×</b> je instap (${fmtMultiple(a.multiple)})`,
    `Je hebt er nog ${fmtUsd(a.value)} van · inleg ${fmtUsd(a.bought)} · al eruit ${fmtUsd(a.sold)}`,
    idea,
    `Koers ${fmtPrice(a.price)} (instap ${fmtPrice(a.basis)}) · pool ${fmtPool(a.liq)}`,
    a.link,
  ].join("\n");
}

export interface HeldNow {
  symbol: string;
  multiple: number;
  value: number;
}

export function welcomeText(levels: number[], above: HeldNow[]): string {
  const lv = levels.map((l) => `${l}×`).join(" of ");
  const list = [...above]
    .sort((a, b) => b.multiple - a.multiple)
    .slice(0, 8)
    .map((h) => `${esc(h.symbol)} ${fmtMultiple(h.multiple)} (${fmtUsd(h.value)})`)
    .join(" · ");
  return [
    `✅ <b>Exit-meldingen staan aan.</b>`,
    `Ik meld het zodra een coin die je bezit ${lv} je instap raakt (twee controles achter elkaar, pool van minstens ${fmtPool(MIN_POOL_USD)}). Het is een idee om iets eruit te halen, geen opdracht.`,
    above.length ? `Nu al boven ${levels[0]}×: ${list}. Die krijg je niet nog eens gemeld.` : `Nu staat geen coin die je bezit boven ${levels[0]}×.`,
    `Staat de laptop uit, dan komen er geen meldingen.`,
  ].join("\n");
}

export const dexLink = (pair: string | null, mint: string): string => `https://dexscreener.com/solana/${pair ?? mint}`;

/** A test message: says it is a test and shows what a real alert looks like, with invented numbers. */
export function testText(): string {
  const example = alertText({ symbol: "VOORBEELD", level: 2, multiple: 2.1, value: 4.2, bought: 2, sold: 0, price: 0.0000484, basis: 0.0000231, liq: 38_000, link: "https://dexscreener.com" });
  return [`🧪 <b>Testbericht</b>`, `De exit-meldingen werken. Zo ziet een echte melding eruit (de getallen hieronder zijn verzonnen):`, ``, example, ``, `Echte meldingen komen alleen als een coin die je bezit 2× of 5× je instap raakt.`].join("\n");
}
