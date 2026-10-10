import { describe, it, expect } from "vitest";
import { aggregatePositions, decodeFills, USDC, WSOL, type Fill } from "./wallet";

const W = "WalletWalletWalletWalletWalletWalletWallet1";
const COIN = "CoinCoinCoinCoinCoinCoinCoinCoinCoinCoinpump";

const bal = (accountIndex: number, mint: string, owner: string, ui: string) => ({ accountIndex, mint, owner, uiTokenAmount: { uiAmountString: ui, uiAmount: Number(ui), decimals: 6 } });

/** A transaction in the shape getTransaction (jsonParsed) returns, reduced to what the decoder reads. */
function tx(o: { keys: string[]; pre: number[]; post: number[]; fee?: number; preTok?: any[]; postTok?: any[]; err?: unknown; t?: number }) {
  return {
    blockTime: o.t ?? 1_800_000_000,
    transaction: { signatures: ["SIG"], message: { accountKeys: o.keys.map((k) => ({ pubkey: k })) } },
    meta: { err: o.err ?? null, fee: o.fee ?? 5000, preBalances: o.pre, postBalances: o.post, preTokenBalances: o.preTok ?? [], postTokenBalances: o.postTok ?? [] },
  };
}

describe("decoding what a wallet did in one transaction", () => {
  it("reads a gasless sale for USDC (fee paid by the router, wallet SOL untouched)", () => {
    const d = decodeFills(
      tx({
        keys: ["Router", W, "WalletCoinAta", "WalletUsdcAta"], pre: [9e9, 0, 2_039_280, 2_039_280], post: [9e9, 0, 2_039_280, 2_039_280],
        preTok: [bal(2, COIN, W, "4760.955836"), bal(3, USDC, W, "8.505357")], postTok: [bal(2, COIN, W, "736.325096"), bal(3, USDC, W, "10.416389")],
      }),
      W,
    );
    expect(d.fills).toHaveLength(1);
    const f = d.fills[0]!;
    expect(f.side).toBe("sell");
    expect(f.mint).toBe(COIN);
    expect(f.quote).toBe("USD");
    expect(f.tokens).toBeCloseTo(4024.63074, 3);
    expect(f.quoteAmount).toBeCloseTo(1.911032, 5);
    expect(f.price).toBeCloseTo(1.911032 / 4024.63074, 8);
  });

  it("reads a SOL purchase and takes the rent for the new token account out of the price", () => {
    // wallet pays the fee (index 0), spends 0.1 SOL on the coin and 0.00203928 SOL of rent for a new token account (index 2)
    const rent = 2_039_280;
    const d = decodeFills(
      tx({
        keys: [W, "Pool", "NewCoinAta"], fee: 5000,
        pre: [1_000_000_000, 5e9, 0], post: [1_000_000_000 - 100_000_000 - rent - 5000, 5e9 + 100_000_000, rent],
        postTok: [bal(2, COIN, W, "2500000")],
      }),
      W,
    );
    expect(d.fills).toHaveLength(1);
    const f = d.fills[0]!;
    expect(f.side).toBe("buy");
    expect(f.quote).toBe("SOL");
    expect(f.quoteAmount).toBeCloseTo(0.1, 6);
    expect(f.price).toBeCloseTo(0.1 / 2_500_000, 12);
  });

  it("counts closing a token account as getting its rent back, not as proceeds", () => {
    const rent = 2_039_280;
    const d = decodeFills(
      tx({
        keys: [W, "Pool", "CoinAta"], fee: 5000,
        pre: [500_000_000, 5e9, rent], post: [500_000_000 + 80_000_000 + rent - 5000, 5e9 - 80_000_000, 0],
        preTok: [bal(2, COIN, W, "1000000")], postTok: [],
      }),
      W,
    );
    expect(d.fills).toHaveLength(1);
    expect(d.fills[0]!.side).toBe("sell");
    expect(d.fills[0]!.quoteAmount).toBeCloseTo(0.08, 6);
  });

  it("treats wrapped SOL as SOL", () => {
    const d = decodeFills(
      tx({
        keys: ["Router", W, "CoinAta", "WsolAta"], pre: [9e9, 0, 2_039_280, 2_039_280], post: [9e9, 0, 2_039_280, 2_039_280],
        preTok: [bal(3, WSOL, W, "0.5")], postTok: [bal(2, COIN, W, "1000"), bal(3, WSOL, W, "0.4")],
      }),
      W,
    );
    expect(d.fills).toHaveLength(1);
    expect(d.fills[0]!.side).toBe("buy");
    expect(d.fills[0]!.quote).toBe("SOL");
    expect(d.fills[0]!.quoteAmount).toBeCloseTo(0.1, 6);
  });

  it("records coins that arrive without a payment as transfers, never as buys", () => {
    const d = decodeFills(tx({ keys: ["Spammer", W, "CoinAta"], pre: [9e9, 0, 0], post: [9e9, 0, 2_039_280], postTok: [bal(2, COIN, W, "123456")] }), W);
    expect(d.fills).toHaveLength(0);
    expect(d.transfers).toHaveLength(1);
    expect(d.transfers[0]!.tokens).toBeCloseTo(123456, 3);
  });

  it("ignores failed transactions and transactions that did not touch a coin", () => {
    expect(decodeFills(tx({ keys: [W], pre: [1e9], post: [1e9], err: { InstructionError: [0, "Custom"] } }), W).fills).toHaveLength(0);
    expect(decodeFills(tx({ keys: [W, "Other"], pre: [1e9, 1e9], post: [0.9e9, 1.1e9] }), W)).toEqual({ fills: [], transfers: [], swaps: [] });
  });

  it("calls a coin-for-coin swap a swap (no price to read)", () => {
    const B = "OtherCoinOtherCoinOtherCoinOtherCoinOtherCo";
    const d = decodeFills(tx({ keys: ["Router", W, "A", "B"], pre: [9e9, 0, 1, 1], post: [9e9, 0, 1, 1], preTok: [bal(2, COIN, W, "100")], postTok: [bal(3, B, W, "50")] }), W);
    expect(d.swaps).toEqual([{ sig: "SIG", t: 1_800_000_000, out: COIN, into: B }]);
    expect(d.fills).toHaveLength(0);
  });
});

describe("one position per coin", () => {
  const fill = (side: "buy" | "sell", tokens: number, usd: number, t: number): Fill => ({ sig: `${side}${t}`, t, mint: COIN, side, tokens, quote: "USD", quoteAmount: usd, price: usd / tokens });
  it("averages what was paid and measures what was taken out against it", () => {
    const [p] = aggregatePositions([fill("buy", 1000, 2, 100), fill("buy", 1000, 4, 200), fill("sell", 1000, 6, 300)], () => 100);
    expect(p!.tokensBought).toBe(2000);
    expect(p!.usdIn).toBe(6);
    expect(p!.avgEntryUsd).toBeCloseTo(0.003, 8);
    expect(p!.openTokens).toBe(1000);
    expect(p!.realizedUsd).toBeCloseTo(6 - 0.003 * 1000, 8);
    expect(p!.firstBuyAt).toBe(100);
  });
  it("turns SOL into dollars at the time of the trade", () => {
    const f: Fill = { sig: "s", t: 500, mint: COIN, side: "buy", tokens: 10, quote: "SOL", quoteAmount: 0.5, price: 0.05 };
    const [p] = aggregatePositions([f], (t) => (t === 500 ? 120 : 0));
    expect(p!.usdIn).toBeCloseTo(60, 8);
  });
});
