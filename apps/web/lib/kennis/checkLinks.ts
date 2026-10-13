/** Which knowledge entry explains each line of the Check (the lines carry these keys: lib/coinCheck.ts). Kept apart from the entries so the Radar page does not load them. */
export const CHECK_LINE_ENTRY: Record<string, string> = {
  pool: "pool-grootte",
  trades: "handelsactiviteit",
  volume: "volume-lezen",
  move: "koersbeweging",
  pressure: "kopers-verkopers",
  sell: "test-verkoop",
  mint: "mint-authority",
  freeze: "freeze-authority",
  authority: "mint-authority",
  rugged: "rug-pull-soorten",
  insiders: "insider-wallets",
  holders: "top-holders",
  lp: "lp-lock-burn",
  memory: "eigen-record",
};
