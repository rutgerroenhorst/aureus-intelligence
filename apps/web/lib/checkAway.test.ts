import { describe, expect, it } from "vitest";
import { hiddenByCheck, leaveOut, mergeNotes, noteKey } from "./checkAway";
import type { CheckNote } from "./coinCheck";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const note = (o: Partial<CheckNote> = {}): CheckNote => ({ mint: "M1", tab: "elite", at: "2026-10-12T11:00:00Z", verdict: "agree", returned: false, ...o });
const notes = (...ns: CheckNote[]) => new Map(ns.map((n) => [noteKey(n.tab, n.mint), n]));

describe("when a check takes a coin off its tab", () => {
  it("only when the site agreed, less than a day ago, and the tab has not listed the coin again", () => {
    expect(hiddenByCheck(note(), NOW)).toBe(true);
    expect(hiddenByCheck(note({ at: "2026-10-11T12:30:00Z" }), NOW)).toBe(true); // 23.5 hours
    expect(hiddenByCheck(note({ at: "2026-10-11T11:00:00Z" }), NOW)).toBe(false); // 25 hours
    expect(hiddenByCheck(note({ returned: true }), NOW)).toBe(false);
    expect(hiddenByCheck(undefined, NOW)).toBe(false);
  });
  it("never because the user pressed the button: 'I do not agree' and 'not sure' leave the coin where it is", () => {
    expect(hiddenByCheck(note({ verdict: "disagree" }), NOW)).toBe(false);
    expect(hiddenByCheck(note({ verdict: "unclear" }), NOW)).toBe(false);
  });
  it("a note with a time that cannot be read hides nothing", () => {
    expect(hiddenByCheck(note({ at: "not a time" }), NOW)).toBe(false);
  });
});

describe("notes made on this screen", () => {
  it("count at once, and the saved note takes over once it is newer or equal", () => {
    const saved = notes(note({ verdict: "disagree", at: "2026-10-12T10:00:00Z" }));
    const local = notes(note({ verdict: "agree", at: "2026-10-12T11:55:00Z" }));
    expect(mergeNotes(saved, local).get("elite|M1")!.verdict).toBe("agree");
    const later = notes(note({ verdict: "disagree", at: "2026-10-12T11:56:00Z" }));
    expect(mergeNotes(later, local).get("elite|M1")!.verdict).toBe("disagree");
    const same = notes(note({ verdict: "unclear", at: "2026-10-12T11:55:00Z" }));
    expect(mergeNotes(same, local).get("elite|M1")!.verdict).toBe("unclear");
  });
  it("leave the saved notes alone when there are none, and add coins the saved list does not have", () => {
    const saved = notes(note());
    expect(mergeNotes(saved, new Map())).toBe(saved);
    const merged = mergeNotes(saved, notes(note({ mint: "M2" })));
    expect([...merged.keys()].sort()).toEqual(["elite|M1", "elite|M2"]);
    expect(saved.size).toBe(1);
  });
  it("a newer check that does not agree brings the coin back", () => {
    const saved = notes(note({ at: "2026-10-12T09:00:00Z" }));
    const local = notes(note({ verdict: "disagree", at: "2026-10-12T11:59:00Z" }));
    expect(hiddenByCheck(mergeNotes(saved, local).get("elite|M1"), NOW)).toBe(false);
  });
});

describe("splitting a list", () => {
  const list = [{ mint: "M1" }, { mint: "M2" }, { mint: "M3" }];
  const mintOf = (x: { mint: string }) => x.mint;
  it("keeps the order, and sorts the coins by the tab they were checked on", () => {
    const n = notes(note({ mint: "M1" }), note({ mint: "M2", tab: "cate" }), note({ mint: "M3", verdict: "disagree" }));
    const r = leaveOut("elite", list, mintOf, n, new Set(), NOW);
    expect(r.away.map(mintOf)).toEqual(["M1"]);
    expect(r.shown.map(mintOf)).toEqual(["M2", "M3"]);
  });
  it("keeps a coin on the card while its answer is open", () => {
    const n = notes(note({ mint: "M1" }));
    const r = leaveOut("elite", list, mintOf, n, new Set([noteKey("elite", "M1")]), NOW);
    expect(r.away).toEqual([]);
    expect(r.shown).toHaveLength(3);
  });
  it("takes nothing off a list that has no checks", () => {
    const r = leaveOut("elite", list, mintOf, new Map(), new Set(), NOW);
    expect(r.shown).toEqual(list);
    expect(r.away).toEqual([]);
  });
});
