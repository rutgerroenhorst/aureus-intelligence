import type { Entry, Term } from "./types";

/**
 * Finding the answer to a question in the knowledge base, without a model: the question is cut into words, the words are compared with the title, the
 * questions, the keywords, the short answer and the text of every entry (a hit in the title weighs most), rare words weigh more than common ones, a few
 * Dutch and English words that mean the same are treated as one, a different ending, a past participle ("gedumpt"), a compound ("tradingjournaal") and a
 * typo of one letter still count, and an entry that has a question which looks like yours gets a bonus. When nothing fits well enough the answer is
 * "I do not know that" and the question is kept for later (the page does that), never a made-up answer.
 */

const STOP = new Set(
  (
    "de het een en of ik je jij jouw mijn me mij is zijn was waren wat wie hoe wanneer waar waarom welke welk moet moeten kan kun kunnen mag mogen voor van op in met bij naar dat dit die deze te om als dan ook maar nog er wel niet geen " +
    "heb heeft hebben hebt doe doet doen gaat gaan ga wil wilt willen zou zouden zal over uit aan tot door per zo nu hier daar dus toch al wordt worden word iets niets alles alle veel meer meest weinig beetje gewoon eigenlijk echt erg heel " +
    "ons onze hun hem haar ze zij wij we u zeg graag eens even misschien bijvoorbeeld laat weer vandaag morgen gisteren weet weten zie zien beste goede goed slechte " +
    "the a an are were what how when why do does did can could should would i my me you your to of in on for with and or not it this that there be been being if as at by from about into so just really very much more most any some"
  ).split(" "),
);

/** Words that mean the same: a query word counts as all of them. A word may sit in more than one group. */
const SAME: string[][] = [
  ["winst", "profit", "profits", "gain", "gains", "opbrengst"],
  ["verlies", "verliezen", "loss", "losses", "kwijt", "verlies"],
  ["uitstappen", "uitstap", "exit", "verkopen", "verkoop", "sell", "selling", "uitgang"],
  ["instappen", "instap", "entry", "kopen", "koop", "buy", "buying", "inkoop"],
  ["oplichting", "oplichter", "oplichters", "scam", "scams", "scammer", "scammers", "fraude", "bedrog", "frauduleus", "opgelicht"],
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
  ["traden", "trade", "trades", "trading", "trader", "traders", "handelen", "handel"],
  ["hack", "hacken", "gehackt", "hacker", "hackers", "gestolen", "stelen", "diefstal", "leeggehaald", "leeggetrokken", "drainer", "drainers"],
  ["verdienen", "verdienste", "verdiensten", "inkomen", "rijk", "miljonair", "winstgevend", "rendement"],
  ["tips", "tip", "advies", "adviseren", "aanrader", "aanraden", "voorspellen", "voorspelling", "koopadvies"],
  ["boos", "kwaad", "woedend", "gefrustreerd", "frustratie", "chagrijnig", "tilt"],
  ["bang", "angst", "eng", "paniek", "panikeren", "zenuwachtig", "stress"],
  ["verslaafd", "verslaving", "verslavend", "gokken", "gokverslaving", "dwangmatig"],
  ["blockchain", "keten", "ledger", "grootboek"],
  ["nep", "fake", "vals", "namaak", "kopie", "copy", "copycat", "kloon", "clone"],
  ["dalen", "daalt", "daal", "gedaald", "daling", "zakken", "zakt", "gezakt", "keldert", "kelderen", "crash", "crashen", "crasht", "instorten"],
  ["dump", "dumpen", "dumpt", "gedumpt", "dumped"],
  ["criterium", "criterion", "criteria"],
  ["network", "networks", "netwerk", "netwerken"],
];
const GROUPS_OF = new Map<string, Set<string>>();
for (const g of SAME) {
  for (const w of g) {
    const s = GROUPS_OF.get(w) ?? new Set<string>();
    for (const x of g) s.add(x);
    GROUPS_OF.set(w, s);
  }
}
const variantsOf = (w: string): string[] => [...(GROUPS_OF.get(w) ?? [w])];

export const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/×/g, "x")
    .replace(/\buit te stappen\b/g, "uitstappen")
    .replace(/\bin te stappen\b/g, "instappen")
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

/** Exactly one typo apart: one letter extra or missing, two neighbouring letters swapped, or (only in long words: "pending" is not "lending") one letter different. */
function oneEdit(a: string, b: string): boolean {
  if (a === b) return false;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) return (la >= 8 && a.slice(i + 1) === b.slice(i + 1)) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return la > lb ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

/** The root of a Dutch past participle or a word in -ing / -er ("gedumpt" and "dumpen" -> "dump", "trading" and "traders" -> "trad"). Other words stay as they are. */
function root(w: string): string {
  if (w.length >= 7 && w.startsWith("ge") && /[td]$/.test(w)) return w.slice(2, -1);
  if (w.length >= 7 && /ingen?$/.test(w)) return w.replace(/ingen?$/, "");
  if (w.length >= 6 && /ers?$/.test(w)) return w.replace(/ers?$/, "");
  return w;
}

function prefixRule(a: string, b: string, maxDiff: number): boolean {
  return (a.startsWith(b) || b.startsWith(a)) && Math.abs(a.length - b.length) <= maxDiff;
}

/** Do two words count as the same word? Equal, one the beginning of the other ("scam" and "scammen"), the same up to a late letter ("verlies" and "verliezen"), the same root ("gedumpt" and "dumpen"), or one typo apart. */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const m = Math.min(a.length, b.length);
  if (m < 4) return false;
  if (prefixRule(a, b, 5)) return true;
  let p = 0;
  while (p < m && a[p] === b[p]) p++;
  if (p >= 6 && p >= 0.8 * m) return true;
  const ra = root(a);
  const rb = root(b);
  if ((ra !== a || rb !== b) && ra.length >= 4 && rb.length >= 4 && prefixRule(ra, rb, 3)) return true;
  return m >= 6 && oneEdit(a, b);
}

const W = { title: 6, q: 5, kw: 5, short: 2.5, body: 1 } as const;
const HEADLINE = 5;

interface Doc {
  id: string;
  kind: "entry" | "term";
  entry?: Entry;
  term?: Term;
  title: string;
  /** word -> the weight of the best field it appears in */
  tokens: Map<string, number>;
  /** the words of the title and keywords (what the entry is about), as opposed to words that only occur in a sample question or the text */
  topic: Set<string>;
  /** whole phrases for the phrase bonuses: normalised questions, keywords and the title */
  qs: string[];
  /** the meaningful words of each question, for the "looks like your question" bonus */
  qws: string[][];
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
    const topic = new Set([...words(e.title), ...e.kw.flatMap(words)]);
    docs.push({ id: e.id, kind: "entry", entry: e, title: e.title, tokens, topic, qs: e.q.map(norm), qws: e.q.map(words), kws: e.kw.map(norm), titleN: norm(e.title) });
  }
  for (const t of terms) {
    const tokens = new Map<string, number>();
    addTokens(tokens, t.term, W.title);
    for (const a of t.aka ?? []) addTokens(tokens, a, W.kw);
    addTokens(tokens, t.def, W.short);
    const slug = norm(t.term).replace(/ /g, "-");
    const topic = new Set([...words(t.term), ...(t.aka ?? []).flatMap(words)]);
    docs.push({ id: `term-${slug}`, kind: "term", term: t, title: t.term, tokens, topic, qs: [], qws: [], kws: [norm(t.term), ...(t.aka ?? []).map(norm)], titleN: norm(t.term) });
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
/** the "looks like your question" bonus: nothing up to this likeness (0 to 1), then rising to LIKE_BONUS for a question with the same words */
const LIKE_FROM = 0.4;
const LIKE_BONUS = 18;
/** with this much support from whole phrases and look-alike questions a single matching word is enough for "the answer" */
const STRONG_EVIDENCE = 8;
/**
 * a word that few entries are about (such as "kelly", "honeypot" or "slippage": in the title or keywords of at most RARE_TOPIC_DF entries, and in the text of
 * at most RARE_DF) is enough on its own: it is what the entry is about
 */
const RARE_TOPIC_DF = 6;
const RARE_DF = 25;
/** ... and then a third of the question found is enough (a long question has many words that no entry has) */
const RARE_COVERAGE = 0.3;

function wholePhrase(haystack: string, phrase: string): boolean {
  if (!phrase) return false;
  return (" " + haystack + " ").includes(" " + phrase + " ");
}

/** Every distinct word of the knowledge base with the entries that have it: a query word is compared with each distinct word once, not with every entry's words. */
interface TokenIndex {
  vocab: Set<string>;
  tokens: string[];
  /** per token: [doc index, weight, whether the word is a title or keyword word of that doc] */
  postings: Array<Array<[number, number, boolean]>>;
}
const indexes = new WeakMap<Doc[], TokenIndex>();
function indexOf(docs: Doc[]): TokenIndex {
  let ix = indexes.get(docs);
  if (!ix) {
    const by = new Map<string, Array<[number, number, boolean]>>();
    docs.forEach((d, i) => {
      for (const [t, wt] of d.tokens) {
        let list = by.get(t);
        if (!list) by.set(t, (list = []));
        list.push([i, wt, d.topic.has(t)]);
      }
    });
    ix = { vocab: new Set(by.keys()), tokens: [...by.keys()], postings: [...by.values()] };
    indexes.set(docs, ix);
  }
  return ix;
}

/** A long word the knowledge base does not have but that is two words it has ("tradingjournaal", "winstnemen", "liquiditeitspool") counts as both (or as the known end of it). */
function splitCompound(w: string, vocab: Set<string>): string[] {
  if (w.length < 9 || vocab.has(w) || /[0-9$%]/.test(w)) return [w];
  let tailOnly: string | null = null;
  for (let cut = 4; cut <= w.length - 4; cut++) {
    const tail = w.slice(cut);
    if (!vocab.has(tail)) continue;
    const head = w.slice(0, cut);
    const h = [head, head.replace(/(en|s|e)$/, "")].find((x) => x.length >= 4 && vocab.has(x));
    if (h) return [h, tail];
    if (tail.length >= 6 && !tailOnly) tailOnly = tail;
  }
  return tailOnly ? [tailOnly] : [w];
}

/**
 * How much two questions look alike, 0 to 1: the F1 of the meaningful words they share (endings and synonyms count). The words of your question count by
 * how rare they are, so sharing "dumpen" says more than sharing "weet" or "coin".
 */
function likeness(qVars: string[][], qIdf: number[], tWords: string[]): number {
  if (qVars.length < 2 || tWords.length < 2) return 0;
  const usedT = new Set<number>();
  let all = 0;
  let hit = 0;
  qVars.forEach((vars, k) => {
    all += qIdf[k]!;
    let found = false;
    for (let j = 0; j < tWords.length; j++) {
      if (vars.some((v) => sameWord(v, tWords[j]!))) {
        usedT.add(j);
        found = true;
      }
    }
    if (found) hit += qIdf[k]!;
  });
  if (!hit || !all) return 0;
  const p = usedT.size / tWords.length;
  const r = hit / all;
  return (2 * p * r) / (p + r);
}

/** A number that matched nothing says nothing about the topic ("2x" and "40%" are only useful when an entry has them). */
const NUMBERISH = /^[0-9$%+.,x]+$/;

export function searchDocs(docs: Doc[], query: string, limit = 8): Result {
  const qn = norm(query);
  const ix = indexOf(docs);
  const vocab = ix.vocab;
  const qwAll = [...new Set(words(query).flatMap((w) => splitCompound(w, vocab)))];
  if (!qwAll.length) {
    // only little words: it can still be an entry's question, word for word
    const exact = qn ? docs.filter((d) => d.qs.includes(qn)) : [];
    return { hits: exact.map((d) => ({ id: d.id, kind: d.kind, entry: d.entry, term: d.term, score: 30, coverage: 1 })), confident: exact.length > 0, unknown: [] };
  }
  const N = docs.length;

  // per query word: which docs have it (with the best weight), and how rare it is
  const perAll = qwAll.map((w) => {
    const variants = variantsOf(w);
    const weights = new Float32Array(N);
    const onTopic = new Uint8Array(N);
    for (let t = 0; t < ix.tokens.length; t++) {
      const tok = ix.tokens[t]!;
      if (!variants.some((v) => sameWord(v, tok))) continue;
      for (const [i, wt, top] of ix.postings[t]!) {
        if (wt > weights[i]!) weights[i] = wt;
        if (top) onTopic[i] = 1;
      }
    }
    let df = 0;
    let topicDf = 0;
    for (let i = 0; i < N; i++) {
      if (weights[i]! > 0) df++;
      if (onTopic[i]) topicDf++;
    }
    return { w, variants, weights, onTopic, df, topicDf, idf: df ? Math.log(1 + N / df) : 0 };
  });
  const per = perAll.filter((p) => p.df > 0 || !NUMBERISH.test(p.w));
  if (!per.length) return { hits: [], confident: false, unknown: [] };
  const unknown = per.filter((p) => p.df === 0).map((p) => p.w);
  const qVars = per.map((p) => p.variants);
  const qIdf = per.map((p) => p.idf);

  const hits: Hit[] = [];
  const headline = new Set<string>();
  const rareDocs = new Set<string>();
  for (let i = 0; i < N; i++) {
    const d = docs[i]!;
    let score = 0;
    let matched = 0;
    let head = false;
    let rare = false;
    for (const p of per) {
      const wt = p.weights[i]!;
      if (wt > 0) {
        score += wt * p.idf;
        matched++;
        if (wt >= HEADLINE) {
          head = true;
          if (p.onTopic[i] && p.topicDf <= RARE_TOPIC_DF && p.df <= RARE_DF) rare = true;
        }
      }
    }
    if (!matched) continue;
    // whole phrases and look-alike questions count for much more than loose words
    let evidence = 0;
    let like = 0;
    for (let k = 0; k < d.qs.length; k++) {
      const q = d.qs[k]!;
      if (!q) continue;
      if (q === qn) evidence += 30;
      else if (qn.length >= 8 && (wholePhrase(qn, q) || wholePhrase(q, qn))) evidence += 10;
      like = Math.max(like, likeness(qVars, qIdf, d.qws[k]!));
    }
    if (like > LIKE_FROM) evidence += (LIKE_BONUS * (like - LIKE_FROM)) / (1 - LIKE_FROM);
    if (d.titleN && (d.titleN === qn || (d.titleN.length >= 5 && wholePhrase(qn, d.titleN)))) evidence += 10;
    for (const k of d.kws) if (k && (k.includes(" ") || k.length >= 5) && wholePhrase(qn, k)) evidence += k.includes(" ") ? 6 : 2;
    score += evidence;
    const coverage = matched / per.length;
    score *= 0.4 + 0.6 * coverage;
    hits.push({ id: d.id, kind: d.kind, entry: d.entry, term: d.term, score, coverage });
    if (head && (matched >= 2 || per.length === 1 || evidence >= STRONG_EVIDENCE || rare)) headline.add(d.id);
    if (rare) rareDocs.add(d.id);
  }
  hits.sort((a, b) => b.score - a.score);
  const top = hits[0];
  // "the answer" needs a good score, most of the question found, and more than a chance word in the text: a title, question or keyword hit, and either two matching words, support from a look-alike question or phrase, or one word that few entries have
  const confident = Boolean(top && top.score >= CONFIDENT_SCORE && top.coverage >= (rareDocs.has(top.id) ? RARE_COVERAGE : CONFIDENT_COVERAGE) && headline.has(top.id));
  return { hits: hits.slice(0, limit), confident, unknown: unknown.filter((w) => /[a-z]{3,}/.test(w)) };
}
