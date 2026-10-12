import { describe, expect, it } from "vitest";
import { extractCandidates, pickCoin, type DexPair } from "./pasteCoin";

const MINT = "So11111111111111111111111111111111111111112"; // 43 characters, a real Solana address shape
const MINT2 = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PUMP = "9Zx4yK3f7mQe2LhVbN8rTcJdU5wA1sXoP6iGqYvHpump";
const EVM = "0x4200000000000000000000000000000000000006";
const EVM2 = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";

describe("extractCandidates", () => {
  it("takes a bare Solana address", () => {
    expect(extractCandidates(MINT)).toEqual([{ value: MINT }]);
  });
  it("takes a bare EVM address and keeps its case", () => {
    expect(extractCandidates(`  ${EVM2}\n`)).toEqual([{ value: EVM2 }]);
  });
  it("reads the network from a DexScreener link", () => {
    expect(extractCandidates(`https://dexscreener.com/solana/${MINT2}`)).toEqual([{ value: MINT2, chainHint: "solana" }]);
    expect(extractCandidates(`https://dexscreener.com/base/${EVM}?maker=1`)).toEqual([{ value: EVM, chainHint: "base" }]);
  });
  it("finds the address in pump.fun, Birdeye and Solscan links", () => {
    expect(extractCandidates(`https://pump.fun/coin/${PUMP}`)).toEqual([{ value: PUMP }]);
    expect(extractCandidates(`https://birdeye.so/token/${MINT2}?chain=solana`)).toEqual([{ value: MINT2 }]);
    expect(extractCandidates(`https://solscan.io/token/${MINT2}#holders`)).toEqual([{ value: MINT2 }]);
  });
  it("copes with words and punctuation around the address", () => {
    expect(extractCandidates(`check this: ${MINT2}, thanks!`)).toEqual([{ value: MINT2 }]);
    expect(extractCandidates(`(${EVM})`)).toEqual([{ value: EVM }]);
  });
  it("keeps the order, and a coin named twice once, with the network a link gave it", () => {
    expect(extractCandidates(`${MINT} and https://dexscreener.com/solana/${MINT2} and ${MINT2}`)).toEqual([{ value: MINT2, chainHint: "solana" }, { value: MINT }]);
  });
  it("says nothing for text without an address", () => {
    expect(extractCandidates("")).toEqual([]);
    expect(extractCandidates("gm degens, what is the best coin right now?")).toEqual([]);
    expect(extractCandidates("abc123")).toEqual([]);
    expect(extractCandidates(null)).toEqual([]);
    expect(extractCandidates(42)).toEqual([]);
  });
  it("does not cut an address out of a longer run of letters", () => {
    expect(extractCandidates(MINT2 + MINT2)).toEqual([]);
  });
  it("only reads the first 600 characters and at most four addresses", () => {
    expect(extractCandidates("x".repeat(700) + ` ${MINT}`)).toEqual([]);
    const five = [MINT, MINT2, PUMP, EVM, EVM2].join(" ");
    expect(extractCandidates(five)).toHaveLength(4);
  });
});

const pair = (over: Partial<DexPair> & { base: [string, string]; quote: [string, string] }): DexPair => ({
  chainId: "solana",
  pairAddress: "POOL" + over.base[0].slice(0, 6),
  baseToken: { address: over.base[0], symbol: over.base[1], name: over.base[1] + " coin" },
  quoteToken: { address: over.quote[0], symbol: over.quote[1], name: over.quote[1] },
  priceUsd: "0.00042",
  liquidity: { usd: 50_000 },
  marketCap: 420_000,
  pairCreatedAt: Date.UTC(2026, 9, 12, 10, 0, 0),
  ...over,
});
const NOW = Date.UTC(2026, 9, 12, 22, 0, 0);

describe("pickCoin", () => {
  it("resolves a token address to its deepest pool, with the numbers the card shows", () => {
    const pairs = [pair({ base: [MINT2, "COIN"], quote: [MINT, "SOL"], liquidity: { usd: 9_000 }, pairAddress: "SHALLOW" }), pair({ base: [MINT2, "COIN"], quote: [MINT, "SOL"], liquidity: { usd: 53_000 }, pairAddress: "DEEP" })];
    const r = pickCoin(MINT2, pairs, NOW)!;
    expect(r).toMatchObject({ chain: "solana", mint: MINT2, symbol: "COIN", pair: "DEEP", liq: 53_000, mcap: 420_000, priceUsd: 0.00042 });
    expect(r.ageH).toBeCloseTo(12, 5);
  });
  it("resolves a pool address to the coin on its base side", () => {
    const p = pair({ base: [MINT2, "COIN"], quote: [MINT, "SOL"], pairAddress: "THEPOOL" });
    expect(pickCoin("THEPOOL", [p], NOW)).toMatchObject({ mint: MINT2, symbol: "COIN", pair: "THEPOOL" });
  });
  it("takes the other side when the pool lists the money first", () => {
    const p = pair({ base: [MINT, "SOL"], quote: [MINT2, "COIN"], pairAddress: "THEPOOL" });
    expect(pickCoin("THEPOOL", [p], NOW)).toMatchObject({ mint: MINT2, symbol: "COIN" });
  });
  it("matches an EVM address whatever its case and maps DexScreener's network to ours", () => {
    const p = pair({ chainId: "bsc", base: [EVM2, "MEME"], quote: [EVM, "WBNB"] });
    expect(pickCoin(EVM2.toLowerCase(), [p], NOW)).toMatchObject({ chain: "bsc", mint: EVM2, symbol: "MEME" });
  });
  it("ignores pools on networks the Radar does not know, and says null when nothing is left", () => {
    const p = pair({ chainId: "cronos", base: [EVM2, "MEME"], quote: [EVM, "WCRO"] });
    expect(pickCoin(EVM2, [p], NOW)).toBeNull();
    expect(pickCoin(EVM2, [], NOW)).toBeNull();
    expect(pickCoin(EVM2, null, NOW)).toBeNull();
  });
  it("prefers the token to a pool that merely has the same address as a pool", () => {
    const asToken = pair({ base: [MINT2, "COIN"], quote: [MINT, "SOL"], pairAddress: "A" });
    const other = pair({ base: [MINT, "OTHER"], quote: [PUMP, "X"], pairAddress: MINT2 });
    expect(pickCoin(MINT2, [other, asToken], NOW)).toMatchObject({ symbol: "COIN" });
  });
  it("falls back to the market value when there is no market cap, and survives missing numbers", () => {
    const p = pair({ base: [MINT2, "COIN"], quote: [MINT, "SOL"], marketCap: null, fdv: 777_000, liquidity: null, pairCreatedAt: null, priceUsd: null });
    expect(pickCoin(MINT2, [p], NOW)).toMatchObject({ mcap: 777_000, liq: null, ageH: null, priceUsd: null });
  });
});
