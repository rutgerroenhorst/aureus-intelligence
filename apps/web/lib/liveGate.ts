/**
 * The live red-flag gate for a list of coins (docs/RED_FLAGS.md): look at every coin as it is now, and take out the ones that carry a severe flag (lib/redFlags.ts).
 * The coins taken out are returned with their reasons, so a tab can say how many it left out and why, and show them again when asked. A coin whose numbers could not be read is KEPT (failing open: the gate must never
 * empty a list because DexScreener was busy).
 */
import { fetchLive } from "./liveQuotes";
import { liveRedFlags, type FlagContext, type RedFlag } from "./redFlags";
import type { GetJson } from "./dexPairs";

export interface FlaggedOut<T> {
  item: T;
  flags: RedFlag[];
}

export interface Gated<T> {
  kept: T[];
  flaggedOut: Array<FlaggedOut<T>>;
  /** coins that were read */
  checked: number;
  /** coins that could not be read this time (they stay in the list) */
  unknown: number;
}

export async function gateLive<T>(items: T[], opts: { mintOf: (x: T) => string; ctxOf?: (x: T) => FlagContext; getJson?: GetJson; nowMs?: number }): Promise<Gated<T>> {
  if (!items.length) return { kept: [], flaggedOut: [], checked: 0, unknown: 0 };
  // the off switch (RED_FLAGS_LIVE=0, which is also the tests' default): nothing is asked, everything is kept, unless a fake exchange is handed in
  if (process.env.RED_FLAGS_LIVE === "0" && !opts.getJson) return { kept: [...items], flaggedOut: [], checked: 0, unknown: items.length };
  const live = await fetchLive(items.map(opts.mintOf), opts.getJson, opts.nowMs).catch(() => new Map());
  const kept: T[] = [];
  const flaggedOut: Array<FlaggedOut<T>> = [];
  let checked = 0;
  let unknown = 0;
  for (const it of items) {
    const m = opts.mintOf(it);
    if (!live.has(m)) {
      unknown++;
      kept.push(it);
      continue;
    }
    checked++;
    const flags = liveRedFlags(live.get(m) ?? null, opts.ctxOf?.(it) ?? {});
    (flags.length ? flaggedOut.push({ item: it, flags }) : kept.push(it));
  }
  return { kept, flaggedOut, checked, unknown };
}

/** What a route puts next to its list: the coins left out, slim (the card needs the symbol and the reasons; the item itself is kept so that "show them" can put it back). */
export const flaggedPayload = <T>(g: Gated<T>) => ({ flaggedOut: g.flaggedOut.map((f) => ({ ...(f.item as object), redFlags: f.flags })), flagCheck: { checked: g.checked, unknown: g.unknown } });
