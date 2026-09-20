import { describe, it, expect } from "vitest";
import { InMemoryQueue, backoffMs, MAX_ATTEMPTS } from "./queue.js";

describe("enrichment queue", () => {
  it("enqueues a candidate once per type (idempotent)", async () => {
    const q = new InMemoryQueue();
    expect(await q.enqueue("HELIUS_ENRICHMENT", "c1")).toBe(true);
    expect(await q.enqueue("HELIUS_ENRICHMENT", "c1")).toBe(false); // already queued
    expect(q.stats().duplicateEnqueue).toBe(1);
    expect(await q.depth()).toBe(1);
  });

  it("enrichment and reevaluation for the SAME candidate do not block each other", async () => {
    const q = new InMemoryQueue();
    expect(await q.enqueue("HELIUS_ENRICHMENT", "c1")).toBe(true);
    expect(await q.enqueue("REEVALUATE_CANDIDATE", "c1")).toBe(true); // different type → allowed
    expect(await q.depth()).toBe(2);
    expect((await q.claimDue("HELIUS_ENRICHMENT", 1000, 5))).toHaveLength(1);
    expect((await q.claimDue("REEVALUATE_CANDIDATE", 1000, 5))).toHaveLength(1); // not blocked by the enrichment lock
  });

  it("REEVALUATE is NOT starved by a backlog of HELIUS jobs (the bug)", async () => {
    const q = new InMemoryQueue();
    for (let i = 0; i < 40; i++) await q.enqueue("HELIUS_ENRICHMENT", `h${i}`);
    await q.enqueue("REEVALUATE_CANDIDATE", "r1");
    // Fair drain: reevaluations first, bounded, then enrichment.
    const reeval = await q.claimDue("REEVALUATE_CANDIDATE", 1000, 5);
    const enrich = await q.claimDue("HELIUS_ENRICHMENT", 1000, 5);
    expect(reeval).toHaveLength(1); // reached despite 40 enrichment jobs
    expect(enrich).toHaveLength(5);
  });

  it("claims a due job and locks it (no double-run)", async () => {
    const q = new InMemoryQueue();
    await q.enqueue("HELIUS_ENRICHMENT", "c1");
    expect(await q.claimDue("HELIUS_ENRICHMENT", 1000, 10)).toHaveLength(1);
    expect(await q.claimDue("HELIUS_ENRICHMENT", 1000, 10)).toHaveLength(0); // locked + removed
  });

  it("ack releases lock + dedup so it can be re-enqueued later", async () => {
    const q = new InMemoryQueue();
    await q.enqueue("HELIUS_ENRICHMENT", "c1");
    const [job] = await q.claimDue("HELIUS_ENRICHMENT", 1000, 10);
    await q.ack(job!);
    expect(await q.enqueue("HELIUS_ENRICHMENT", "c1")).toBe(true);
    expect(q.stats().completed).toBe(1);
  });

  it("retries with backoff, not available until the delay passes", async () => {
    const q = new InMemoryQueue();
    await q.enqueue("HELIUS_ENRICHMENT", "c1");
    const [job] = await q.claimDue("HELIUS_ENRICHMENT", 1000, 10);
    expect(await q.retry(job!, 1000)).toBe("retried");
    expect(await q.claimDue("HELIUS_ENRICHMENT", 1000, 10)).toHaveLength(0); // backing off
    const later = await q.claimDue("HELIUS_ENRICHMENT", 1000 + 5 * 60_000, 10);
    expect(later).toHaveLength(1);
    expect(later[0]!.attempts).toBe(1);
  });

  it("dead-letters after the attempt budget", async () => {
    const q = new InMemoryQueue();
    await q.enqueue("HELIUS_ENRICHMENT", "c1");
    let job = (await q.claimDue("HELIUS_ENRICHMENT", 0, 10))[0]!;
    let outcome = "retried", now = 0;
    for (let i = 0; i < MAX_ATTEMPTS + 2 && outcome === "retried"; i++) {
      outcome = await q.retry(job, now);
      now += 10 * 60_000;
      const claimed = await q.claimDue("HELIUS_ENRICHMENT", now, 10);
      if (claimed[0]) job = claimed[0];
    }
    expect(outcome).toBe("deadlettered");
    expect(await q.depth()).toBe(0);
  });

  it("backoff grows and stays bounded", () => {
    expect(backoffMs(0)).toBeLessThan(backoffMs(3));
    expect(backoffMs(20)).toBeLessThanOrEqual(120_000 * 1.25);
  });
});
