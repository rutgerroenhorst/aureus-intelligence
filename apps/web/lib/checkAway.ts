/**
 * What a Check does to the list it was made on. When the site agrees with the user that a coin is dead or has a serious problem, the tab leaves the coin out for a
 * day, so the list is not filled with coins the user has already judged. Only the site's own verdict counts, not the user's click: pressing Check on a healthy coin
 * ("I do not agree") or on one with a single warning sign ("not sure") changes nothing, so the button cannot be used to clear a list.
 *
 * The coin comes back when the tab lists it again after the check (a new qualification, see lib/coinCheck.ts recentChecks: the "↩ Back on this tab" note), after 24
 * hours, or when the user asks for the hidden coins to be shown. A card whose answer is still open stays on screen until it is closed.
 * Nothing here changes a tab's own rules or filters: that would need the evidence the Learning page collects first.
 */
import type { CheckNote } from "./coinCheck";

export const AWAY_HOURS = 24;

export const noteKey = (tab: string, mint: string) => `${tab}|${mint}`;

/** The site agreed less than a day ago and the tab has not listed the coin again since. */
export function hiddenByCheck(note: Pick<CheckNote, "verdict" | "returned" | "at"> | undefined, nowMs: number): boolean {
  if (!note || note.verdict !== "agree" || note.returned) return false;
  const at = new Date(note.at).getTime();
  return Number.isFinite(at) && nowMs - at < AWAY_HOURS * 3_600_000;
}

/** The saved notes with the checks made on this screen since the last refresh laid over them: for a coin that has both, the newer one counts. */
export function mergeNotes(saved: Map<string, CheckNote>, local: Map<string, CheckNote>): Map<string, CheckNote> {
  if (!local.size) return saved;
  const out = new Map(saved);
  for (const [k, n] of local) {
    const s = out.get(k);
    if (!s || new Date(s.at).getTime() < new Date(n.at).getTime()) out.set(k, n);
  }
  return out;
}

/** A list split into the coins the tab shows and the ones the user's checks took off it (a coin whose answer is open is never taken off). */
export function leaveOut<T>(tab: string, list: T[], mintOf: (x: T) => string, notes: Map<string, CheckNote>, open: Set<string>, nowMs: number): { shown: T[]; away: T[] } {
  const shown: T[] = [];
  const away: T[] = [];
  for (const x of list) {
    const k = noteKey(tab, mintOf(x));
    (hiddenByCheck(notes.get(k), nowMs) && !open.has(k) ? away : shown).push(x);
  }
  return { shown, away };
}
