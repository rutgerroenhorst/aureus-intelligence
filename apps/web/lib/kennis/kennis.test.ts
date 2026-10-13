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
    for (const q of ["wat is de beste pizza in amsterdam", "hoe laat is het", "asdfgh jkl qwerty", "wie wint het wk voetbal", "recept voor appeltaart", "wat is het weer vandaag", "wat is de hoofdstad van frankrijk", "wie is de president"]) {
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
    expect(misses.length, misses.join("\n")).toBe(0);
  });

  it("finds every entry from every one of its own sample questions within the first three hits, and first almost always", () => {
    const lost: string[] = [];
    let total = 0;
    let first = 0;
    for (const e of ENTRIES) {
      for (const q of e.q) {
        total++;
        const hits = ask(q, 3).hits.map((h) => h.id);
        if (hits[0] === e.id) first++;
        if (!hits.includes(e.id)) lost.push(`${e.id} <- "${q}" got ${hits.join(", ")}`);
      }
    }
    expect(lost.length, lost.join("\n")).toBe(0);
    expect(first / total).toBeGreaterThanOrEqual(0.98);
  }, 30_000);

  it("returns nothing for empty input and never crashes on odd input", () => {
    for (const q of ["", "   ", "?!", "a", "🙂🙂", "x".repeat(2000), "0x4200000000000000000000000000000000000006"]) {
      expect(() => ask(q)).not.toThrow();
    }
    expect(ask("").hits).toEqual([]);
  });
});

/** Questions written after the first release, in other words than the entries' own: they found nothing or the wrong thing at first, and are the reason for the matching rules below. */
const FRESH: Array<[string, string | string[], number?]> = [
  ["ik heb een coin gekocht en hij daalt, wat nu", ["bijkopen-verlies", "waarom-daalt-snel", "uitstapplan-eerst", "verlies-accepteren"]],
  ["wanneer moet ik verkopen", "winst-nemen-basis", 1],
  ["hoe voorkom ik dat ik mijn geld kwijtraak", "risico-basis", 1],
  ["hoeveel winst moet ik pakken", "winst-nemen-basis", 1],
  ["wat betekent liquidity", "liquiditeit-amm", 1],
  ["hoe weet ik of het een scam is", "rug-signalen", 1],
  ["mag ik mijn inleg terugpakken", "inleg-terug", 1],
  ["wat is dca", "dca", 1],
  ["welke coin moet ik kopen", "geen-tips", 1],
  ["wat is de beste coin om nu te kopen", "geen-tips", 1],
  ["is dit een goed moment om te kopen", "geen-tips", 1],
  ["gaat solana stijgen", "geen-tips", 1],
  ["hoe herken ik een gem", "geen-tips", 1],
  ["is een coin met 40% bij 1 wallet veilig", "top-holders", 1],
  ["mijn transactie mislukt steeds", "mislukte-transacties", 1],
  ["mijn transactie is pending", "mislukte-transacties", 1],
  ["mijn swap geeft een fout", "mislukte-transacties", 1],
  ["waarom is mijn coin zo snel gedaald", "waarom-daalt-snel", 1],
  ["waarom daalt mijn coin na graduation", "graduation-dump", 1],
  ["wat is een goede inzet per coin", "positiegrootte", 1],
  ["hoe bereken ik mijn risico", "positiegrootte", 1],
  ["ik wil alles terugwinnen wat ik verloren heb", "revenge-trading", 1],
  ["waarom staat er geen coin in mijn lijst", "waarom-niet-op-radar", 1],
  ["hoe vaak moet ik de radar bekijken", "dagelijks-gebruik", 1],
  ["wat is een drainer", "wallet-drainers", 1],
  ["wat is bitcoin", "bitcoin", 1],
  ["wat is een blockchain", "blockchain", 1],
  ["wat is een smart contract", "smart-contract", 1],
  ["wat is defi", "defi", 1],
  ["wat is een nft", "nft", 1],
  ["wat is staking", "staking", 1],
  ["wat is een node", "node-validator", 1],
  ["hoe werkt solana", "chains", 1],
  ["hoe zie ik of de dev gedumpt heeft", "dev-wallet", 1],
  ["kan ik de dev vertrouwen", "dev-wallet", 1],
  ["wat is een doxxed dev", "dev-wallet", 1],
  ["hoeveel geld kan ik verdienen met memecoins", "realistisch-verdienen", 1],
  ["hoe word ik rijk met memecoins", "realistisch-verdienen", 1],
  ["waarom zit ik zo vaak in de min", "jouw-cijfers", 1],
  ["hoe weet ik of ik wordt opgelicht", "scam-overzicht", 1],
  ["wat is een crypto scam", "scam-overzicht", 1],
  ["kan iemand mijn wallet hacken", "wallet-hack", 1],
  ["hoe koop ik mijn eerste memecoin", "eerste-keer", 1],
  ["is 100 dollar genoeg om te starten", ["eerste-keer", "bankroll"]],
  ["hoe werkt een swap op jupiter", "jupiter-aggregator", 1],
  ["hoe weet ik of de liquidity echt is", "nep-liquiditeit", 1],
  ["wat is een tradingjournaal", "journaal", 1],
  ["hoe houd ik een journaal bij", "journaal", 1],
  ["ik kan niet stoppen met traden", "gokken-signalen", 1],
  ["wat is een pauze nemen", "tilt-pauze", 1],
  ["hoe ga ik om met een groot verlies", "verlies-accepteren", 1],
  ["wat is het beste moment om uit te stappen", "winst-nemen-basis", 1],
  ["hoe weet ik wanneer ik moet verkopen", "winst-nemen-basis", 1],
  ["ik heb te laat verkocht", "uitstapplan-eerst", 1],
  ["hoe maak ik een wallet aan", "wallet-basis", 1],
  ["wat zijn sol fees", "fees-solana", 1],
  ["kan ik een coin kopen zonder sol", "fees-solana", 1],
  ["hoe herken ik een nep token", "copycat-tokens", 1],
  ["mijn coin is een scam wat nu", "na-een-rug", 1],
  ["wanneer pak ik mijn inleg eruit", "inleg-terug", 1],
  ["hoe werkt het lab", "lab-leert", 1],
  ["wat is de wallet sync", "journaal-enter", 1],
  ["hoe maak ik een memecoin", "memecoin-maken", 1],
  ["hoe weet ik of er bots in mijn coin zitten", "snipers-bundlers", 1],
  ["wat is een political coin", "nieuws-coins", 1],
  ["waarom stijgt een coin na een tweet", "nieuws-coins", 1],
  ["hoe lang duurt een pump", "memecoin-levenscyclus", 1],
  ["wat zijn de beste tools voor memecoins", "terminals", 1],
  ["hoe vind ik nieuwe coins", "coins-vinden", 1],
  ["hoe weet ik of een coin trending is", "coins-vinden", 1],
  ["waarom krijg ik minder coins dan verwacht", "price-impact", 1],
  ["kan ik mijn sol terugkrijgen van mijn token accounts", "token-accounts-rent", 1],
  ["wat is rent op solana", "token-accounts-rent", 1],
  ["een vreemde stuurt mij een dm", "phishing", 1],
  ["admin stuurt me een bericht in telegram", "phishing", 1],
  ["wat is een giveaway scam", "fake-airdrops", 1],
  ["waarom staat mijn coin 24 uur weg", "de-check", 1],
  ["hoe controleer ik een coin snel", "de-check", 1],
  ["hoeveel kost auriga", "wat-doet-auriga", 1],
  ["wat moet ik doen voordat ik een coin koop", "instap-checklist", 1],
  ["wat is een goede pool voor een coin van 50k mcap", "pool-grootte", 1],
  ["hoe weet ik of volume echt is", "nep-volume-patroon", 1],
  ["waarom gaat een coin omhoog als iedereen koopt", "liquiditeit-amm", 1],
  ["hoe herken ik insiders", "insider-wallets", 1],
  ["kan ik verlies aftrekken van mijn belasting", "belasting-nl", 1],
  ["wat is een hot network", "tabs-uitleg", 1],
  ["wat is de beste strategie voor memecoins", ["trading-plan", "exit-onderzoek"]],
  ["wat is de kelly criterion", "kelly", 1],
  ["iemand in een telegramgroep zegt dat deze coin gaat verdubbelen moet ik instappen", ["pump-dump-groepen", "social-media-druk"]],
  ["wat is het verschil tussen graduations en runners", "tabs-uitleg", 1],
  ["ik wil elke dag traden maar ik verlies steeds meer geld wat moet ik doen", "gokken-signalen", 1],
  ["de dev heeft 30 procent van de supply is dat erg", "dev-wallet", 1],
  ["de pool is maar 3000 dollar kan ik dan nog kopen", "pool-grootte", 1],
  ["kan ik mijn winst gewoon laten staan of moet ik uitbetalen", "uitbetalen", 1],
  ["hoeveel moet ik verkopen als mijn coin 5x is", ["winst-nemen-basis", "inleg-terug"]],
  ["hoe weet ik of de maker zijn liquiditeit heeft vergrendeld", "lp-lock-burn", 1],
  ["waarom gaat mijn coin omlaag terwijl er veel gekocht wordt", "waarom-daalt-snel", 1],
  ["ik heb fomo omdat alles omhoog gaat", "fomo", 1],
  ["hoe kan ik mijn verliezen beperken", "risico-basis", 1],
  ["wat doet auriga eigenlijk en hoe kan ik het het beste gebruiken", ["dagelijks-gebruik", "wat-doet-auriga"]],
  // jargon, asked for as a word: the word list answers, or the entry it points at
  ["wat is een bull trap", ["term-bull-trap", "ta-basis"], 2],
  ["wat is een breakout", ["term-breakout", "ta-basis"], 2],
  ["wat betekent oversold", ["term-oversold", "ta-basis"], 2],
  ["wat is een martingale", "term-martingale", 1],
  ["wat is een moonbag", "term-moonbag", 1],
  ["wat betekent de-risken", "term-de-risken", 1],
  ["wat is een cabal", "term-cabal", 1],
  ["wat is een multisig", "term-multisig", 1],
  ["wat is een community takeover cto", "term-cto", 1],
  ["wat is break even", ["term-break-even", "drawdown-herstel"], 2],
  ["hoe werkt dev vesting", "term-vesting", 1],
  ["wat is een market order", ["term-market-order", "limit-orders"], 2],
  ["wat is risk reward ratio", "term-risk-reward", 1],
  ["wat is expectancy", "verwachtingswaarde", 1],
  ["hoe herken ik een nep influencer", "influencer-shilling", 1],
  ["wat is een alpha group", "pump-dump-groepen", 1],
  ["wat betekent het als een coin 1000 holders heeft", "aantal-holders", 1],
  ["kan ik mijn crypto terugkrijgen als ik word gehackt", ["wallet-hack", "na-een-rug", "recovery-scams", "accounts-2fa"]],
  ["ik heb gisteren een coin gekocht voor 20 dollar en hij is nu nog maar 5 dollar waard moet ik hem houden of verkopen", "houden-of-verkopen", 1],
  ["mijn coin is 90 procent gedaald maar ik wil niet verkopen", ["houden-of-verkopen", "sunk-cost", "verlies-accepteren", "drawdown-herstel"]],
  ["mijn vriend zegt dat ik snel een coin moet kopen voordat hij gaat vliegen", ["social-media-druk", "fomo"]],
  ["moet ik een coin kopen die al 10x is gegaan", ["druk-vs-rustig", "fomo-top", "niet-op-10x-wachten"]],
  ["ik heb mijn seed phrase gedeeld met iemand wat moet ik nu doen", ["wallet-hack", "seed-phrase"]],
  ["ik krijg steeds berichten van mensen die me willen helpen met mijn crypto", ["recovery-scams", "phishing"]],
  ["wat gebeurt er met mijn coin als de pool leeg wordt gehaald", ["liquiditeit-leeglopen", "rug-pull-soorten"]],
  ["hoe zorg ik dat ik niet te veel geld kwijtraak met memecoins", ["risico-basis", "bankroll", "positiegrootte"]],
];

describe("questions written in other words than the entries' own", () => {
  const rank = (q: string) => ask(q, 5).hits.map((h) => h.id);
  for (const [q, want, atRank] of FRESH) {
    const wanted = Array.isArray(want) ? want : [want];
    it(`"${q}" -> ${wanted.join(" / ")}${atRank ? " (first)" : ""}`, () => {
      const hits = rank(q);
      const top = atRank ? hits.slice(0, atRank) : hits.slice(0, 3);
      expect(top.some((id) => wanted.includes(id)), `got ${hits.join(", ")}`).toBe(true);
    });
  }
});

describe("the matching rules behind them", () => {
  it("a past participle, a verb form and a word in -ing or -er share a root", () => {
    expect(sameWord("gedumpt", "dump")).toBe(true);
    expect(sameWord("dumpen", "gedumpt")).toBe(true);
    expect(sameWord("gehackt", "hacken")).toBe(true);
    expect(sameWord("trading", "traders")).toBe(true);
  });
  it("but words that merely look alike stay apart: one different letter is only a typo in a long word", () => {
    expect(sameWord("pending", "lending")).toBe(false);
    expect(sameWord("leverage", "levert")).toBe(false);
    expect(sameWord("liquiditeit", "liquidieit")).toBe(true);
    expect(sameWord("slippage", "slipage")).toBe(true);
  });
  it("a compound the knowledge base does not have is read as the two words it has", () => {
    expect(ask("tradingjournaal").hits[0]!.id).toBe("journaal");
    expect(ask("winstnemen").hits.slice(0, 2).map((h) => h.id)).toContain("winst-nemen-basis");
  });
  it("'uit te stappen' is 'uitstappen', and '2x' is the same as '2×'", () => {
    expect(norm("wanneer is het tijd om uit te stappen")).toContain("uitstappen");
    expect(norm("een 2× of 5×")).toBe("een 2x of 5x");
  });
  it("frame words ('hoe weet ik', 'de beste') do not decide the answer", () => {
    expect(words("hoe weet ik of een coin gaat dumpen")).toEqual(["coin", "dumpen"]);
    expect(ask("hoe weet ik of een coin gaat dumpen").hits[0]!.id).toBe("pump-dump-patroon");
  });
  it("one rare topic word is enough for an answer even in a long question, but a chance word in a sample question is not", () => {
    expect(ask("hoeveel slippage moet ik instellen bij een nieuwe coin").confident).toBe(true);
    expect(ask("wat is de kelly criterion").confident).toBe(true);
    expect(ask("wie wint het wk voetbal").confident).toBe(false);
  });
  it("a number that matches nothing does not count against the question", () => {
    expect(ask("is een coin met 40% bij 1 wallet veilig").confident).toBe(true);
  });
});
