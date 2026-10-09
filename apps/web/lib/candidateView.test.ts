import { describe, it, expect } from "vitest";
import { universeStatus } from "./decisionRules";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "candidateView.ts"), "utf8");

/**
 * Regression guard for a bug that silently hid the entire watchlist.
 *
 * The canonical query capped results with `LIMIT 200` and no ORDER BY. Postgres is
 * free to return any 200 of the matching rows, so with 430 candidates the board
 * showed 129 REJECTED coins and zero FUNDAMENTAL_WATCH ones — the three that
 * mattered fell outside an arbitrary slice. An ENTRY_READY candidate could have
 * been invisible for the same reason, which is the worst failure this product has.
 *
 * These assert the SQL shape rather than the data, so they hold without a database.
 */
describe("the canonical query must never cap an unordered set", () => {
  const orderIdx = src.indexOf("ORDER BY\n");
  const limitIdx = src.lastIndexOf("LIMIT 400");

  it("has an ORDER BY on the outer query", () => {
    expect(orderIdx, "outer ORDER BY missing").toBeGreaterThan(-1);
  });

  it("orders BEFORE it limits", () => {
    expect(limitIdx).toBeGreaterThan(orderIdx);
  });

  it("ranks every decision status explicitly, so none falls into the ELSE bucket", () => {
    const ranked = src.slice(orderIdx, limitIdx);
    for (const status of [
      "ENTRY_READY", "ENTRY_APPROACHING", "SETUP_FORMING", "FUNDAMENTAL_WATCH",
      "TOO_EXTENDED", "DISCOVERED", "INVALIDATED", "REJECTED",
    ]) {
      expect(ranked, `status ${status} is not ranked in the ORDER BY`).toContain(`'${status}'`);
    }
  });

  it("puts actionable statuses ahead of dormant ones", () => {
    const ranked = src.slice(orderIdx, limitIdx);
    const at = (s: string) => ranked.indexOf(`'${s}'`);
    expect(at("ENTRY_READY")).toBeLessThan(at("FUNDAMENTAL_WATCH"));
    expect(at("FUNDAMENTAL_WATCH")).toBeLessThan(at("DISCOVERED"));
    expect(at("DISCOVERED")).toBeLessThan(at("REJECTED"));
  });

  it("the cap is large enough to hold the whole active fleet", () => {
    expect(src).toContain("LIMIT 400");
  });
});

// The discovery age window is applied at the door, but nothing re-applied it after.
// Candidates admitted under the old launch-firehose strategy stayed on the watchlist
// forever: six of fourteen board slots were 548–625h coins, two with a pool of exactly
// $0, sitting in TOO_EXTENDED as though a pull-back were still coming.
describe("active universe — the board shows what is tradeable now", () => {
  const H = 3.6e6;
  const u = (liquidityUsd: number | null, ageH: number, activity: string | null = "REAL") =>
    universeStatus({ liquidityUsd, pairAgeMs: ageH * H, activity });

  it("a fresh, liquid, genuinely-traded coin is ACTIVE", () => {
    expect(u(41_000, 13.4).status).toBe("ACTIVE");     // TRULL
  });

  it("a dead pool is never on the board, whatever its status says", () => {
    const r = u(0, 548);                                // Isidro, sitting in TOO_EXTENDED
    expect(r.status).toBe("POOL_DEAD");
    expect(r.reason).toMatch(/liquidity is gone/);
  });

  it("a coin past the age window ages out", () => {
    const r = u(1_607_148, 625);                        // CATE
    expect(r.status).toBe("AGED_OUT");
    expect(r.reason).toMatch(/past the 48h window/);
  });

  it("below the universe liquidity floor is TOO_THIN", () => {
    expect(u(4_100, 3).status).toBe("TOO_THIN");        // under the $8k dead-zone floor
  });

  it("a thin-but-alive pool is judged on age, not excluded for depth", () => {
    // RYDER, $9,371: above the floor now that sizing is a few euros, so the reason it
    // leaves the board is its age — which is the honest one.
    expect(u(9_371, 574).status).toBe("AGED_OUT");
  });

  it("a wash-traded or parked market is excluded even when fresh and liquid", () => {
    expect(u(63_938, 39.1, "DUST_WASH").status).toBe("NOT_REAL_MARKET");   // KEKODYSSEUS
    expect(u(127_736, 21.6, "PARKED").status).toBe("NOT_REAL_MARKET");     // CEZ
  });

  it("a dead pool is reported as dead, not as merely thin", () => {
    // Ordering matters: $0 satisfies both tests, and "pool is gone" is the useful one.
    expect(u(0, 10).status).toBe("POOL_DEAD");
  });

  it("age is only checked once the coin is otherwise tradeable", () => {
    // A dead 600h pool should read POOL_DEAD, not AGED_OUT — the pool is the story.
    expect(u(0, 600).status).toBe("POOL_DEAD");
  });

  it("unknown activity does not exclude a coin — absence is not evidence", () => {
    expect(u(50_000, 10, null).status).toBe("ACTIVE");
    expect(u(50_000, 10, "UNKNOWN").status).toBe("ACTIVE");
  });
});
