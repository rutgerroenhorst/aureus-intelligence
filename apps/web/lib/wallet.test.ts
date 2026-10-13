import { afterEach, describe, it, expect, vi } from "vitest";
import { aggregatePositions, decodeFills, decodeFlows, solUsdLookup, USDC, WSOL, type Fill } from "./wallet";

const W = "WalletWalletWalletWalletWalletWalletWallet1";
const COIN = "CoinCoinCoinCoinCoinCoinCoinCoinCoinCoinpump";

const bal = (accountIndex: number, mint: string, owner: string, ui: string) => ({ accountIndex, mint, owner, uiTokenAmount: { uiAmountString: ui, uiAmount: Number(ui), decimals: 6 } });

/** A transaction in the shape getTransaction (jsonParsed) returns, reduced to what the decoder reads. */
function tx(o: { keys: string[]; pre: number[]; post: number[]; fee?: number; preTok?: any[]; postTok?: any[]; err?: unknown; t?: number; instructions?: any[]; inner?: any[] }) {
  return {
    blockTime: o.t ?? 1_800_000_000,
    transaction: { signatures: ["SIG"], message: { accountKeys: o.keys.map((k) => ({ pubkey: k })), instructions: o.instructions ?? [] } },
    meta: { err: o.err ?? null, fee: o.fee ?? 5000, preBalances: o.pre, postBalances: o.post, preTokenBalances: o.preTok ?? [], postTokenBalances: o.postTok ?? [], innerInstructions: o.inner ?? [] },
  };
}

const transfer = (source: string, destination: string, lamports: number) => ({ program: "system", programId: "11111111111111111111111111111111", parsed: { type: "transfer", info: { source, destination, lamports } } });

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

  it("reads a gasless $2 purchase that also leaves a crumb of a second token as a purchase of the big one (the router's leftovers must not hide the buy)", () => {
    const CRUMB = "CrumbCrumbCrumbCrumbCrumbCrumbCrumbCrumbCrum";
    const d = decodeFills(
      tx({
        keys: ["Relayer", W, "WalletUsdcAta", "WalletCoinAta", "WalletCrumbAta"], pre: [9e9, 0, 2_039_280, 0, 0], post: [9e9, 0, 2_039_280, 2_039_280, 2_039_280],
        preTok: [bal(2, USDC, W, "5.00")], postTok: [bal(2, USDC, W, "3.00"), bal(3, COIN, W, "87426.422588"), bal(4, CRUMB, W, "0.055571")],
      }),
      W,
    );
    expect(d.fills).toHaveLength(1);
    const f = d.fills[0]!;
    expect(f).toMatchObject({ side: "buy", mint: COIN, quote: "USD" });
    expect(f.tokens).toBeCloseTo(87426.422588, 3);
    expect(f.quoteAmount).toBeCloseTo(2, 6);
    expect(f.price).toBeCloseTo(2 / 87426.422588, 10);
    // the crumb stays in the journal as a plain transfer
    expect(d.transfers).toEqual([{ sig: "SIG", t: 1_800_000_000, mint: CRUMB, tokens: 0.055571 }]);
  });

  it("reads a sale of a big amount with a crumb of a second token going out as a sale of the big one", () => {
    const CRUMB = "CrumbCrumbCrumbCrumbCrumbCrumbCrumbCrumbCrum";
    const d = decodeFills(
      tx({
        keys: ["Relayer", W, "WalletUsdcAta", "WalletCoinAta", "WalletCrumbAta"], pre: [9e9, 0, 2_039_280, 2_039_280, 2_039_280], post: [9e9, 0, 2_039_280, 2_039_280, 2_039_280],
        preTok: [bal(2, USDC, W, "1.00"), bal(3, COIN, W, "50000"), bal(4, CRUMB, W, "3")], postTok: [bal(2, USDC, W, "3.50"), bal(3, COIN, W, "10000"), bal(4, CRUMB, W, "2.9")],
      }),
      W,
    );
    expect(d.fills).toHaveLength(1);
    expect(d.fills[0]).toMatchObject({ side: "sell", mint: COIN, quote: "USD" });
    expect(d.fills[0]!.tokens).toBeCloseTo(40000, 3);
    expect(d.fills[0]!.quoteAmount).toBeCloseTo(2.5, 6);
  });

  it("does not guess when two coins of similar size arrive with a payment: they stay unpriced transfers", () => {
    const B = "OtherCoinOtherCoinOtherCoinOtherCoinOtherCo";
    const d = decodeFills(
      tx({
        keys: ["Relayer", W, "WalletUsdcAta", "A", "B"], pre: [9e9, 0, 2_039_280, 0, 0], post: [9e9, 0, 2_039_280, 2_039_280, 2_039_280],
        preTok: [bal(2, USDC, W, "5.00")], postTok: [bal(2, USDC, W, "3.00"), bal(3, COIN, W, "1000"), bal(4, B, W, "400")],
      }),
      W,
    );
    expect(d.fills).toHaveLength(0);
    expect(d.transfers).toHaveLength(2);
  });

  it("two coins arriving with no payment at all (an airdrop) are transfers, however different their sizes", () => {
    const B = "OtherCoinOtherCoinOtherCoinOtherCoinOtherCo";
    const d = decodeFills(tx({ keys: ["Sender", W, "A", "B"], pre: [9e9, 0, 0, 0], post: [9e9, 0, 2_039_280, 2_039_280], postTok: [bal(2, COIN, W, "100000"), bal(3, B, W, "0.5")] }), W);
    expect(d.fills).toHaveLength(0);
    expect(d.transfers).toHaveLength(2);
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

describe("deposits and withdrawals", () => {
  const SENDER = "ExchangeHotWalletExchangeHotWalletExchange1";

  it("reads SOL sent to the wallet by somebody else as a deposit", () => {
    const f = decodeFlows(tx({ keys: [SENDER, W, "11111111111111111111111111111111"], pre: [9e9, 0, 1], post: [9e9 - 117_100_000 - 5000, 117_100_000, 1], instructions: [transfer(SENDER, W, 117_100_000)], t: 1_787_000_000 }), W);
    expect(f).toEqual([{ sig: "SIG", t: 1_787_000_000, asset: "SOL", direction: "in", amount: 0.1171, counterparty: SENDER }]);
  });

  it("reads SOL sent away to another address as a withdrawal, also when the transfer is an inner instruction", () => {
    const f = decodeFlows(tx({ keys: [W, "Other"], pre: [1e9, 0], post: [1e9 - 300_000_000 - 5000, 300_000_000], inner: [{ index: 0, instructions: [transfer(W, "Other", 300_000_000)] }] }), W);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ direction: "out", amount: 0.3, counterparty: "Other" });
  });

  it("does not count the SOL leg of swapping SOL for USDC, which this wallet does right after every deposit", () => {
    const f = decodeFlows(
      tx({
        keys: [W, "Pool", "UsdcAta"], pre: [1e9, 5e9, 2_039_280], post: [1e9 - 117_100_000, 5e9 + 117_100_000, 2_039_280],
        instructions: [transfer(W, "Pool", 117_100_000)], preTok: [bal(2, USDC, W, "0")], postTok: [bal(2, USDC, W, "10.874268")],
      }),
      W,
    );
    expect(f).toEqual([]);
  });

  it("does not count a payment of USDC to a trading app, or SOL that moved in a trade", () => {
    expect(decodeFlows(tx({ keys: [W, "App"], pre: [1e9, 0], post: [1e9 - 5000, 0], preTok: [bal(1, USDC, W, "12")], postTok: [bal(1, USDC, W, "10")] }), W)).toEqual([]);
    expect(decodeFlows(tx({ keys: [W, "Pool", "Ata"], pre: [1e9, 5e9, 0], post: [9e8, 5.1e9, 2e6], instructions: [transfer(W, "Pool", 100_000_000)], postTok: [bal(2, COIN, W, "2500000")] }), W)).toEqual([]);
  });

  it("does not count rent from closed token accounts, a transfer between two other addresses, a transfer to itself, or a failed transaction", () => {
    expect(decodeFlows(tx({ keys: [W, "Ata"], pre: [1e9, 2_039_280], post: [1e9 + 2_039_280 - 5000, 0] }), W)).toEqual([]);
    expect(decodeFlows(tx({ keys: ["A", "B", W], pre: [1e9, 0, 5], post: [9e8, 1e8, 5], instructions: [transfer("A", "B", 100_000_000)] }), W)).toEqual([]);
    expect(decodeFlows(tx({ keys: [W], pre: [1e9], post: [1e9 - 5000], instructions: [transfer(W, W, 1_000_000)] }), W)).toEqual([]);
    expect(decodeFlows(tx({ keys: [SENDER, W], pre: [9e9, 0], post: [9e9, 0], instructions: [transfer(SENDER, W, 117_100_000)], err: { InstructionError: [0, "x"] } }), W)).toEqual([]);
  });

  it("finds two deposits in one transaction and ignores zero-lamport transfers", () => {
    const f = decodeFlows(tx({ keys: [SENDER, W], pre: [9e9, 0], post: [8e9, 1e9], instructions: [transfer(SENDER, W, 600_000_000), transfer(SENDER, W, 400_000_000), transfer(SENDER, W, 0)] }), W);
    expect(f.map((x) => x.amount)).toEqual([0.6, 0.4]);
  });
});

describe("SOL price lookup", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads a long stretch in pieces (DefiLlama returns nothing for more than about 500 hourly points) and picks the nearest hour", async () => {
    const T0 = Math.floor(Date.now() / 1000) - 60 * 86400;
    const calls: Array<{ start: number; span: number }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = new URL(url);
        const start = Number(u.searchParams.get("start"));
        const span = Number(u.searchParams.get("span"));
        calls.push({ start, span });
        if (span > 500) return { json: async () => ({ coins: {} }) } as any;
        const prices = Array.from({ length: span }, (_, i) => ({ timestamp: start + i * 3600, price: 100 + (start + i * 3600 - T0) / 3600 / 100 }));
        return { json: async () => ({ coins: { "coingecko:solana": { prices } } }) } as any;
      }),
    );
    const lookup = await solUsdLookup(T0);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every((c) => c.span <= 480)).toBe(true);
    expect(lookup(T0 + 3600 * 10)).toBeCloseTo(100.1, 1);
    expect(lookup(T0 + 3600 * 1000)).toBeCloseTo(110, 0);
  });

  it("says 'no price' (0) for an old time when there is no history, instead of using today's price", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ coins: {} }) }) as any));
    const lookup = await solUsdLookup(Math.floor(Date.now() / 1000) - 30 * 86400);
    expect(lookup(Math.floor(Date.now() / 1000) - 20 * 86400)).toBe(0);
  });
});
