/**
 * The networks the Radar can look at, with the names each free source uses for them.
 *
 * FOMO (the trading app) supports Solana, Base, BNB Chain and Monad (per the DataWallet explainer: Base from September 2025,
 * BNB Chain from October 2025, Monad from its mainnet in November 2025); a newer snippet also lists Ethereum and Robinhood Chain,
 * which could not be confirmed on a second source, so they carry no FOMO mark here.
 */

export interface ChainInfo {
  /** our id, also what the journal stores */
  id: string;
  label: string;
  /** GeckoTerminal network id */
  gt: string;
  /** DexScreener chain id */
  dex: string;
  /** DefiLlama chain name for DEX volume, null when it has none */
  llama: string | null;
  evm: boolean;
  /** supported by the FOMO app (confirmed) */
  fomo: boolean;
}

export const CHAINS: ChainInfo[] = [
  { id: "solana", label: "Solana", gt: "solana", dex: "solana", llama: "Solana", evm: false, fomo: true },
  { id: "base", label: "Base", gt: "base", dex: "base", llama: "Base", evm: true, fomo: true },
  { id: "bsc", label: "BNB Chain", gt: "bsc", dex: "bsc", llama: "BSC", evm: true, fomo: true },
  { id: "monad", label: "Monad", gt: "monad", dex: "monad", llama: "Monad", evm: true, fomo: true },
  { id: "ethereum", label: "Ethereum", gt: "eth", dex: "ethereum", llama: "Ethereum", evm: true, fomo: false },
  { id: "robinhood", label: "Robinhood Chain", gt: "robinhood", dex: "robinhood", llama: null, evm: true, fomo: false },
];

export const CHAIN_BY_ID = new Map(CHAINS.map((c) => [c.id, c]));

const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

/** Is this a token address of that chain? Unknown chains are never valid. */
export function isTokenAddress(chain: string, s: unknown): s is string {
  const c = CHAIN_BY_ID.get(chain);
  if (!c || typeof s !== "string") return false;
  return c.evm ? EVM_RE.test(s) : SOLANA_RE.test(s);
}

/** The DexScreener page of a pool (preferred) or token on a chain. */
export function dexUrl(chain: string, addressOrPair: string): string {
  const c = CHAIN_BY_ID.get(chain);
  return `https://dexscreener.com/${c?.dex ?? chain}/${addressOrPair}`;
}
