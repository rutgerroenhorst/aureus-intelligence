import { describe, it, expect } from "vitest";
import { pushWalletRows } from "./walletSync";

/** A database that answers by the first words of the statement and remembers what it was asked. */
function fake(answers: Array<[RegExp, any[]]>) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  return {
    calls,
    query: async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      const hit = answers.find(([re]) => re.test(text));
      return { rows: hit ? hit[1] : [] };
    },
  };
}

describe("copying what the laptop read to the hosted database", () => {
  it("copies every column of wallet_txs, flows_read included (a missing key would be NULL in a NOT NULL column), and never lowers it on conflict", async () => {
    const local = fake([
      [/FROM wallet_txs/, [{ signature: "S1", address: "ADDR", block_time: "2026-10-11T08:00:00Z", state: "done", tries: 1, last_try: "2026-10-11T08:01:00Z", flows_read: true }]],
      [/FROM wallet_fills/, []],
      [/FROM wallet_watch/, [{ label: null, added_at: null, synced_at: null, newest_sig: "S1" }]],
    ]);
    const hosted = fake([[/max\(block_time\)/, [{ m: null }]]]);
    const r = await pushWalletRows(local, hosted, "ADDR");
    expect(r).toMatchObject({ txs: 1, fills: 0 });
    expect(local.calls.find((c) => /FROM wallet_txs/.test(c.text))!.text).toContain("flows_read");
    const insert = hosted.calls.find((c) => /INSERT INTO wallet_txs/.test(c.text))!;
    expect(JSON.parse(String(insert.params[0]))[0]).toMatchObject({ signature: "S1", flows_read: true });
    expect(insert.text).toContain("flows_read = wallet_txs.flows_read OR EXCLUDED.flows_read");
  });
});
