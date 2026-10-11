import { describe, it, expect } from "vitest";
import { alertButtons, alertText, fmtMultiple, fmtPrice, fmtUsd, loggedText, MIN_POOL_USD, openPosition, readPosition, testButtons, testText, welcomeText, type Fill, type Position } from "./exitAlerts";

const buy = (t: number, tokens: number, usd: number | null): Fill => ({ t, side: "buy", tokens, usd });
const sell = (t: number, tokens: number, usd: number | null): Fill => ({ t, side: "sell", tokens, usd });

describe("what is still held, first in first out", () => {
  it("one buy: everything is held at the price paid", () => {
    const p = openPosition("M", [buy(100, 1000, 2)])!;
    expect(p.held).toBe(1000);
    expect(p.basis).toBeCloseTo(0.002, 12);
    expect(p.cost).toBeCloseTo(2, 12);
    expect(p.started).toBe(100);
    expect(p.bought).toBe(2);
    expect(p.sold).toBe(0);
  });

  it("a sale uses up the oldest tokens, so the price paid for the rest is the later price", () => {
    const p = openPosition("M", [buy(100, 1000, 1), buy(200, 1000, 3), sell(300, 1000, 5)])!;
    expect(p.held).toBe(1000);
    expect(p.basis).toBeCloseTo(0.003, 12);
    expect(p.started).toBe(200);
    expect(p.bought).toBe(4);
    expect(p.sold).toBe(5);
  });

  it("a coin sold in full and bought again is a new position at the new price (the old average would say 8x)", () => {
    const p = openPosition("M", [buy(100, 58_610, 2), sell(200, 58_610, 38.6), buy(300, 982, 2)])!;
    expect(p.held).toBeCloseTo(982, 9);
    expect(p.basis).toBeCloseTo(2 / 982, 12);
    expect(p.started).toBe(300);
    // the price the re-buy paid is 60 times the first price: at the old price it is nowhere near 2x
    expect(readPosition(p, { price: 0.000163, liq: 40_000 }).reached).toEqual([]);
  });

  it("a partial sale takes tokens from the first lot only", () => {
    const p = openPosition("M", [buy(100, 1000, 4), sell(200, 400, 1.9)])!;
    expect(p.held).toBe(600);
    expect(p.basis).toBeCloseTo(0.004, 12);
    expect(p.cost).toBeCloseTo(2.4, 9);
  });

  it("nothing held, airdrops and transfers, and sales of more than was bought", () => {
    expect(openPosition("M", [buy(100, 1000, 2), sell(200, 1000, 3)])).toBeNull();
    expect(openPosition("M", [buy(100, 1000, 2), sell(200, 5000, 3)])).toBeNull();
    const withTransfers = openPosition("M", [buy(100, 1000, 2), { t: 150, side: "in", tokens: 99_999, usd: null }, { t: 160, side: "out", tokens: 5, usd: null }])!;
    expect(withTransfers.held).toBe(1000);
  });

  it("a buy without a price cannot be judged", () => {
    expect(openPosition("M", [buy(100, 1000, null)])).toBeNull();
    expect(openPosition("M", [buy(100, 1000, 0)])).toBeNull();
  });
});

describe("reading a position against its price", () => {
  const pos: Position = { mint: "M", held: 1000, basis: 0.002, cost: 2, started: 100, bought: 2, sold: 0 };

  it("is at a level when the price is at or above that many times the price paid", () => {
    expect(readPosition(pos, { price: 0.0039, liq: 20_000 }).reached).toEqual([]);
    expect(readPosition(pos, { price: 0.004, liq: 20_000 }).reached).toEqual([2]);
    expect(readPosition(pos, { price: 0.011, liq: 20_000 }).reached).toEqual([2, 5]);
    expect(readPosition(pos, { price: 0.011, liq: 20_000 }, [3]).reached).toEqual([3]);
  });

  it("only allows an alert for a real pool, big next to the position, and for more than dust", () => {
    const ok = readPosition(pos, { price: 0.005, liq: 20_000 });
    expect(ok.alertable).toBe(true);
    expect(ok.value).toBeCloseTo(5, 9);
    expect(readPosition(pos, { price: 0.005, liq: MIN_POOL_USD - 1 }).alertable).toBe(false);
    expect(readPosition(pos, { price: 0.005, liq: 20 }).alertable).toBe(false);
    // a pool worth less than five times the position is not a place to sell it (a $500 position in a $2,100 pool)
    expect(readPosition({ ...pos, held: 100_000 }, { price: 0.005, liq: 2_100 }).alertable).toBe(false);
    expect(readPosition({ ...pos, held: 100_000 }, { price: 0.005, liq: 3_000 }).alertable).toBe(true);
    // dust
    expect(readPosition({ ...pos, held: 10 }, { price: 0.005, liq: 20_000 }).alertable).toBe(false);
    expect(readPosition(pos, { price: 0, liq: 20_000 }).alertable).toBe(false);
  });
});

describe("the messages (Dutch, short)", () => {
  const facts = { symbol: "HYDRA", level: 2, multiple: 2.04, value: 4.2, bought: 4, sold: 0, price: 0.0000484, basis: 0.0000237, liq: 38_000, link: "https://dexscreener.com/solana/PAIR" };

  it("formats money and prices the Dutch way, with enough digits for a tiny price", () => {
    expect(fmtUsd(4.2)).toBe("$4,20");
    expect(fmtPrice(0.0000484)).toBe("$0,0000484");
    expect(fmtPrice(0.00496)).toBe("$0,00496");
    expect(fmtPrice(1.5)).toBe("$1,50");
    expect(fmtMultiple(9.34)).toBe("9,3×");
    expect(fmtMultiple(14.2)).toBe("14×");
  });

  it("an alert names the coin and how far it has run, shows the money in one aligned block, gives one idea, and links to the pool with a button", () => {
    const t = alertText(facts);
    expect(t).toContain("🟢 <b>HYDRA</b> · <b>2,0×</b> je instap");
    expect(t).toContain("<i>2×-drempel gehaald</i>");
    expect(t).toContain("Haal de helft eruit");
    expect(t).not.toMatch(/undefined|NaN/);
    // the numbers line up: every row of the block is as wide as the others, and what the position has made on paper is value + sold - bought
    const block = /<pre>([\s\S]*?)<\/pre>/.exec(t)![1]!;
    const rows = block.split("\n").filter(Boolean);
    expect(rows.filter((r) => /^(Waarde nu|Inleg|Al eruit|Op papier)/.test(r))).toHaveLength(4);
    // every value starts in the same column
    expect(rows.every((r) => /^.{9}  \S/.test(r))).toBe(true);
    expect(block).toMatch(/Waarde nu {2}\$4,20/);
    expect(block).toMatch(/Op papier {2}\+\$0,20 \(\+5%\)/);
    expect(block).toMatch(/Koers {6}\$0,0000484/);
    expect(block).toMatch(/Pool {7}\$38K/);
    // the link is a button, not a line of text
    expect(t).not.toContain("https://");
    expect(alertButtons(facts)).toEqual([{ text: "📊 Open in DexScreener", url: "https://dexscreener.com/solana/PAIR" }]);
  });

  it("the icon follows the level and a loss on paper is shown with a minus", () => {
    expect(alertText({ ...facts, level: 2 })).toMatch(/^🟢/);
    expect(alertText({ ...facts, level: 5, multiple: 5.1 })).toMatch(/^🚀/);
    expect(alertText({ ...facts, level: 10, multiple: 10.4 })).toMatch(/^🔥/);
    // bought $10, $3 already out, $4.20 left: $2.80 below what was put in
    expect(alertText({ ...facts, bought: 10, sold: 3 })).toMatch(/Op papier {2}−\$2,80 \(−28%\)/);
  });

  it("the Telegram page gets the text plus the button's link as plain text", () => {
    const t = loggedText("tekst", alertButtons(facts));
    expect(t).toBe("tekst\n\n📊 Open in DexScreener: https://dexscreener.com/solana/PAIR");
    expect(loggedText("tekst")).toBe("tekst");
  });

  it("the idea changes when the money is already back, and at 5x", () => {
    expect(alertText({ ...facts, sold: 4 })).toContain("Je inleg is er (bijna) al uit");
    // $1.85 of $2 is back: nothing left to recover (the real Pepper alert read "half out, then your money is back")
    expect(alertText({ ...facts, bought: 2, sold: 1.85 })).toContain("Je inleg is er (bijna) al uit");
    expect(alertText({ ...facts, bought: 2, sold: 1.5 })).toContain("Haal de helft eruit");
    expect(alertText({ ...facts, level: 5, multiple: 5.2, sold: 4 })).toContain("nog eens een derde");
    expect(alertText({ ...facts, level: 5, multiple: 5.2, sold: 0 })).toContain("Haal de helft eruit");
  });

  it("escapes anything in a coin's name that Telegram would read as markup", () => {
    const t = alertText({ ...facts, symbol: "<b>&evil" });
    expect(t).toContain("&lt;b&gt;&amp;evil");
    expect(t).not.toContain("<b>&evil");
  });

  it("the welcome message lists what is already above the first level, biggest first, or says there is none", () => {
    const w = welcomeText([2, 5], [{ symbol: "QT", multiple: 5.2, value: 4.05 }, { symbol: "HOTBOT", multiple: 9.3, value: 9.52 }]);
    expect(w.indexOf("HOTBOT")).toBeLessThan(w.indexOf("QT"));
    expect(w).toContain("<b>2×</b> of <b>5×</b>");
    expect(w).toContain("niet nog eens gemeld");
    expect(w).toContain("<pre>");
    expect(w).not.toContain("laptop");
    expect(welcomeText([2, 5], [])).toContain("geen coin");
  });
});

describe("the test message", () => {
  it("says it is a test, shows an alert with invented numbers, and says when real ones come", () => {
    const t = testText();
    expect(t).toContain("Testbericht");
    expect(t).toContain("VOORBEELD");
    expect(t).toContain("verzonnen");
    expect(t).toContain("2× of 5×");
    expect(t).toContain("🟢 <b>VOORBEELD</b>");
    expect(t).not.toMatch(/undefined|NaN/);
    expect(testButtons()).toHaveLength(1);
  });
});
