import { describe, it, expect } from "vitest";
import { exitTick, type TickDeps } from "./exitTick";
import type { Telegram } from "../../worker/src/exitLoop";

const ENV = { EXIT_ALERT_TOKEN: "111:not-a-real-token-unit-test", EXIT_ALERT_CHAT_ID: "42" } as unknown as NodeJS.ProcessEnv;

/** A database that answers the gate and the age of the last wallet read, and remembers the other statements. gateOpen=false means the last tick was too recent. */
function fakeDb(gateOpen: boolean, walletAge: number | null) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  return {
    calls,
    query: async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      if (/hosted_tick'/.test(text) && /RETURNING key/.test(text)) return { rows: gateOpen ? [{ key: "hosted_tick" }] : [] };
      if (/FROM wallet_watch/.test(text)) return { rows: [{ age: walletAge }] };
      return { rows: [] };
    },
  };
}

function setup(over: Partial<TickDeps> & { gateOpen?: boolean; walletAge?: number | null } = {}) {
  const db = fakeDb(over.gateOpen ?? true, over.walletAge === undefined ? null : over.walletAge);
  const order: string[] = [];
  const sent: string[] = [];
  const cpu: number[] = [];
  const tg: Telegram = {
    send: async (_c, text) => {
      sent.push(text);
      return { ok: true, messageId: 7 };
    },
    updates: async () => [],
  };
  const deps: Partial<TickDeps> = {
    db,
    env: ENV,
    syncWallets: async () => {
      order.push("wallet");
    },
    tg: () => tg,
    addCpu: async (ms) => {
      cpu.push(ms);
    },
    run: async () => {
      order.push("pass");
      return { positions: 150, priced: 40, sent: 0 };
    },
    now: () => 1_000_000,
    log: () => undefined,
    ...over,
  };
  return { db, deps, order, sent, cpu };
}

describe("the site's own exit check", () => {
  it("does nothing, and says so, when there is no bot token or no paired chat", async () => {
    const a = setup({ env: {} as NodeJS.ProcessEnv });
    expect(await exitTick({}, a.deps)).toEqual({ ok: true, skipped: "no bot token configured" });
    const b = setup({ env: { EXIT_ALERT_TOKEN: "111:not-a-real-token-unit-test" } as unknown as NodeJS.ProcessEnv });
    expect(await exitTick({}, b.deps)).toEqual({ ok: true, skipped: "no chat paired" });
    expect(a.db.calls).toHaveLength(0);
    expect(b.order).toEqual([]);
  });

  it("looks at the wallet first, then makes one pass, then leaves a heartbeat and counts its CPU", async () => {
    const t = setup();
    const r = await exitTick({}, t.deps);
    expect(r).toMatchObject({ ok: true, positions: 150, priced: 40, sent: 0 });
    expect(t.order).toEqual(["wallet", "pass"]);
    expect(t.cpu).toHaveLength(1);
    const beat = t.db.calls.find((c) => /hosted_tick_ok/.test(c.text))!;
    expect(JSON.parse(String(beat.params[0]))).toMatchObject({ positions: 150, priced: 40, sent: 0 });
  });

  it("reads the wallet only when its last read is older than 3.5 minutes, whoever made that read", async () => {
    const recent = setup({ walletAge: 110 });
    expect(await exitTick({}, recent.deps)).toMatchObject({ ok: true, walletMs: expect.any(Number) });
    expect(recent.order).toEqual(["pass"]);
    const old = setup({ walletAge: 240 });
    await exitTick({}, old.deps);
    expect(old.order).toEqual(["wallet", "pass"]);
    const never = setup({ walletAge: null });
    await exitTick({}, never.deps);
    expect(never.order).toEqual(["wallet", "pass"]);
  });

  it("a tick that arrives right after another one is skipped without touching the wallet, the prices or Telegram", async () => {
    const t = setup({ gateOpen: false });
    expect(await exitTick({}, t.deps)).toEqual({ ok: true, skipped: "ran less than a minute ago" });
    expect(t.order).toEqual([]);
    expect(t.sent).toEqual([]);
  });

  it("reports a failed pass as not ok, without throwing, and does not leave a heartbeat", async () => {
    const t = setup({
      run: async () => {
        throw new Error("DexScreener unreachable");
      },
    });
    const r = await exitTick({}, t.deps);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("DexScreener");
    expect(t.db.calls.some((c) => /hosted_tick_ok/.test(c.text))).toBe(false);
  });

  it("the test message goes to the paired chat, is recorded, and skips the gate", async () => {
    const t = setup({ gateOpen: false });
    const r = await exitTick({ test: true }, t.deps);
    expect(r).toEqual({ ok: true, test: true });
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toContain("Testbericht");
    expect(t.db.calls.some((c) => /INSERT INTO telegram_messages/.test(c.text))).toBe(true);
    expect(t.order).toEqual([]);
  });

  it("hands the pass the levels and the loss switch from the environment (EXIT_ALERT_LOSS=0 switches the loss message off on the site too)", async () => {
    const seen: Array<{ levels: number[]; loss?: boolean }> = [];
    const spy = (env: NodeJS.ProcessEnv) =>
      setup({
        env,
        run: async (cfg) => {
          seen.push({ levels: cfg.levels, loss: cfg.loss });
          return { positions: 0, priced: 0, sent: 0 };
        },
      });
    await exitTick({}, spy(ENV).deps);
    await exitTick({}, spy({ ...ENV, EXIT_ALERT_LOSS: "0", EXIT_ALERT_LEVELS: "2,4" } as unknown as NodeJS.ProcessEnv).deps);
    expect(seen[0]).toEqual({ levels: [2, 3, 5, 10, 20, 50, 100], loss: true });
    expect(seen[1]).toEqual({ levels: [2, 4], loss: false });
  });

  it("never lets the token into what it returns", async () => {
    const t = setup({
      run: async () => {
        throw new Error("boom 111:not-a-real-token-unit-test");
      },
    });
    const r = await exitTick({}, t.deps);
    expect(JSON.stringify(r)).not.toContain("not-a-real-token");
  });
});
