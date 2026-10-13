import type { Entry, Term } from "./types";

/**
 * Finding the answer to a question in the knowledge base, without a model: the question is cut into words, the words are compared with the title, the
 * questions, the keywords, the short answer and the text of every entry (a hit in the title weighs most), rare words weigh more than common ones, a few
 * Dutch and English words that mean the same are treated as one, and a typo of one letter still counts. When nothing fits well enough the answer is
 * "I do not know that" and the question is kept for later (the page does that), never a made-up answer.
 */

const STOP = new Set(
  (
    "de het een en of ik je jij jouw mijn me mij is zijn was waren wat wie hoe wanneer waar waarom welke welk moet moeten kan kun kunnen mag mogen voor van op in met bij naar dat dit die deze te om als dan ook maar nog er wel niet geen " +
    "heb heeft hebben hebt doe doet doen gaat gaan ga wil wilt willen zou zouden zal over uit aan tot door per zo nu hier daar dus toch al wordt worden word iets niets alles alle veel meer meest weinig beetje gewoon eigenlijk echt erg heel " +
    "ons onze hun hem haar ze zij wij we u zeg graag eens even misschien bijvoorbeeld laat " +
    "the a an are were what how when why do does did can could should would i my me you your to of in on for with and or not it this that there be been being if as at by from about into so just really very much more most any some"
  ).split(" "),
);

/** Words that mean the same: a query word counts as all of them. */
const SAME: string[][] = [
  ["winst", "profit", "profits", "gain", "gains", "opbrengst"],
  ["verlies", "verliezen", "loss", "losses", "kwijt", "verlies"],
  ["uitstappen", "uitstap", "exit", "verkopen", "verkoop", "sell", "selling", "uitgang"],
  ["instappen", "instap", "entry", "kopen", "koop", "buy", "buying", "inkoop"],
  ["oplichting", "oplichter", "oplichters", "scam", "scams", "scammer", "scammers", "fraude", "bedrog", "frauduleus"],
  ["rug", "rugpull", "rugged", "rugs", "rugpulls"],
  ["liquiditeit", "liquidity", "pool", "pools", "liquiditeitspool"],
  ["holders", "holder", "houders", "houder", "bezitters"],
  ["wallet", "wallets", "portemonnee", "portefeuille"],
  ["risico", "risicos", "risk", "risks", "gevaar", "gevaarlijk"],
  ["inleg", "inzet", "stake", "positie", "position", "bedrag"],
  ["veilig", "veiligheid", "safe", "safety", "security", "beveiliging", "beveiligen"],
  ["coin", "coins", "munt", "munten", "token", "tokens"],
  ["belasting", "tax", "taxes", "fiscus", "belastingdienst"],
  ["stoploss", "stop-loss", "stop"],
  ["bankroll", "kapitaal", "spaargeld", "budget"],
  ["dev", "maker", "creator", "ontwikkelaar", "oprichter", "deployer"],
  ["koers", "prijs", "price", "kurs"],
  ["volume", "omzet", "handelsvolume"],
  ["winst-nemen", "takeprofit", "take-profit", "tp"],
];
const GROUP_OF = new Map<string, string[]>();
for (const g of SAME) for (const w of g) GROUP_OF.set(w, g);

export const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9$%+ -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The words of a text that carry meaning (no little words), in order, without repeats of meaning added. */
export function words(s: string): string[] {
  return norm(s)
    .split(/[ -]+/)
    .filter((w) => w.length >= 2 && !STOP.has(w));
}

/** Exactly one typo apart: one letter different, one letter extra, or two neighbouring letters swapped. */
function oneEdit(a: string, b: string): boolean {
  if (a === b) return false;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return la > lb ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

/** Do two words count as the same word? Equal, one the beginning of the other ("scam" and "scammen"), the same up to a late letter ("verlies" and "verliezen"), or one typo apart. */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const m = Math.min(a.length, b.length);
  if (m < 4) return false;
  if ((a.startsWith(b) || b.startsWith(a)) && Math.abs(a.length - b.length) <= 5) return true;
  let p = 0;
  while (p < m && a[p] === b[p]) p++;
  if (p >= 5 && p >= 0.8 * m) return true;
  return m >= 6 && oneEdit(a, b);
}

const W = { title: 6, q: 5, kw: 5, short: 2.5, body: 1 } as const;

interface Doc {
  id: string;
  kind: "entry" | "term";
  entry?: Entry;
  term?: Term;
  title: string;
  /** word -> the weight of the best field it appears in */
  tokens: Map<string, number>;
  /** whole phrases for the phrase bonuses: normalised questions, keywords and the title */
  qs: string[];
  kws: string[];
  titleN: string;
}

function addTokens(map: Map<string, number>, text: string, weight: number) {
  for (const w of words(text)) if ((map.get(w) ?? 0) < weight) map.set(w, weight);
}

export function buildDocs(entries: Entry[], terms: Term[]): Doc[] {
  const docs: Doc[] = [];
  for (const e of entries) {
    const tokens = new Map<string, number>();
    addTokens(tokens, e.title, W.title);
    for (const q of e.q) addTokens(tokens, q, W.q);
    for (const k of e.kw) addTokens(tokens, k, W.kw);
    addTokens(tokens, e.short, W.short);
    for (const b of e.body) addTokens(tokens, b, W.body);
    for (const t of e.todo ?? []) addTokens(tokens, t, W.body);
    docs.push({ id: e.id, kind: "entry", entry: e, title: e.title, tokens, qs: e.q.map(norm), kws: e.kw.map(norm), titleN: norm(e.title) });
  }
  for (const t of terms) {
    const tokens = new Map<string, number>();
    addTokens(tokens, t.term, W.title);
    for (const a of t.aka ?? []) addTokens(tokens, a, W.kw);
    addTokens(tokens, t.def, W.short);
    const slug = norm(t.term).replace(/ /g, "-");
    docs.push({ id: `term-${slug}`, kind: "term", term: t, title: t.term, tokens, qs: [], kws: [norm(t.term), ...(t.aka ?? []).map(norm)], titleN: norm(t.term) });
  }
  return docs;
}

export interface Hit {
  id: string;
  kind: "entry" | "term";
  entry?: Entry;
  term?: Term;
  score: number;
  /** the share of the question's words that were found */
  coverage: number;
}

export interface Result {
  hits: Hit[];
  /** true when the best hit is good enough to be shown as "the answer" */
  confident: boolean;
  /** the words of the question that matched nothing at all */
  unknown: string[];
}

const CONFIDENT_SCORE = 7;
const CONFIDENT_COVERAGE = 0.5;

function wholePhrase(haystack: string, phrase: string): boolean {
  if (!phrase) return false;
  return (" " + haystack + " ").includes(" " + phrase + " ");
}

export function searchDocs(docs: Doc[], query: string, limit = 8): Result {
  const qn = norm(query);
  const qw = [...new Set(words(query))];
  if (!qw.length) {
    // only little words: it can still be an entry's question, word for word
    const exact = qn ? docs.filter((d) => d.qs.includes(qn)) : [];
    return { hits: exact.map((d) => ({ id: d.id, kind: d.kind, entry: d.entry, term: d.term, score: 30, coverage: 1 })), confident: exact.length > 0, unknown: [] };
  }
  const N = docs.length;

  // per query word: which docs have it (with the best weight), and how rare it is
  const per = qw.map((w) => {
    const variants = GROUP_OF.get(w) ?? [w];
    const weights = new Float32Array(N);
    let df = 0;
    for (let i = 0; i < N; i++) {
      let best = 0;
      for (const [t, wt] of docs[i]!.tokens) {
        if (wt <= best) continue;
        for (const v of variants) {
          if (sameWord(v, t)) {
            best = wt;
            break;
          }
        }
      }
      weights[i] = best;
      if (best > 0) df++;
    }
    return { w, weights, df, idf: df ? Math.log(1 + N / df) : 0 };
  });
  const unknown = per.filter((p) => p.df === 0).map((p) => p.w);

  const hits: Hit[] = [];
  for (let i = 0; i < N; i++) {
    const d = docs[i]!;
    let score = 0;
    let matched = 0;
    for (const p of per) {
      const wt = p.weights[i]!;
      if (wt > 0) {
        score += wt * p.idf;
        matched++;
      }
    }
    if (!matched) continue;
    // whole phrases count for much more than loose words
    for (const q of d.qs) {
      if (!q) continue;
      if (q === qn) score += 30;
      else if (qn.length >= 8 && (wholePhrase(qn, q) || wholePhrase(q, qn))) score += 10;
    }
    if (d.titleN && (d.titleN === qn || (d.titleN.length >= 5 && wholePhrase(qn, d.titleN)))) score += 10;
    for (const k of d.kws) if (k && (k.includes(" ") || k.length >= 5) && wholePhrase(qn, k)) score += k.includes(" ") ? 6 : 2;
    const coverage = matched / qw.length;
    score *= 0.4 + 0.6 * coverage;
    hits.push({ id: d.id, kind: d.kind, entry: d.entry, term: d.term, score, coverage });
  }
  hits.sort((a, b) => b.score - a.score);
  const top = hits[0];
  const confident = Boolean(top && top.score >= CONFIDENT_SCORE && top.coverage >= CONFIDENT_COVERAGE);
  return { hits: hits.slice(0, limit), confident, unknown };
}
