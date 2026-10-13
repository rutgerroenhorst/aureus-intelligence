# The Kennis tab: a written knowledge base you can ask

Added 2026-10-13 at the user's request. The user asked for a crypto "coach" (first an AI chat with voice); after the options were laid out (a free model, a capped paid one,
or nothing outside the site) they asked instead for **a knowledge tab with everything from A to Z, where you ask a question and it answers, without an extra API**.
This is that: text written by hand, found by a search that runs in the browser, with the user's own numbers placed under the answers they belong to.

## What it is, and what it is not

- **It is** a reference: 172 entries in 12 categories (basics, trading on a DEX, pump.fun and memecoins, holders and wallets, scams and rugs, security, patterns,
  risk management, taking profit and exiting, psychology, tools, and this system itself), 134 word-list terms (including trading slang), over a thousand sample
  questions that the entries answer, and four calculators.
- **It is not** a model. It does not reason, combine, or make anything up. A question is answered by *finding* the written entry that fits best; when nothing fits well
  it says so ("Daar heb ik geen goed antwoord op"), shows the closest entries, and keeps the question on the device so it can be added later.
- It needs **no key, no account and no paid service**. Everything is in the page's own code, so it also works when the site's database is slow or down (only the
  "Jouw cijfers" boxes need the database).

## Where things are

| What | Where |
|---|---|
| The page | `apps/web/app/kennis/` (`page.tsx`, `KennisClient.tsx`, `Calculators.tsx`) |
| The entries (Dutch) | `apps/web/lib/kennis/entries/<category>.ts` |
| The word list | `apps/web/lib/kennis/glossary.ts` |
| Search | `apps/web/lib/kennis/search.ts` |
| Entry list, categories, `ask()` | `apps/web/lib/kennis/index.ts` |
| The user's numbers | `apps/web/lib/kennis/{summary,facts,personal}.ts` and `GET /api/kennis-facts` |
| Calculators' sums | `apps/web/lib/kennis/calc.ts` |
| Check line → entry map | `apps/web/lib/kennis/checkLinks.ts` |
| Tests | `apps/web/lib/kennis/kennis.test.ts` (220) and `personal.test.ts` (19) |

The URL is the source of truth, so every answer can be linked or bookmarked: `/kennis?q=<question>`, `?e=<entry id>`, `?c=<category>`, `?v=woordenlijst`, `?v=rekenen`.

## How a question is answered

1. The question is lower-cased, accents removed, `×` read as `x`, "uit te stappen" read as "uitstappen", and the little words dropped (Dutch and English
   stopwords: "de", "het", "hoe", "what", and frame words such as "weet", "zie", "beste", "goede"). A long word the knowledge base does not have but that is two words it
   has ("tradingjournaal", "winstnemen") is read as those two.
2. Each entry is scored on the remaining words, weighted by where they hit: title 6, the entry's own questions (`q`) 5, keywords (`kw`) 5, the short answer 2.5, the
   body 1, multiplied by how rare the word is across all entries (idf), and by a coverage factor `0.4 + 0.6 × (share of the question's words that matched)`. A number that
   matches nothing ("40%") does not count against the question.
3. Words match when they are equal, share a long prefix (endings, plurals), share six letters and 80% of the shorter word, have the same root ("gedumpt", "dumpen" and
   "dump"; "trading" and "traders"), are one typo apart (a swapped or missing letter in words of 6+ letters, a different letter only in words of 8+: "pending" is not
   "lending"), or sit in the same synonym group (`SAME` in `search.ts`, for example "scam" / "oplichting" / "fraude", or "winst" / "profit" / "gain").
4. Bonuses for whole phrases: the exact question +30, part of a question +10, the title +10, a keyword phrase +6 or +2. And a **look-alike question** bonus up to +18: an
   entry with a sample question that shares most of your question's words (words that are rare count more, so sharing "dumpen" says more than sharing "coin").
5. The top entry counts as **the answer** only when its score is at least 7, at least half of the question's words matched (a third when a word that few entries are
   about matched), and the match is more than a chance word in the text: a title, question or keyword hit, and either two matching words, support from a look-alike
   question or phrase, or one rare topic word such as "kelly" or "slippage". Below that the page shows "Daar heb ik geen goed antwoord op" with the nearest entries,
   never a guess dressed up as an answer. A question of eight words or more also gets a hint to try the key words.
6. Word-list terms are searched the same way, so asking for a single word ("slippage", "dust", "moonbag") gives its definition first.
7. A coin address in the question (any chain) is not searched at all: the page runs the Check on it (`PasteCheck`), and each line of that Check has a **?** that opens
   the entry that explains the line.

Unanswered questions are stored in the browser (`localStorage`, key `auriga:kennis:onbeantwoord`, 40 at most; shown on the Kennis home with copy and clear). Nothing is sent
anywhere. They are the to-do list for new entries.

## "Jouw cijfers": the user's own numbers under an answer

An entry can carry `personal: "<key>"`. The page then fetches `GET /api/kennis-facts` and puts a box under the answer with sentences built from the user's journal and
the lab, for example the money in and out and what is still held, how many coins fell to half or less, how often a coin touched 2x and was given back, the usual stake
and the bankroll a 2% rule would need, coins found on a tab against coins bought outside the Radar, and the lab's own base rates (15.7% of the followed coins reached 2x,
see `docs/EXIT_STRATEGY.md`). Keys: `basisrates`, `journaal`, `winst`, `positie`, `buiten-radar`, `pumpswap`, `druk`, `lab-vondsten`.

- **Aggregates only.** No coin names, no addresses, no per-coin rows (a test checks the journal summary for that). The site is public; these are the same totals the Home and
  Results pages already show.
- **No invented sentences.** When a number is missing the box is simply absent (`personalBlock` returns `null`; a test covers every key).
- **Cheap.** Two small reads (the journal's last 400 rows, two stored lab reports) shared in memory for five minutes. A failed read leaves that half out; the page stays up.
- A wallet's peak is not always known, so "touched 2x" is a lower bound; the box says so.

## How to add or change an entry

Open the file of the category (`lib/kennis/entries/<category>.ts`) and add an object to its array:

```ts
{
  id: "wash-trading",                 // unique, lower case with dashes; it is in links (/kennis?e=wash-trading)
  cat: "patronen",
  title: "Wash trading en nep-volume",
  q: ["wat is wash trading", "is dit volume echt"],     // questions as people would type them, Dutch and English
  kw: ["wash", "nep volume", "fake volume"],            // other words for the same thing
  short: "One to three sentences: the answer itself.",
  body: ["A paragraph.", "- a bullet", "Link to another entry with *entry-id*."],
  todo: ["Optional checklist step."],
  personal: "druk",                                      // optional: which of the user's numbers belong here
  see: ["volume-lezen"],                                 // optional: ids worth reading next
}
```

Text markup in `body`, `short` and `todo`: `**bold**`, `*italic*`, `*entry-id*` (an italic that is exactly an id becomes a link to that entry), and a line that starts with
`"- "` is a bullet. Italics that are not an id must not look like one (no hyphenated words in italics).

Then run `corepack pnpm test`. The tests refuse an entry with a duplicate or untidy id, a missing field, a `see` or `*id*` that points nowhere, a Check line without an
explanation, double spaces, template leftovers or straight quotes inside a Dutch sentence (they break the page), and they check that **every entry's own first question finds
that entry first** and that **every one of its sample questions finds it within the first three hits** (99% first). Put the plainest question first, and write the
others the way people really ask (short, spoken, with or without typos).

**When a question did not work** (the Kennis home lists the ones the page could not answer, with a copy button): add its words as a sample question to the entry that should
have answered, or write a new entry, and add the question with its expected entry to the `FRESH` table in `kennis.test.ts` so it keeps working. For a slang word, add a
term to `glossary.ts` (with `aka` for spellings); that is the cheapest fix and answers "wat is X" at once.

When the Check gets a new line, add it to `checkLinks.ts` and give it an entry; a test fails until it has one.

## Keeping it honest

- **Written for this system.** The entries about taking profit quote the lab (`docs/EXIT_STRATEGY.md`: 1,123 followed coins, 15.7% reached 2x, 9.4% 3x, 5.4% 5x, 2.6% 10x;
  half out at 2x plus a 40% trailing stop beat all-out-at-2x by about 6 points; *what you buy matters more than the exit*). If the lab reports change those numbers, change the
  entries too (search the entries for the number). The user's own numbers come from the database and are always current.
- **Updated with the alert rebuild (2026-10-13).** `alerts-2x-5x` now describes the ladder, the line and the loss message; `check-lijnen` has the pool-age line and `graduations-uitleg` the "Hidden, but running now" strip; `eerste-uur` and `born-graduated` were rewritten (the lab's first look is at a pool age of about 1.3 hours; hidden kinds mostly drain, one in nine born graduations still doubles);
  `exit-onderzoek` and `limit-orders` say what the matured-cohort research found and that the owner's trading app cannot place a stop; new entries `fomo-geen-stop` and `fomo-kosten` (172 entries in all). The Check's "age" line links to `eerste-uur`.
- **Facts that go stale are kept out.** No prices, no fee tables, no "the best exchange". Platform behaviour (pump.fun's curve, PumpSwap versus Raydium, RugCheck's fields)
  is described as of the writing and named as such; the Check and the lab are the live evidence.
- **Not advice.** The entries say what the numbers show and what usually goes wrong; they never say "buy this". Risk rules are phrased as rules of play, with the sums shown.
- **Hand-written means it can be wrong.** If an entry is wrong or out of date, fix the entry; there is no model whose behaviour has to be tuned instead.

## How well it works

Measured by asking it questions nobody had tuned it for (written afterwards, in everyday and spoken Dutch, in rounds of 55 to 77 questions; each round's mistakes were then
fixed with more phrasings, new entries and rules, which is why the tests now hold over a hundred such questions). On a fresh round, before fixing anything, roughly 6 or 7 in
10 questions got a fitting answer at the top; very niche jargon (technical analysis, trading slang) and long,
story-like questions did worst. The last round (77 niche questions, written after nearly all fixes) gave a fitting top answer for about two in three and a wrong but confident
answer about ten times, nearly all because one word matched by chance; those were then fixed too. Short, direct questions work best: three to five words.

## Limits

- It cannot answer a question nobody wrote an entry for, and it cannot combine two entries into a new conclusion.
- It understands Dutch and English phrasings, small typos (one edit in words of 6+ letters) and the synonym groups, nothing more. A question in different words may need a
  second try; the "closest entries" list is there for that.
- Voice: the browser's keyboard dictation works in the question box on the phone (the installed web app on iPhone has no speech recognition of its own). Nothing is read aloud.
- The page is public like the rest of the site: anyone with the address sees the aggregate numbers under the answers.

## If a real AI coach is wanted later

It can be added next to this, not instead of it: the search above would pick the relevant entries and the user's numbers, and a model would only *phrase* the answer from
them (so it cannot invent facts). Two realistic options, both needing a key the user creates: Groq's free tier (a hosted open model; limits of roughly 30 requests a minute,
1,000 a day; the free tier keeps no data by default), or a paid Claude model with a hard monthly cap set in the provider's dashboard (cents per answer). Neither is built;
neither is needed for the Kennis tab to work.
