/**
 * The knowledge tab ("Kennis"): a written knowledge base that answers a question by finding the best entries, with the user's own numbers next to them.
 * No model and no outside service: everything here is text written by hand (docs/KENNIS.md says how to add to it and how it is kept honest).
 */

export type CategoryId = "basis" | "handelen" | "memecoins" | "holders" | "scams" | "veiligheid" | "patronen" | "risico" | "winst" | "psychologie" | "tools" | "auriga";

export interface Category {
  id: CategoryId;
  title: string;
  /** one line under the title on the overview */
  blurb: string;
}

/** Which of the user's own numbers belong under an entry (lib/kennis/personal.ts turns them into sentences). */
export type PersonalKey = "basisrates" | "journaal" | "winst" | "positie" | "buiten-radar" | "pumpswap" | "druk" | "lab-vondsten";

export interface Entry {
  /** short, stable, lower case with dashes: it is in links (/kennis?e=<id>) and the Check's lines point at it */
  id: string;
  cat: CategoryId;
  title: string;
  /** questions a person would type, in Dutch and English: they are matched as whole phrases and word by word */
  q: string[];
  /** other words that mean the same, and the English jargon people use */
  kw: string[];
  /** the answer in one to three sentences */
  short: string;
  /** the explanation: one paragraph per item; an item that starts with "- " is a bullet; **bold** is allowed */
  body: string[];
  /** what to do, as a checklist */
  todo?: string[];
  personal?: PersonalKey;
  /** ids of entries worth reading next */
  see?: string[];
}

/** A word list entry: a short definition, searchable like an entry. */
export interface Term {
  term: string;
  /** other spellings and names */
  aka?: string[];
  def: string;
  /** the id of the entry that explains it properly */
  see?: string;
}

/** What the page knows about the user, from /api/kennis-facts (aggregate numbers only). */
export interface Facts {
  journal: null | {
    coins: number;
    putUsd: number;
    outUsd: number;
    heldUsd: number;
    lostHalf: number;
    touched2x: number;
    gaveBack: number;
    medianSizeUsd: number | null;
    viaRadar: { n: number; lostHalf: number };
    outsideRadar: { n: number; lostHalf: number };
    sources: { wallet: number; radar: number; manual: number };
  };
  lab: null | {
    followed: number;
    held: { x2: number; x3: number; x5: number; x10: number };
    headlines: string[];
  };
}
