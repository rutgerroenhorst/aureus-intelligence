import { describe, it, expect } from "vitest";
import { walletMoney } from "./walletMoney";

const db = (sums: any[], list: any[], fail = false) => ({
  query: async (text: string) => {
    if (fail) throw new Error("relation wallet_flows does not exist");
    return { rows: /GROUP BY direction/.test(text) ? sums : list };
  },
});

describe("what went into the wallet", () => {
  it("adds up deposits and withdrawals, masks the sender and never returns more than the sums need", async () => {
    const m = await walletMoney(
      db(
        [
          { direction: "in", n: 2, sol: 0.5, usd: 55.5, unpriced: 0, first: "2026-08-24T05:20:52Z", last: "2026-10-11T19:19:46Z" },
          { direction: "out", n: 1, sol: 0.1, usd: 11, unpriced: 0, first: "2026-09-01T00:00:00Z", last: "2026-09-01T00:00:00Z" },
        ],
        [{ t: "2026-10-11T19:19:46Z", amount: 0.074, usd: 8.23, counterparty: "2UL8PartOfALongAddressPartOfALongAddressPkhNL" }, { t: "2026-08-24T05:20:52Z", amount: 0.1171, usd: null, counterparty: null }],
      ),
    );
    expect(m!.deposited).toEqual({ usd: 55.5, sol: 0.5, n: 2, unpriced: 0, first: "2026-08-24T05:20:52.000Z", last: "2026-10-11T19:19:46.000Z" });
    expect(m!.withdrawn).toMatchObject({ n: 1, sol: 0.1, usd: 11 });
    expect(m!.deposits[0]).toEqual({ t: "2026-10-11T19:19:46.000Z", amount: 0.074, usd: 8.23, from: "2UL8…khNL" });
    expect(m!.deposits[1]).toEqual({ t: "2026-08-24T05:20:52.000Z", amount: 0.1171, usd: null, from: null });
    expect(JSON.stringify(m)).not.toContain("PartOfALong");
  });

  it("has no withdrawals when there are none, and says nothing when nothing is recorded or the table is missing", async () => {
    const m = await walletMoney(db([{ direction: "in", n: 1, sol: 0.2, usd: 20, unpriced: 0, first: "2026-10-01T00:00:00Z", last: "2026-10-01T00:00:00Z" }], []));
    expect(m!.withdrawn).toEqual({ usd: 0, sol: 0, n: 0, unpriced: 0 });
    expect(await walletMoney(db([], []))).toBeNull();
    expect(await walletMoney(db([], [], true))).toBeNull();
  });

  it("counts deposits that have no dollar price as unpriced instead of hiding them", async () => {
    const m = await walletMoney(db([{ direction: "in", n: 3, sol: 0.6, usd: 40, unpriced: 1, first: "2026-10-01T00:00:00Z", last: "2026-10-03T00:00:00Z" }], []));
    expect(m!.deposited.unpriced).toBe(1);
  });
});
