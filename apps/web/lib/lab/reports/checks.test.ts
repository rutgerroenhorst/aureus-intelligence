import { describe, it, expect } from "vitest";
import { buildChecks } from "./checks";

const db = (rows: any[], fail = false) => ({
  query: async () => {
    if (fail) throw new Error("relation coin_checks does not exist");
    return { rows };
  },
});

describe("your checks, graded later", () => {
  it("counts the checks by what the site said, counts a coin pressed twice once, and counts the coins that came back", async () => {
    const r = await buildChecks(
      db([
        { mint: "A", verdict: "agree", t: 100, returned: false },
        { mint: "A", verdict: "disagree", t: 200, returned: false },
        { mint: "B", verdict: "unclear", t: 150, returned: true },
        { mint: "C", verdict: "disagree", t: 300, returned: true },
        { mint: "C", verdict: "disagree", t: 310, returned: true },
      ]),
      [],
    );
    expect(r).toMatchObject({ days: 60, checks: 5, coins: 3, agree: 1, disagree: 3, unclear: 1, returned: 2, graded: null });
    expect(r!.note).toContain("hypothesis");
  });

  it("says nothing when no check was made or the table is missing", async () => {
    expect(await buildChecks(db([]), [])).toBeNull();
    expect(await buildChecks(db([], true), [])).toBeNull();
  });
});
