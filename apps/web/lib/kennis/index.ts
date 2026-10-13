import { auriga } from "./entries/auriga";
import { basis } from "./entries/basis";
import { handelen } from "./entries/handelen";
import { holders } from "./entries/holders";
import { memecoins } from "./entries/memecoins";
import { patronen } from "./entries/patronen";
import { psychologie } from "./entries/psychologie";
import { risico } from "./entries/risico";
import { scams } from "./entries/scams";
import { tools } from "./entries/tools";
import { veiligheid } from "./entries/veiligheid";
import { winst } from "./entries/winst";
import { CHECK_LINE_ENTRY } from "./checkLinks";
import { GLOSSARY } from "./glossary";
import { buildDocs, searchDocs, type Result } from "./search";
import type { Category, CategoryId, Entry } from "./types";

export type { Category, CategoryId, Entry, Facts, PersonalKey, Term } from "./types";
export { GLOSSARY } from "./glossary";
export { CHECK_LINE_ENTRY };

export const CATEGORIES: Category[] = [
  { id: "basis", title: "Basis", blurb: "Wallets, tokens, netwerken, wat een pool is en wat het kost" },
  { id: "handelen", title: "Handelen op een DEX", blurb: "Slippage, price impact, volume, liquiditeit en waarom je transactie mislukt" },
  { id: "memecoins", title: "Pump.fun en memecoins", blurb: "De bonding curve, graduation, snipers en de levenscyclus" },
  { id: "holders", title: "Holders en wallets", blurb: "Concentratie, insiders, authorities en wat de maker doet" },
  { id: "scams", title: "Scams en rugs", blurb: "Rug pulls, honeypots, kopieën en de checklist" },
  { id: "veiligheid", title: "Veiligheid", blurb: "Seed phrase, aparte wallet, phishing, drainers en bots" },
  { id: "patronen", title: "Patronen", blurb: "Pump-and-dump, nep-volume, toppen en wat het lab zag" },
  { id: "risico", title: "Risicomanagement", blurb: "Inzet, bankroll, stops, verwachtingswaarde en je eigen cijfers" },
  { id: "winst", title: "Winst nemen en uitstappen", blurb: "Inleg terug, trailing stop, uitbetalen en ons onderzoek" },
  { id: "psychologie", title: "Psychologie", blurb: "FOMO, revenge trading, tilt en discipline" },
  { id: "tools", title: "Tools", blurb: "DexScreener, RugCheck, Solscan, Bubblemaps en terminals" },
  { id: "auriga", title: "Dit systeem", blurb: "De tabs, de Check, het lab, de meldingen en de grenzen" },
];

export const ENTRIES: Entry[] = [...basis, ...handelen, ...memecoins, ...holders, ...scams, ...veiligheid, ...patronen, ...risico, ...winst, ...psychologie, ...tools, ...auriga];

export const BY_ID = new Map(ENTRIES.map((e) => [e.id, e]));

let docs: ReturnType<typeof buildDocs> | null = null;

/** Answer a question: the best entries and word-list terms, and whether the best one is good enough to call "the answer". */
export function ask(query: string, limit = 8): Result {
  docs ??= buildDocs(ENTRIES, GLOSSARY);
  return searchDocs(docs, query, limit);
}

export const categoryOf = (id: CategoryId): Category => CATEGORIES.find((c) => c.id === id)!;
