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

/**
 * The levels (multiples of what was paid) a message is sent for: a log ladder, so a runner gets seven messages and never dozens (docs/ALERT_REDESIGN.md: every whole x would send
 * four times as many). The first level reached is the "first profit" message (with sound), the next ones are quiet "next step" messages.
 */
export const LEVELS_DEFAULT = [2, 3, 5, 10, 20, 50, 100];
/**
 * The line under the highest level reported is the site's own stop: the owner's trading app (FOMO) has no stop or limit order on a memecoin, so the site watches the price and says
 * once, with sound, when it has fallen to the line: sell the rest. 75% of the level keeps most of a run and was as good as a continuous 40% trail on the lab's coins (docs/ALERT_REDESIGN.md):
 * 2x gives a line at 1.5x, 5x at 3.75x, 10x at 7.5x.
 */
export const LINE_FACTOR = 0.75;
export const lineFor = (topLevel: number): number => LINE_FACTOR * topLevel;
/**
 * Below this a position is not worth a message: a sale of less costs at least $0.10, which is 5% of $2 (the owner's fee, measured on their own trades). It was $0.30.
 */
export const MIN_VALUE_USD = 2;
/** What one order costs in the owner's app: a flat $0.10, and about 1% more from $8 up (measured on 113 of their own trades, docs/ALERT_REDESIGN.md). */
export const orderFeeUsd = (usd: number): number => (usd > 0 ? 0.1 + (usd >= 8 ? 0.01 * usd : 0) : 0);
/** A sale advice for a slice smaller than this is not given: the fee is then 4% or more of it. */
export const MIN_SLICE_USD = 2.5;
/**
 * The loss message: a position that is less than 72 hours old and has fallen to 70% of what was paid, without ever having passed 2x, gets one quiet message. The owner's own record (200
 * coins since August) shows that 78% of the coins were never sold at all and those lost 81% of the money put in, while the 44 coins they did sell made money; in the lab 89% of the coins fell
 * 30% below the first look within three days and 79% of those ended at half or lower (84% on PumpSwap), only 10% back at 1x or more; a hard stop was worth 8 to 14 points of the stake against holding
 * (docs/EXIT_PRACTICE.md, docs/WALLET_REVIEW_2.md). The key is a negative level so that it is claimed once per position like every other message.
 */
export const LOSS_AT = 0.7;
export const LOSS_KEY = -0.7;
export const LOSS_WINDOW_S = 72 * 3600;
/** A position worth less than this is not worth the message (the owner's order costs at least $0.10). */
export const LOSS_MIN_VALUE_USD = 1;
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

// ---- text (Dutch, short: coin, how far it ran, what the owner has made, one action, buttons)

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
const fmtSigned = (v: number): string => `${v < 0 ? "−" : "+"}${fmtUsd(Math.abs(v))}`;
const fmtPct = (p: number): string => `${p < 0 ? "−" : "+"}${Math.round(Math.abs(p) * 100)}%`;

export type AlertKind = "first" | "step" | "line" | "loss";

export interface AlertFacts {
  kind: AlertKind;
  symbol: string;
  mint: string;
  /** first, step: the level that was reached; line: the highest level reported before (the line sits under it) */
  level: number;
  multiple: number;
  /** what is still held, worth now */
  value: number;
  /** dollars ever put into the coin, and dollars taken out */
  bought: number;
  sold: number;
  price: number;
  basis: number;
  liq: number;
  /** DexScreener's pool address, when known */
  pair: string | null;
}

/** A button under a message (Telegram's inline keyboard): a link, or a copy button (Bot API 7.11), with an optional colour (Bot API 9.4). */
export interface MessageButton {
  text: string;
  url?: string;
  copy?: string;
  style?: "primary" | "success" | "danger";
}

export interface AlertMessage {
  text: string;
  buttons: MessageButton[];
  /** sent without a sound: the quiet "next step" messages */
  silent: boolean;
}

export const dexLink = (pair: string | null, mint: string): string => `https://dexscreener.com/solana/${pair ?? mint}`;
/** A coin's page in the FOMO app (the share link the app makes, without the owner's handle and the time): 1399811149 is Solana there; the iOS app opens it as a universal link. */
export const fomoLink = (mint: string): string => `https://fomo.family/coin?address=${mint}&chainId=1399811149`;

const DOT: Record<AlertKind, string> = { first: "🟢", step: "🔵", line: "🔴", loss: "🟠" };

/**
 * The message: one dot of colour and the coin with how far it has run; one line with what the position has made on paper (what is held at today's price plus what was already
 * taken out, against what was put in: the owner's result, not the coin's multiple); one quote with the action in plain words, as a percentage of what is held now (that is what the app
 * sells) with the dollars it brings in and what the order costs; the line under which the next message will say "sell the rest"; the pool in small print.
 */
export function alertMessage(a: AlertFacts): AlertMessage {
  const recovered = a.sold >= a.bought * 0.9;
  const onPaper = a.value + a.sold - a.bought;
  const result = `Jouw resultaat: <b>${fmtSigned(onPaper)}</b> (${fmtPct(a.bought > 0 ? onPaper / a.bought : 0)}) op papier`;
  const head = `${DOT[a.kind]} <b>${esc(a.symbol)}</b> · koers <b>${fmtMultiple(a.multiple)}</b>`;
  const pool = `<i>Pool ${fmtPool(a.liq)}</i>`;
  const lines: string[] = [head];

  if (a.kind === "loss") {
    // the same wording whatever the pool: what the lab measured for coins that fell 30% below their first look in the first days (docs/EXIT_PRACTICE.md)
    lines.push(result, ``, `<blockquote>Verkoop alles (<b>100%</b>): ≈ ${fmtUsd(a.value)}. Kosten ≈ ${fmtUsd(orderFeeUsd(a.value))}.</blockquote>`);
    lines.push(`Van de coins in het lab die in hun eerste dagen 30% onder de instap zakten, eindigde 79% op de helft of lager en kwam 10% terug op 1× of hoger. Een idee, geen opdracht.`);
  } else if (a.kind === "line") {
    const line = lineFor(a.level);
    const fee = orderFeeUsd(a.value);
    lines.push(`Laatste niveau: <b>${fmtMultiple(a.level)}</b>, de lijn lag op <b>${fmtMultiple(line)}</b>.`, result, ``);
    lines.push(
      a.value >= MIN_SLICE_USD
        ? `<blockquote>Verkoop de rest (<b>100%</b>) nu: ≈ ${fmtUsd(a.value)}. Kosten ≈ ${fmtUsd(fee)}.</blockquote>`
        : `<blockquote>De rest is klein (≈ ${fmtUsd(a.value)}); verkopen kost ≈ ${fmtUsd(fee)} (${Math.round((100 * fee) / Math.max(a.value, 0.01))}%). Verkoop alles of laat staan.</blockquote>`,
    );
  } else {
    const line = lineFor(a.level);
    lines.push(result, ``);
    if (a.kind === "first") {
      const half = a.value * 0.5;
      if (recovered) lines.push(`<blockquote>Je inleg is er al uit. Laat de rest lopen.</blockquote>`);
      else {
        const stakeBack = half + a.sold >= a.bought * 0.95;
        lines.push(`<blockquote>Verkoop <b>50%</b> van wat je nu hebt (≈ ${fmtUsd(half)}). Kosten ≈ ${fmtUsd(orderFeeUsd(half))}.${stakeBack ? `\nDan heb je je inleg terug en loopt de rest gratis mee.` : ""}</blockquote>`);
      }
    } else if (a.level === 10 && a.value * 0.25 >= MIN_SLICE_USD) {
      // the owner's own idea, equal to doing nothing on average in the lab's data: offered once, at 10x, only when the slice is worth its fee
      lines.push(`<blockquote>Wil je meer veiligstellen: verkoop <b>25%</b> van wat je nu hebt (≈ ${fmtUsd(a.value * 0.25)}). Kosten ≈ ${fmtUsd(orderFeeUsd(a.value * 0.25))}.</blockquote>`);
    }
    lines.push(
      a.kind === "first"
        ? `Ik waarschuw je als de koers onder <b>${fmtMultiple(line)}</b> (${fmtPrice(a.basis * line)}) zakt.`
        : `De lijn gaat omhoog naar <b>${fmtMultiple(line)}</b> (${fmtPrice(a.basis * line)}). Zakt de koers daaronder, dan krijg je een melding om de rest te verkopen.`,
    );
  }
  lines.push(``, pool);
  const buttons: MessageButton[] = [
    { text: "Open in FOMO", url: fomoLink(a.mint), style: a.kind === "line" || a.kind === "loss" ? "danger" : a.kind === "first" ? "success" : "primary" },
    { text: "DexScreener", url: dexLink(a.pair, a.mint) },
    { text: "Kopieer adres", copy: a.mint },
  ];
  return { text: lines.join("\n"), buttons, silent: a.kind === "step" || a.kind === "loss" };
}

/** What the Telegram page shows for a message: the text as sent plus its buttons as plain lines (the page cannot draw buttons). */
export const loggedText = (text: string, buttons: MessageButton[] = []): string => (buttons.length ? `${text}\n\n${buttons.map((b) => `${b.text}: ${b.url ?? b.copy ?? ""}`).join("\n")}` : text);

export interface HeldNow {
  symbol: string;
  multiple: number;
  value: number;
}

/** A row of label and value as two columns inside a <pre> block (Telegram: monospace, so the values start in the same place). */
function table(rows: Array<[string, string]>): string {
  const w1 = Math.max(...rows.map(([l]) => l.length));
  return rows.map(([l, v]) => `${l.padEnd(w1)}  ${v}`).join("\n");
}

export function welcomeText(levels: number[], above: HeldNow[]): string {
  const lv = levels.map((l) => `<b>${l}×</b>`).join(", ");
  const list = [...above]
    .sort((a, b) => b.multiple - a.multiple)
    .slice(0, 8)
    .map((h) => `${esc(h.symbol)} ${fmtMultiple(h.multiple)} (${fmtUsd(h.value)})`)
    .join(" · ");
  const rules = table([
    ["Controle", "dag en nacht"],
    ["Bevestiging", "2 controles achter elkaar"],
    ["Pool", `minimaal ${fmtPool(MIN_POOL_USD)}`],
    ["Positie", `minimaal ${fmtUsd(MIN_VALUE_USD)}`],
    ["Per coin", "één melding per niveau"],
  ]);
  return [
    `✅ <b>Exit-meldingen staan aan</b>`,
    ``,
    `Ik stuur een bericht als een coin die je bezit ${lv} je instap raakt. De eerste keer met geluid en met wat je kunt verkopen, de volgende niveaus stil. Zakt de koers daarna onder de lijn, dan krijg je een melding met geluid om de rest te verkopen: FOMO kan zelf geen stop zetten, dat doe ik.`,
    ``,
    `<pre>${rules}</pre>`,
    ``,
    above.length ? `Nu al boven ${levels[0]}×: ${list}. Die krijg je niet nog eens gemeld.` : `Nu staat geen coin die je bezit boven ${levels[0]}×.`,
    ``,
    `<i>Een idee om iets eruit te halen, geen opdracht.</i>`,
  ].join("\n");
}

/** A test message: says it is a test and shows what a real alert looks like, with invented numbers. */
const EXAMPLE: AlertFacts = { kind: "first", symbol: "VOORBEELD", mint: "VOORBEELDmint11111111111111111111111111111pump", level: 2, multiple: 2.1, value: 4.2, bought: 2, sold: 0, price: 0.0000484, basis: 0.0000231, liq: 38_000, pair: null };
export function testText(): string {
  return [
    `🧪 <b>Testbericht</b>`,
    `De exit-meldingen werken, ook als je laptop uit staat. Zo ziet een echte melding eruit (de getallen zijn verzonnen):`,
    ``,
    alertMessage(EXAMPLE).text,
    ``,
    `<i>Echte meldingen: met geluid als een coin die je bezit ${LEVELS_DEFAULT[0]}× je instap raakt (verkoop de helft), stil bij ${LEVELS_DEFAULT.slice(1).map((l) => `${l}×`).join(", ")} (dan gaat de lijn omhoog), met geluid als de koers onder de lijn zakt (verkoop de rest), en stil als een verse coin 30% onder je instap zakt. Een idee, geen opdracht.</i>`,
  ].join("\n");
}
export const testButtons = (): MessageButton[] => alertMessage(EXAMPLE).buttons;
