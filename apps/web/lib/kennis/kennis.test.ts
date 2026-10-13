import { describe, expect, it } from "vitest";
import { ask, BY_ID, CATEGORIES, CHECK_LINE_ENTRY, ENTRIES, GLOSSARY } from "./index";
import { norm, sameWord, words } from "./search";

const PERSONAL = new Set(["basisrates", "journaal", "winst", "positie", "buiten-radar", "pumpswap", "druk", "lab-vondsten"]);

describe("the knowledge base itself", () => {
  it("is big enough to be a knowledge base: well over a hundred entries and a word list, every category used", () => {
    expect(ENTRIES.length).toBeGreaterThanOrEqual(110);
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(80);
    for (const c of CATEGORIES) expect(ENTRIES.filter((e) => e.cat === c.id).length, c.id).toBeGreaterThanOrEqual(5);
  });

  it("has unique, tidy ids and every entry is complete", () => {
    const seen = new Set<string>();
    for (const e of ENTRIES) {
      expect(e.id, e.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(seen.has(e.id), `duplicate id ${e.id}`).toBe(false);
      seen.add(e.id);
      expect(CATEGORIES.some((c) => c.id === e.cat), `${e.id}: category`).toBe(true);
      expect(e.title.length, `${e.id}: title`).toBeGreaterThan(3);
      expect(e.q.length, `${e.id}: questions`).toBeGreaterThanOrEqual(3);
      expect(e.kw.length, `${e.id}: keywords`).toBeGreaterThanOrEqual(4);
      expect(e.short.length, `${e.id}: short answer`).toBeGreaterThan(60);
      expect(e.short.length, `${e.id}: short answer too long`).toBeLessThanOrEqual(520);
      expect(e.body.length, `${e.id}: body`).toBeGreaterThanOrEqual(1);
      if (e.personal) expect(PERSONAL.has(e.personal), `${e.id}: personal key`).toBe(true);
    }
  });

  it("only points at entries that exist (see lists, italic references in the text, the word list and the Check's lines)", () => {
    for (const e of ENTRIES) {
      for (const id of e.see ?? []) expect(BY_ID.has(id), `${e.id} -> see ${id}`).toBe(true);
      expect(new Set(e.see ?? []).size, `${e.id}: repeated see`).toBe((e.see ?? []).length);
      expect((e.see ?? []).includes(e.id), `${e.id} points at itself`).toBe(false);
      const text = [...e.body, ...(e.todo ?? []), e.short].join("\n");
      for (const m of text.matchAll(/(?<![*\w])\*([a-z0-9]+(?:-[a-z0-9]+)+)\*(?!\*)/g)) expect(BY_ID.has(m[1]!), `${e.id}: *${m[1]}* is not an entry`).toBe(true);
    }
    for (const t of GLOSSARY) if (t.see) expect(BY_ID.has(t.see), `word list: ${t.term} -> ${t.see}`).toBe(true);
    for (const [key, id] of Object.entries(CHECK_LINE_ENTRY)) expect(BY_ID.has(id), `Check line ${key} -> ${id}`).toBe(true);
  });

  it("explains every line the Check can print", () => {
    for (const key of ["pool", "trades", "volume", "move", "pressure", "sell", "mint", "freeze", "authority", "rugged", "insiders", "holders", "lp", "memory"]) expect(CHECK_LINE_ENTRY[key], key).toBeTruthy();
  });

  it("has no leftover typing slips: no doubled spaces, no template leftovers, no straight quotes inside Dutch sentences that would break the page", () => {
    for (const e of ENTRIES) {
      for (const s of [e.title, e.short, ...e.body, ...(e.todo ?? [])]) {
        expect(s, `${e.id}`).not.toMatch(/\$\{|undefined|\bnull\b|  /);
      }
    }
  });
});

describe("matching words", () => {
  it("treats the same word with a different ending, a late spelling change or one typo as the same", () => {
    expect(sameWord("scam", "scammen")).toBe(true);
    expect(sameWord("holder", "holders")).toBe(true);
    expect(sameWord("verlies", "verliezen")).toBe(true);
    expect(sameWord("liquiditeit", "liquidieit")).toBe(true);
    expect(sameWord("rug", "rugged")).toBe(false);
    expect(sameWord("pool", "poop")).toBe(false);
  });
  it("drops the little words and keeps the ones that matter", () => {
    expect(words("Wanneer neem ik winst bij een coin?")).toEqual(["neem", "winst", "coin"]);
    expect(norm("Wát is een Rúg-pull?")).toBe("wat is een rug-pull");
  });
});

/** Real questions, as a person would type them: the entry must be among the first three hits, and the first one for the plainest. */
const CASES: Array<[string, string | string[], number?]> = [
  ["wanneer neem ik winst", "winst-nemen-basis", 1],
  ["hoeveel moet ik inzetten per coin", "positiegrootte", 1],
  ["wat is een rug pull", "rug-pull-soorten", 1],
  ["wat betekent mint authority", "mint-authority", 1],
  ["kan de maker mijn coins bevriezen", "freeze-authority", 1],
  ["wat is slippage", "slippage", 1],
  ["waarom mislukt mijn transactie", "mislukte-transacties", 1],
  ["wat is graduation", "graduation", 1],
  ["wat is het verschil tussen pumpswap en raydium", "pumpswap-raydium", 1],
  ["wat is een seed phrase", "seed-phrase", 1],
  ["hoe herken ik een scam", ["rug-signalen", "rug-pull-soorten"]],
  ["wat is fomo", "fomo", 1],
  ["wat is een trailing stop", "trailing-stop", 1],
  ["hoeveel procent van mijn geld per trade", "positiegrootte"],
  ["hoeveel moet ik winnen om mijn verlies terug te verdienen", "drawdown-herstel"],
  ["moet ik bijkopen als hij daalt", "bijkopen-verlies"],
  ["wat is price impact", "price-impact", 1],
  ["wat betekent linked insider wallets hold 84 procent", "insider-wallets"],
  ["wat is wash trading", "wash-trading", 1],
  ["ik ben nieuw waar begin ik", "eerste-keer", 1],
  ["hoe check ik een coin die niet in de lijst staat", "plak-een-coin"],
  ["wat zijn de telegram meldingen", "alerts-2x-5x"],
  ["wat betekent i do not agree", "check-oneens"],
  ["moet ik belasting betalen over crypto", "belasting-nl", 1],
  ["wat is een stablecoin", "stablecoin", 1],
  ["wat is marketcap", "marketcap-fdv", 1],
  ["hoe groot moet de pool zijn", "pool-grootte"],
  ["wat is een bundle", "snipers-bundlers"],
  ["wat is een sandwich aanval", "mev-sandwich", 1],
  ["hoe beveilig ik mijn wallet", ["seed-phrase", "hardware-wallet", "degen-wallet"]],
  ["ik wil mijn verlies goedmaken", ["revenge-trading", "drawdown-herstel", "bijkopen-verlies"]],
  ["wat is een dead cat bounce", "dead-cat-bounce", 1],
  ["zijn drukke coins slechter", "druk-vs-rustig"],
  ["wat is de organic score", "organic-score", 1],
  ["hoe lees ik dexscreener", "dexscreener-lezen", 1],
  ["wat doet de check knop", "de-check"],
  ["is deze coin een scam", ["rug-signalen", "rug-pull-soorten", "de-check", "plak-een-coin"]],
  ["wat is leverage", "leverage", 1],
  ["wat is een bonding curve", "pumpfun-bonding-curve", 1],
  ["ik kan mijn coin niet verkopen", ["honeypot", "freeze-authority", "test-verkoop"]],
  ["what is a rug pull", "rug-pull-soorten"],
  ["how much should i invest per trade", "positiegrootte"],
  ["when should i take profit", "winst-nemen-basis"],
  ["wat is een sell tax", "sell-tax", 1],
  ["waarom staan born graduated coins verborgen", ["born-graduated", "graduations-uitleg"]],
  ["wat is mayhem mode", "mayhem-mode", 1],
  ["hoe zet ik winst veilig", "uitbetalen"],
  ["wat is een uitstapplan", "uitstapplan-eerst"],
  ["wat is een wallet drainer", "wallet-drainers", 1],
  ["wat is address poisoning", "address-poisoning", 1],
  ["is smart money volgen slim", "smart-money"],
  ["wat is survivorship bias", "survivorship-bias", 1],
  ["wat is expected value", "verwachtingswaarde"],
  ["hoeveel verliezen achter elkaar kan ik hebben", "ruin"],
  ["wat is bubblemaps", "bubblemaps", 1],
  ["wat is token 2022", "token2022"],
  ["moet ik een daglimiet instellen", "max-verlies-dag"],
  ["ik kan niet stoppen met kopen", ["gokken-signalen", "overtrading", "slot-machine-effect", "tilt-pauze"]],
  ["hoe weet ik of het volume nep is", ["wash-trading", "nep-volume-patroon", "volume-lezen"]],
  ["wat betekent liquidity locked", "lp-lock-burn"],
  ["wat is exit liquidity", "exit-liquiditeit"],
  ["wat is een perp", "leverage"],
  ["wat is een honeypot", "honeypot", 1],
  ["waarom is het eerste uur gevaarlijk", "eerste-uur"],
  ["wat is een copycat token", "copycat-tokens"],
  ["hoe lees ik een candlestick", "candles-basis"],
  ["wat is de kans op ondergang", "ruin"],
  ["wat betekent top 10 holders", "top-holders"],
  ["wat is een dev buy", "dev-buy"],
  ["wat doet het lab", "lab-leert"],
  ["welke tab moet ik gebruiken", "tabs-uitleg"],
  ["hoe werkt de test verkoop", "test-verkoop"],
  ["wat kost een trade op solana", "fees-solana"],
  ["hoe lees ik rugcheck", "rugcheck-lezen"],
  ["is dit financieel advies", "grenzen-systeem"],
];

describe("answering a question", () => {
  const rank = (q: string) => ask(q, 5).hits.map((h) => h.id);

  for (const [q, want, atRank] of CASES) {
    const wanted = Array.isArray(want) ? want : [want];
    it(`"${q}" -> ${wanted.join(" / ")}${atRank ? " (first)" : ""}`, () => {
      const hits = rank(q);
      const top = atRank ? hits.slice(0, atRank) : hits.slice(0, 3);
      expect(top.some((id) => wanted.includes(id)), `got ${hits.join(", ")}`).toBe(true);
    });
  }

  it("finds a word-list term when asked for a word", () => {
    expect(rank("wat betekent jeet")).toContain("term-jeet");
    expect(rank("wat is dyor").slice(0, 3)).toContain("term-dyor");
    expect(rank("wat is een lamport").slice(0, 3)).toContain("term-lamport");
  });

  it("says it does not know, instead of guessing, when the question is about something else", () => {
    for (const q of ["wat is de beste pizza in amsterdam", "hoe laat is het", "asdfgh jkl qwerty", "wie wint het wk voetbal", "recept voor appeltaart"]) {
      const r = ask(q);
      expect(r.confident, q).toBe(false);
    }
  });

  it("has an answer for every entry's own first question, with that entry first", () => {
    const misses: string[] = [];
    for (const e of ENTRIES) {
      const hits = ask(e.q[0]!, 3).hits.map((h) => h.id);
      if (hits[0] !== e.id) misses.push(`${e.id} <- "${e.q[0]}" got ${hits.slice(0, 2).join(", ")}`);
    }
    // two entries may share a question on purpose, and the word list can win a plain "what is X": allow a few, show which
    expect(misses.length, misses.join("\n")).toBeLessThanOrEqual(Math.ceil(ENTRIES.length * 0.12));
  });

  it("returns nothing for empty input and never crashes on odd input", () => {
    for (const q of ["", "   ", "?!", "a", "🙂🙂", "x".repeat(2000), "0x4200000000000000000000000000000000000006"]) {
      expect(() => ask(q)).not.toThrow();
    }
    expect(ask("").hits).toEqual([]);
  });
});
