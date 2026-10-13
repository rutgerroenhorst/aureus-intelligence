import { describe, it, expect } from "vitest";
import { alertMessage, dexLink, fmtMultiple, fmtPrice, fmtUsd, fomoLink, LEVELS_DEFAULT, lineFor, LOSS_AT, LOSS_KEY, loggedText, MIN_POOL_USD, MIN_SLICE_USD, MIN_VALUE_USD, openPosition, orderFeeUsd, readPosition, testButtons, testText, welcomeText, type AlertFacts, type Fill, type Position } from "./exitAlerts";

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
    // the default ladder is 2, 3, 5, 10, 20, 50, 100
    expect(LEVELS_DEFAULT).toEqual([2, 3, 5, 10, 20, 50, 100]);
    expect(readPosition(pos, { price: 0.011, liq: 20_000 }).reached).toEqual([2, 3, 5]);
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
    // dust, and anything a sale of which would cost 5% or more (the owner's order costs at least $0.10)
    expect(readPosition({ ...pos, held: 10 }, { price: 0.005, liq: 20_000 }).alertable).toBe(false);
    expect(MIN_VALUE_USD).toBe(2);
    expect(readPosition({ ...pos, held: 390 }, { price: 0.005, liq: 20_000 }).alertable).toBe(false); // $1.95
    expect(readPosition({ ...pos, held: 410 }, { price: 0.005, liq: 20_000 }).alertable).toBe(true); // $2.05
    expect(readPosition(pos, { price: 0, liq: 20_000 }).alertable).toBe(false);
  });
});

describe("the messages (Dutch, short)", () => {
  const MINT = "HgTGdc29D5bDMrDvsCLnorxz899VyDj7ZN7FPa6vpump";
  const facts: AlertFacts = { kind: "first", symbol: "HYDRA", mint: MINT, level: 2, multiple: 2.1, value: 4.2, bought: 2, sold: 0, price: 0.0000484, basis: 0.0000231, liq: 38_000, pair: "PAIR" };

  it("formats money and prices the Dutch way, with enough digits for a tiny price", () => {
    expect(fmtUsd(4.2)).toBe("$4,20");
    expect(fmtPrice(0.0000484)).toBe("$0,0000484");
    expect(fmtPrice(0.00496)).toBe("$0,00496");
    expect(fmtPrice(1.5)).toBe("$1,50");
    expect(fmtMultiple(9.34)).toBe("9,3×");
    expect(fmtMultiple(14.2)).toBe("14×");
  });

  it("an order costs a flat $0.10 and about 1% more from $8 up (measured on the owner's own trades)", () => {
    expect(orderFeeUsd(2)).toBeCloseTo(0.1, 12);
    expect(orderFeeUsd(7.99)).toBeCloseTo(0.1, 12);
    expect(orderFeeUsd(10)).toBeCloseTo(0.2, 12);
    expect(orderFeeUsd(40)).toBeCloseTo(0.5, 12);
    expect(orderFeeUsd(0)).toBe(0);
  });

  it("the line sits at 75% of the highest level reported: 2x gives 1.5x, 5x gives 3.75x, 10x gives 7.5x", () => {
    expect(lineFor(2)).toBeCloseTo(1.5, 12);
    expect(lineFor(5)).toBeCloseTo(3.75, 12);
    expect(lineFor(10)).toBeCloseTo(7.5, 12);
  });

  it("the first profit: the coin and how far it ran, the owner's own result, one action as a percentage of what is held with its dollars and its cost, the line, the pool", () => {
    const m = alertMessage(facts);
    const t = m.text;
    expect(t).toMatch(/^🟢 <b>HYDRA<\/b> · koers <b>2,1×<\/b>/);
    expect(t).toContain("Jouw resultaat: <b>+$2,20</b> (+110%) op papier");
    expect(t).toContain("<blockquote>Verkoop <b>50%</b> van wat je nu hebt (≈ $2,10). Kosten ≈ $0,10.");
    expect(t).toContain("Dan heb je je inleg terug en loopt de rest gratis mee.");
    expect(t).toContain("Ik waarschuw je als de koers onder <b>1,5×</b> ($0,0000347) zakt.");
    expect(t).toContain("<i>Pool $38K</i>");
    expect(t).not.toMatch(/undefined|NaN|https:\/\//);
    expect(m.silent).toBe(false);
  });

  it("the buttons: Open in FOMO (green on a first profit), DexScreener, and a copy button with the coin's address", () => {
    const b = alertMessage(facts).buttons;
    expect(b).toEqual([
      { text: "Open in FOMO", url: `https://fomo.family/coin?address=${MINT}&chainId=1399811149`, style: "success" },
      { text: "DexScreener", url: "https://dexscreener.com/solana/PAIR" },
      { text: "Kopieer adres", copy: MINT },
    ]);
    expect(fomoLink(MINT)).toBe(b[0]!.url);
    // without a pair address DexScreener is asked for the coin itself
    expect(dexLink(null, MINT)).toBe(`https://dexscreener.com/solana/${MINT}`);
    expect(alertMessage({ ...facts, kind: "step" }).buttons[0]!.style).toBe("primary");
    expect(alertMessage({ ...facts, kind: "line" }).buttons[0]!.style).toBe("danger");
  });

  it("the percentage is of what is held now and the money back shows only when it is true", () => {
    // $10 in, $3 already out, $4.20 left: half of it is $2.10, which does not bring the stake back
    const m = alertMessage({ ...facts, bought: 10, sold: 3 }).text;
    expect(m).toContain("Verkoop <b>50%</b> van wat je nu hebt (≈ $2,10)");
    expect(m).not.toContain("inleg terug");
    expect(m).toMatch(/Jouw resultaat: <b>−\$2,80<\/b> \(−28%\) op papier/);
  });

  it("when the money is already back there is nothing to sell, only the line", () => {
    const m = alertMessage({ ...facts, sold: 2 }).text;
    expect(m).toContain("Je inleg is er al uit. Laat de rest lopen.");
    expect(m).not.toContain("Verkoop");
    expect(m).toContain("Ik waarschuw je als de koers onder");
    // $1.85 of $2 is back: nothing left to recover
    expect(alertMessage({ ...facts, sold: 1.85 }).text).toContain("Je inleg is er al uit");
    expect(alertMessage({ ...facts, sold: 1.5 }).text).toContain("Verkoop <b>50%</b>");
  });

  it("a next step is quiet, moves the line up with a price, and says what happens at the line", () => {
    const m = alertMessage({ ...facts, kind: "step", level: 5, multiple: 5.2, value: 10.4, sold: 2 });
    expect(m.silent).toBe(true);
    expect(m.text).toMatch(/^🔵 <b>HYDRA<\/b> · koers <b>5,2×<\/b>/);
    expect(m.text).toContain("De lijn gaat omhoog naar <b>3,8×</b> ($0,0000866).");
    expect(m.text).toContain("dan krijg je een melding om de rest te verkopen");
    expect(m.text).not.toContain("Verkoop <b>");
  });

  it("at 10x the owner's own idea is offered, once, and only when the slice is worth its fee", () => {
    const at10 = (value: number, level = 10) => alertMessage({ ...facts, kind: "step", level, multiple: level + 0.3, value, sold: 2 }).text;
    expect(at10(20)).toContain("verkoop <b>25%</b> van wat je nu hebt (≈ $5,00). Kosten ≈ $0,10.");
    expect(at10(9)).not.toContain("25%"); // a quarter of $9 is $2.25, under the floor of $" + MIN_SLICE_USD
    expect(at10(20, 20)).not.toContain("25%");
    expect(at10(20, 5)).not.toContain("25%");
    expect(MIN_SLICE_USD).toBe(2.5);
  });

  it("the line message: sound, red, the last level and the line, sell the rest with its dollars and its cost", () => {
    const m = alertMessage({ ...facts, kind: "line", level: 2, multiple: 1.4, value: 2.8, bought: 2, sold: 2 });
    expect(m.silent).toBe(false);
    expect(m.text).toMatch(/^🔴 <b>HYDRA<\/b> · koers <b>1,4×<\/b>/);
    expect(m.text).toContain("Laatste niveau: <b>2,0×</b>, de lijn lag op <b>1,5×</b>.");
    expect(m.text).toContain("<blockquote>Verkoop de rest (<b>100%</b>) nu: ≈ $2,80. Kosten ≈ $0,10.</blockquote>");
  });

  it("a rest too small to be worth an order is said to be small, with what the order would cost", () => {
    const m = alertMessage({ ...facts, kind: "line", level: 2, multiple: 1.4, value: 1.8, sold: 2 }).text;
    expect(m).toContain("De rest is klein (≈ $1,80); verkopen kost ≈ $0,10 (6%). Verkoop alles of laat staan.");
    expect(m).not.toContain("Verkoop de rest");
  });

  it("the loss message: quiet, orange, the owner's result, sell everything with its dollars and cost, and what the lab measured for coins that fell 30% in their first days", () => {
    const m = alertMessage({ ...facts, kind: "loss", level: 0.7, multiple: 0.69, value: 1.38, bought: 2, sold: 0 });
    expect(m.silent).toBe(true);
    expect(m.text).toMatch(/^🟠 <b>HYDRA<\/b> · koers <b>0,7×<\/b>/);
    expect(m.text).toContain("Jouw resultaat: <b>−$0,62</b> (−31%) op papier");
    expect(m.text).toContain("<blockquote>Verkoop alles (<b>100%</b>): ≈ $1,38. Kosten ≈ $0,10.</blockquote>");
    expect(m.text).toContain("79% op de helft of lager en kwam 10% terug op 1× of hoger. Een idee, geen opdracht.");
    expect(m.text).not.toContain("lijn");
    expect(m.buttons[0]).toMatchObject({ text: "Open in FOMO", style: "danger" });
    expect(LOSS_AT).toBe(0.7);
    expect(LOSS_KEY).toBe(-0.7);
  });

  it("the Telegram page gets the text plus every button as a plain line (a copy button shows what it copies)", () => {
    const b = alertMessage(facts).buttons;
    const t = loggedText("tekst", b);
    expect(t).toContain("tekst\n\nOpen in FOMO: https://fomo.family/coin?address=");
    expect(t).toContain("DexScreener: https://dexscreener.com/solana/PAIR");
    expect(t).toContain(`Kopieer adres: ${MINT}`);
    expect(loggedText("tekst")).toBe("tekst");
  });

  it("escapes anything in a coin's name that Telegram would read as markup", () => {
    const t = alertMessage({ ...facts, symbol: "<b>&evil" }).text;
    expect(t).toContain("&lt;b&gt;&amp;evil");
    expect(t).not.toContain("<b>&evil");
  });

  it("the welcome message lists what is already above the first level, biggest first, or says there is none", () => {
    const w = welcomeText([2, 3, 5], [{ symbol: "QT", multiple: 5.2, value: 4.05 }, { symbol: "HOTBOT", multiple: 9.3, value: 9.52 }]);
    expect(w.indexOf("HOTBOT")).toBeLessThan(w.indexOf("QT"));
    expect(w).toContain("<b>2×</b>, <b>3×</b>, <b>5×</b>");
    expect(w).toContain("niet nog eens gemeld");
    expect(w).toContain("FOMO kan zelf geen stop zetten");
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
    expect(t).toContain("🟢 <b>VOORBEELD</b>");
    // the footer names every kind of message that can really come, with the levels of the ladder
    expect(t).toContain("2× je instap");
    expect(t).toContain("3×, 5×, 10×, 20×, 50×, 100×");
    expect(t).toContain("onder de lijn");
    expect(t).toContain("30% onder je instap");
    expect(t).not.toMatch(/undefined|NaN/);
    expect(testButtons()).toHaveLength(3);
  });
});
