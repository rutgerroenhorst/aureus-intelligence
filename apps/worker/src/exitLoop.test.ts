import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { newPassState, pairFromUpdates, parseEnv, readConfig, runPass, setEnvVar, telegram, welcome, type Deps, type PassState, type Priced, type Store, type Streak, type Telegram, type Update } from "./exitLoop";
import type { Fill } from "../../web/lib/exitAlerts";
import type { LoggedMessage } from "./telegramLog";

const TOKEN = "111:not-a-real-token-unit-test";

describe("configuration: environment and a private file", () => {
  const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "exit-")), ".env.exit-alerts.local");

  it("reads the token, the chat and the levels from the file, and the environment wins", () => {
    const f = tmp();
    fs.writeFileSync(f, `# a comment\nEXIT_ALERT_TOKEN=${TOKEN}\nEXIT_ALERT_CHAT_ID=42\nEXIT_ALERT_LEVELS=3, 10\n`);
    const c = readConfig({}, f)!;
    expect(c.token).toBe(TOKEN);
    expect(c.chatId).toBe("42");
    expect(c.pairCode).toBeNull();
    expect(c.levels).toEqual([3, 10]);
    expect(readConfig({ EXIT_ALERT_CHAT_ID: "7" } as NodeJS.ProcessEnv, f)!.chatId).toBe("7");
  });

  it("has no configuration without a token, and defaults to 2x and 5x", () => {
    const f = tmp();
    expect(readConfig({}, f)).toBeNull();
    fs.writeFileSync(f, `EXIT_ALERT_TOKEN=${TOKEN}\n`);
    expect(readConfig({}, f)!.levels).toEqual([2, 5]);
    fs.writeFileSync(f, `EXIT_ALERT_TOKEN=${TOKEN}\nEXIT_ALERT_LEVELS=nonsense,0.5\n`);
    expect(readConfig({}, f)!.levels).toEqual([2, 5]);
  });

  it("sets and removes one variable, keeps the others and keeps the file private", () => {
    const f = tmp();
    fs.writeFileSync(f, `# keep me\nEXIT_ALERT_TOKEN=${TOKEN}\nEXIT_ALERT_PAIR_CODE=abc\n`, { mode: 0o644 });
    setEnvVar(f, "EXIT_ALERT_CHAT_ID", "99");
    setEnvVar(f, "EXIT_ALERT_PAIR_CODE", null);
    const env = parseEnv(fs.readFileSync(f, "utf8"));
    expect(env).toEqual({ EXIT_ALERT_TOKEN: TOKEN, EXIT_ALERT_CHAT_ID: "99" });
    expect(fs.readFileSync(f, "utf8")).toContain("# keep me");
    expect((fs.statSync(f).mode & 0o777).toString(8)).toBe("600");
  });
});

describe("the Telegram client", () => {
  it("sends with the token only in the address, and returns the message id", async () => {
    let seenUrl = "";
    let seenBody: any = null;
    const f = (async (url: string, init: any) => {
      seenUrl = url;
      seenBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 77 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await telegram(TOKEN, f).send("42", "<b>hi</b>");
    expect(r).toEqual({ ok: true, messageId: 77 });
    expect(seenUrl).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(seenBody).toMatchObject({ chat_id: "42", text: "<b>hi</b>", parse_mode: "HTML", disable_web_page_preview: true });
    expect(JSON.stringify(seenBody)).not.toContain(TOKEN);
  });

  it("sends link buttons as one inline keyboard row, and only links that are http(s)", async () => {
    let seenBody: any = null;
    const f = (async (_url: string, init: any) => {
      seenBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 5 } }), { status: 200 });
    }) as unknown as typeof fetch;
    await telegram(TOKEN, f).send("42", "hi", { buttons: [{ text: "📊 Open", url: "https://dexscreener.com/solana/PAIR" }, { text: "bad", url: "javascript:alert(1)" }] });
    expect(seenBody.reply_markup).toEqual({ inline_keyboard: [[{ text: "📊 Open", url: "https://dexscreener.com/solana/PAIR" }]] });
    await telegram(TOKEN, f).send("42", "plain");
    expect(seenBody.reply_markup).toBeUndefined();
  });

  it("sends the message again without its buttons when Telegram refuses a button, so an alert is never lost to a bad link", async () => {
    const bodies: any[] = [];
    const f = (async (_url: string, init: any) => {
      const b = JSON.parse(init.body);
      bodies.push(b);
      return b.reply_markup ? new Response(JSON.stringify({ ok: false, description: "Bad Request: BUTTON_URL_INVALID" }), { status: 400 }) : new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await telegram(TOKEN, f).send("42", "hi", { buttons: [{ text: "x", url: "https://example.com/a" }] });
    expect(r).toEqual({ ok: true, messageId: 9 });
    expect(bodies).toHaveLength(2);
    expect(bodies[1].reply_markup).toBeUndefined();
  });

  it("never lets the token into an error, whatever the failure", async () => {
    const boom = (async (url: string) => {
      throw new Error(`fetch failed for ${url}`);
    }) as unknown as typeof fetch;
    const a = await telegram(TOKEN, boom).send("42", "x");
    expect(a.ok).toBe(false);
    expect(JSON.stringify(a)).not.toContain(TOKEN);
    const refused = (async () => new Response(JSON.stringify({ ok: false, description: `Forbidden: bot ${TOKEN} was blocked by the user` }), { status: 403 })) as unknown as typeof fetch;
    const b = await telegram(TOKEN, refused).send("42", "x");
    expect(b).toMatchObject({ ok: false });
    expect(JSON.stringify(b)).not.toContain(TOKEN);
    expect((b as { error: string }).error).toContain("blocked");
  });

  it("reads updates into plain records and returns null when Telegram says no", async () => {
    const f = (async () => new Response(JSON.stringify({ ok: true, result: [{ update_id: 5, message: { text: "/start code1", chat: { id: 42, type: "private" } } }, { update_id: 6, edited_message: {} }] }), { status: 200 })) as unknown as typeof fetch;
    expect(await telegram(TOKEN, f).updates(0)).toEqual([
      { id: 5, chatId: 42, chatType: "private", text: "/start code1" },
      { id: 6, chatId: null, chatType: null, text: null },
    ]);
    const no = (async () => new Response(JSON.stringify({ ok: false, error_code: 409 }), { status: 409 })) as unknown as typeof fetch;
    expect(await telegram(TOKEN, no).updates(0)).toBeNull();
  });
});

describe("pairing: only whoever has the one-time code", () => {
  const tg = (ups: Update[]): Telegram => ({ send: async () => ({ ok: true, messageId: 1 }), updates: async () => ups });
  const up = (id: number, chatId: number, chatType: string, text: string): Update => ({ id, chatId, chatType, text });

  it("takes the private chat that sent /start with the code, and moves past everything it read", async () => {
    const off = { next: 0 };
    const chat = await pairFromUpdates("secret1", tg([up(10, 111, "private", "hi"), up(11, 222, "private", "/start wrong"), up(12, 333, "private", "/start secret1"), up(13, 444, "private", "/start secret1")]), off);
    expect(chat).toBe("333");
    expect(off.next).toBe(14);
  });

  it("ignores a group chat, a wrong code, and a code that is only part of a longer message", async () => {
    const off = { next: 0 };
    expect(await pairFromUpdates("secret1", tg([up(1, -100, "group", "/start secret1"), up(2, 5, "private", "/start secret12"), up(3, 6, "private", "please /start secret1")]), off)).toBeNull();
    expect(off.next).toBe(4);
  });

  it("does nothing when Telegram cannot be asked", async () => {
    const off = { next: 3 };
    expect(await pairFromUpdates("x", { send: async () => ({ ok: true, messageId: 1 }), updates: async () => null }, off)).toBeNull();
    expect(off.next).toBe(3);
  });
});

// ---------------------------------------------------------------- a pass, with a store and a Telegram in memory

function memStore(fills: Map<string, Fill[]>, armed: number | null) {
  const extraAlerts = { n: 0 };
  /** how often the big reads happened */
  const reads = { fills: 0, knownAll: 0, alertsLast24h: 0 };
  let streaks: Record<string, Streak> = {};
  const rows = new Map<string, { state: string; messageId?: number }>();
  const records: LoggedMessage[] = [];
  let armedAt = armed;
  const key = (m: string, s: number, l: number) => `${m}|${s}|${l}`;
  const store: Store = {
    fills: async () => {
      reads.fills++;
      return fills;
    },
    fillsVersion: async () => String([...fills.values()].reduce((a, f) => a + f.length, 0)),
    symbols: async (mints) => new Map(mints.map((m) => [m, m.toUpperCase()])),
    armedAt: async () => armedAt,
    setArmedAt: async (t) => {
      armedAt ??= t;
    },
    knownAll: async () => {
      reads.knownAll++;
      const out = new Map<string, Set<number>>();
      for (const k of rows.keys()) {
        const [m, st, l] = k.split("|");
        const set = out.get(`${m}|${st}`) ?? new Set<number>();
        set.add(Number(l));
        out.set(`${m}|${st}`, set);
      }
      return out;
    },
    knownVersion: async () => `${rows.size}:${[...rows.values()].filter((r) => r.state === "sent").length}:${[...rows.values()].filter((r) => r.state === "claimed").length}`,
    seed: async (m, s, levels) => {
      for (const l of [0, ...levels]) if (!rows.has(key(m, s, l))) rows.set(key(m, s, l), { state: "seeded" });
    },
    claim: async (m, s, l) => {
      if (rows.has(key(m, s, l))) return false;
      rows.set(key(m, s, l), { state: "claimed" });
      return true;
    },
    markSent: async (m, s, l, id) => {
      rows.set(key(m, s, l), { state: "sent", messageId: id });
    },
    release: async (m, s, l) => {
      if (rows.get(key(m, s, l))?.state === "claimed") rows.delete(key(m, s, l));
    },
    expireClaims: async () => undefined,
    logMessage: async (m) => {
      records.push(m);
    },
    alertsLast24h: async () => {
      reads.alertsLast24h++;
      return records.filter((r) => r.kind === "alert" && r.ok).length + extraAlerts.n;
    },
    loadStreaks: async () => JSON.parse(JSON.stringify(streaks)),
    saveStreaks: async (x) => {
      streaks = JSON.parse(JSON.stringify(x));
    },
  };
  return { store, rows, records, extraAlerts, reads, streaks: () => streaks };
}

function harness(opts: { fills: Map<string, Fill[]>; armed: number | null; quotes: Record<string, Priced | undefined> }) {
  const { store, rows, records, extraAlerts, reads, streaks } = memStore(opts.fills, opts.armed);
  const sent: string[] = [];
  const buttons: Array<Array<{ text: string; url: string }> | undefined> = [];
  const logs: string[] = [];
  let fail = false;
  let retryAfter: number | undefined;
  const tg: Telegram = {
    send: async (_chat, text, opts) => {
      if (fail) return { ok: false, error: "Too Many Requests", ...(retryAfter ? { retryAfter } : {}) };
      sent.push(text);
      buttons.push(opts?.buttons);
      return { ok: true, messageId: 1000 + sent.length };
    },
    updates: async () => [],
  };
  const deps: Deps = {
    store,
    tg,
    prices: async (mints) => new Map(mints.filter((m) => opts.quotes[m]).map((m) => [m, opts.quotes[m]!])),
    log: (msg, extra) => logs.push(msg + (extra ? " " + JSON.stringify(extra) : "")),
    now: () => 1_000_000,
    sleep: async () => undefined,
    // each pass of the tests is a separate check, whatever the clock says
    minGapS: 0,
  };
  return { deps, rows, records, reads, streaks, sent, buttons, logs, st: newPassState(), extraAlerts, setFail: (v: boolean) => (fail = v), setRetryAfter: (v: number | undefined) => (retryAfter = v) };
}

const cfg = { chatId: "42", levels: [2, 5] };
const quote = (price: number, liq = 20_000): Priced => ({ price, liq, pair: "PAIRX", symbol: "SYM" });
// 1000 tokens for $2 (price 0.002), bought a day before "now"
const oneBuy = (t = 900_000) => new Map<string, Fill[]>([["m1", [{ t, side: "buy", tokens: 1000, usd: 2 }]]]);

describe("a pass", () => {
  it("what was already above a level when the alerts were switched on is marked as seen, not reported", async () => {
    const h = harness({ fills: oneBuy(), armed: 1_000_000, quotes: { m1: quote(0.012) } }); // 6x, bought before arming
    await runPass(cfg, h.deps, h.st);
    await runPass(cfg, h.deps, h.st);
    await runPass(cfg, h.deps, h.st);
    expect(h.sent).toEqual([]);
    expect(h.rows.get("m1|900000|2")?.state).toBe("seeded");
    expect(h.rows.get("m1|900000|5")?.state).toBe("seeded");
  });

  it("reports a crossing after two checks in a row, once, and then never again", async () => {
    const h = harness({ fills: oneBuy(), armed: 1_000_000, quotes: { m1: quote(0.003) } }); // 1.5x
    await runPass(cfg, h.deps, h.st);
    expect(h.sent).toEqual([]);
    h.deps.prices = async () => new Map([["m1", quote(0.0042)]]); // 2.1x
    await runPass(cfg, h.deps, h.st);
    expect(h.sent).toEqual([]); // one check is not enough
    await runPass(cfg, h.deps, h.st);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toContain("<b>M1</b>");
    expect(h.sent[0]).toContain("2×-drempel gehaald");
    // the link is a button under the message, not text in it
    expect(h.sent[0]).not.toContain("https://");
    expect(h.buttons[0]).toEqual([{ text: "📊 Open in DexScreener", url: "https://dexscreener.com/solana/PAIRX" }]);
    expect(h.rows.get("m1|900000|2")).toEqual({ state: "sent", messageId: 1001 });
    await runPass(cfg, h.deps, h.st);
    await runPass(cfg, h.deps, h.st);
    expect(h.sent).toHaveLength(1);
  });

  it("a glitch of a single check is not a crossing", async () => {
    const h = harness({ fills: oneBuy(), armed: 1_000_000, quotes: { m1: quote(0.003) } });
    await runPass(cfg, h.deps, h.st);
    h.deps.prices = async () => new Map([["m1", quote(0.05)]]);
    await runPass(cfg, h.deps, h.st);
    h.deps.prices = async () => new Map([["m1", quote(0.003)]]);
    await runPass(cfg, h.deps, h.st);
    h.deps.prices = async () => new Map([["m1", quote(0.05)]]);
    await runPass(cfg, h.deps, h.st);
    expect(h.sent).toEqual([]);
  });

  it("a coin that jumps over both levels gets one message, for the highest, and both are recorded", async () => {
    const h = harness({ fills: oneBuy(), armed: 1_000_000, quotes: { m1: quote(0.003) } });
    await runPass(cfg, h.deps, h.st);
    h.deps.prices = async () => new Map([["m1", quote(0.013)]]); // 6.5x
    await runPass(cfg, h.deps, h.st);
    await runPass(cfg, h.deps, h.st);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toContain("5×-drempel gehaald");
    expect(h.rows.get("m1|900000|2")?.state).toBe("sent");
    expect(h.rows.get("m1|900000|5")?.state).toBe("sent");
  });

  it("stays quiet for a pool that is too small and starts counting again when it is big enough", async () => {
    const h = harness({ fills: oneBuy(), armed: 1_000_000, quotes: { m1: quote(0.003) } });
    await runPass(cfg, h.deps, h.st);
    h.deps.prices = async () => new Map([["m1", quote(0.0045, 500)]]);
    await runPass(cfg, h.deps, h.st);
    await runPass(cfg, h.deps, h.st);
    await runPass(cfg, h.deps, h.st);
    expect(h.sent).toEqual([]);
    h.deps.prices = async () => new Map([["m1", quote(0.0045, 30_000)]]);
    await runPass(cfg, h.deps, h.st);
    expect(h.sent).toEqual([]);
    await runPass(cfg, h.deps, h.st);
    expect(h.sent).toHaveLength(1);
  });

  it("a position bought after the alerts were switched on is reported even if it is already above a level on the first look", async () => {
    const h = harness({ fills: oneBuy(1_000_500), armed: 1_000_000, quotes: { m1: quote(0.0042) } });
    await runPass(cfg, h.deps, h.st);
    await runPass(cfg, h.deps, h.st);
    expect(h.sent).toHaveLength(1);
  });

  it("when Telegram refuses, nothing is recorded as sent and it is tried again on the next pass", async () => {
    const h = harness({ fills: oneBuy(), armed: 1_000_000, quotes: { m1: quote(0.003) } });
    await runPass(cfg, h.deps, h.st);
    h.deps.prices = async () => new Map([["m1", quote(0.0042)]]);
    await runPass(cfg, h.deps, h.st);
    h.setFail(true);
    await runPass(cfg, h.deps, h.st);
    expect(h.sent).toEqual([]);
    expect(h.rows.has("m1|900000|2")).toBe(false);
    expect(h.logs.some((l) => l.startsWith("exit alert not sent"))).toBe(true);
    h.setFail(false);
    await runPass(cfg, h.deps, h.st);
    expect(h.sent).toHaveLength(1);
    expect(h.rows.get("m1|900000|2")?.state).toBe("sent");
  });

  it("does not report a level another process has already claimed", async () => {
    const h = harness({ fills: oneBuy(), armed: 1_000_000, quotes: { m1: quote(0.003) } });
    await runPass(cfg, h.deps, h.st);
    h.rows.set("m1|900000|2", { state: "claimed" });
    h.deps.prices = async () => new Map([["m1", quote(0.0042)]]);
    await runPass(cfg, h.deps, h.st);
    await runPass(cfg, h.deps, h.st);
    expect(h.sent).toEqual([]);
  });

  it("ignores a coin with no price and a coin that is no longer held", async () => {
    const fills = new Map<string, Fill[]>([
      ["gone", [{ t: 900_000, side: "buy", tokens: 1000, usd: 2 }]],
      ["sold", [{ t: 900_000, side: "buy", tokens: 1000, usd: 2 }, { t: 950_000, side: "sell", tokens: 1000, usd: 6 }]],
    ]);
    const h = harness({ fills, armed: 1_000_000, quotes: { sold: quote(1) } });
    const r = await runPass(cfg, h.deps, h.st);
    expect(r.positions).toBe(1);
    expect(h.sent).toEqual([]);
  });

  it("never writes the token or the chat anywhere it logs", async () => {
    const h = harness({ fills: oneBuy(), armed: 1_000_000, quotes: { m1: quote(0.003) } });
    await runPass(cfg, h.deps, h.st);
    h.deps.prices = async () => new Map([["m1", quote(0.0042)]]);
    await runPass(cfg, h.deps, h.st);
    await runPass(cfg, h.deps, h.st);
    expect(h.logs.join("\n")).not.toContain("42");
    expect(h.logs.join("\n")).not.toContain("AAF");
  });
});

describe("the welcome message", () => {
  it("lists what is above the first level now, and counts only coins an alert could be sent for", async () => {
    const fills = new Map<string, Fill[]>([
      ["hot", [{ t: 900_000, side: "buy", tokens: 1000, usd: 2 }]],
      ["flat", [{ t: 900_000, side: "buy", tokens: 1000, usd: 2 }]],
      ["thin", [{ t: 900_000, side: "buy", tokens: 1000, usd: 2 }]],
    ]);
    const h = harness({ fills, armed: null, quotes: { hot: quote(0.02), flat: quote(0.002), thin: quote(0.02, 100) } });
    expect(await welcome(cfg, h.deps, h.st)).toBe(true);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toContain("HOT");
    expect(h.sent[0]).not.toContain("FLAT");
    expect(h.sent[0]).not.toContain("THIN");
    expect(h.sent[0]).toContain("Exit-meldingen staan aan");
  });
});

describe("the record of what was sent (the Telegram page)", () => {
  it("records an alert with its text, the coin, the level and Telegram's message id", async () => {
    const h = harness({ fills: oneBuy(), armed: 1_000_000, quotes: { m1: quote(0.003) } });
    await runPass(cfg, h.deps, h.st);
    h.deps.prices = async () => new Map([["m1", quote(0.0042)]]);
    await runPass(cfg, h.deps, h.st);
    await runPass(cfg, h.deps, h.st);
    expect(h.records).toHaveLength(1);
    expect(h.records[0]).toMatchObject({ kind: "alert", ok: true, messageId: 1001, symbol: "M1", level: 2 });
    // what the page shows is the text as sent plus the button's link
    expect(h.records[0]!.html).toBe(`${h.sent[0]}\n\n📊 Open in DexScreener: https://dexscreener.com/solana/PAIRX`);
    expect(h.st.logged).toBe(1);
  });

  it("records a refused send, but only once in half an hour for the same alert", async () => {
    let now = 1_000_000;
    const h = harness({ fills: oneBuy(), armed: 1_000_000, quotes: { m1: quote(0.003) } });
    h.deps.now = () => now;
    await runPass(cfg, h.deps, h.st);
    h.deps.prices = async () => new Map([["m1", quote(0.0042)]]);
    await runPass(cfg, h.deps, h.st);
    h.setFail(true);
    await runPass(cfg, h.deps, h.st);
    now += 120;
    await runPass(cfg, h.deps, h.st);
    now += 120;
    await runPass(cfg, h.deps, h.st);
    expect(h.records).toHaveLength(1);
    expect(h.records[0]).toMatchObject({ kind: "alert", ok: false, error: "Too Many Requests" });
    now += 3600;
    await runPass(cfg, h.deps, h.st);
    expect(h.records).toHaveLength(2);
    h.setFail(false);
    await runPass(cfg, h.deps, h.st);
    expect(h.records[2]).toMatchObject({ ok: true });
  });

  it("records the welcome message", async () => {
    const fills = new Map<string, Fill[]>([["hot", [{ t: 900_000, side: "buy", tokens: 1000, usd: 2 }]]]);
    const h = harness({ fills, armed: null, quotes: { hot: quote(0.02) } });
    await welcome(cfg, h.deps, h.st);
    expect(h.records).toHaveLength(1);
    expect(h.records[0]).toMatchObject({ kind: "welcome", ok: true });
  });
});

describe("limits on what is sent", () => {
  const crossing = async (h: ReturnType<typeof harness>) => {
    await runPass(cfg, h.deps, h.st);
    h.deps.prices = async () => new Map([["m1", quote(0.0042)]]);
    await runPass(cfg, h.deps, h.st);
  };

  it("stops at the daily ceiling, says so once, and sends again when older alerts have fallen out of the last 24 hours", async () => {
    const h = harness({ fills: oneBuy(), armed: 1_000_000, quotes: { m1: quote(0.003) } });
    h.extraAlerts.n = 40;
    await crossing(h);
    await runPass(cfg, h.deps, h.st);
    await runPass(cfg, h.deps, h.st);
    expect(h.sent).toEqual([]);
    expect(h.logs.filter((l) => l.includes("daily ceiling"))).toHaveLength(1);
    expect(h.rows.has("m1|900000|2")).toBe(false);
    h.extraAlerts.n = 39;
    await runPass(cfg, h.deps, h.st);
    expect(h.sent).toHaveLength(1);
  });

  it("waits when Telegram says slow down, for as long as it asks, and then sends", async () => {
    let now = 1_000_000;
    const h = harness({ fills: oneBuy(), armed: 1_000_000, quotes: { m1: quote(0.003) } });
    h.deps.now = () => now;
    await crossing(h);
    h.setFail(true);
    h.setRetryAfter(300);
    await runPass(cfg, h.deps, h.st);
    expect(h.sent).toEqual([]);
    expect(h.st.pauseUntil).toBe(now + 300);
    h.setFail(false);
    now += 120;
    const during = await runPass(cfg, h.deps, h.st);
    expect(during.sent).toBe(0);
    expect(h.sent).toEqual([]);
    now += 400;
    await runPass(cfg, h.deps, h.st);
    expect(h.sent).toHaveLength(1);
  });

  it("never waits more than an hour, however long Telegram asks", async () => {
    const h = harness({ fills: oneBuy(), armed: 1_000_000, quotes: { m1: quote(0.003) } });
    await crossing(h);
    h.setFail(true);
    h.setRetryAfter(999_999);
    await runPass(cfg, h.deps, h.st);
    expect(h.st.pauseUntil).toBe(1_000_000 + 3600);
  });

  it("leaves a second between two messages of one pass", async () => {
    const fills = new Map<string, Fill[]>([
      ["a", [{ t: 900_000, side: "buy", tokens: 1000, usd: 2 }]],
      ["b", [{ t: 900_000, side: "buy", tokens: 1000, usd: 2 }]],
    ]);
    const h = harness({ fills, armed: 1_000_000, quotes: { a: quote(0.003), b: quote(0.003) } });
    const pauses: number[] = [];
    h.deps.sleep = async (ms) => {
      pauses.push(ms);
    };
    await runPass(cfg, h.deps, h.st);
    h.deps.prices = async () => new Map([["a", quote(0.0042)], ["b", quote(0.0042)]]);
    await runPass(cfg, h.deps, h.st);
    await runPass(cfg, h.deps, h.st);
    expect(h.sent).toHaveLength(2);
    expect(pauses).toEqual([1100]);
  });
});

describe("running where every check may start in a new process (the site's own 24/7 check)", () => {
  const persist = { persistStreaks: true } as const;
  const priceAt = (h: ReturnType<typeof harness>, price: number) => {
    h.deps.prices = async () => new Map([["m1", quote(price)]]);
  };

  it("two checks made by two different processes still count as two: the count is kept in the database", async () => {
    let now = 1_000_000;
    const h = harness({ fills: oneBuy(), armed: 1_000_000, quotes: { m1: quote(0.003) } });
    h.deps.now = () => now;
    h.deps.minGapS = 60;
    await runPass(cfg, h.deps, newPassState(), persist); // first look: seeds, nothing above a level
    priceAt(h, 0.0042);
    await runPass(cfg, h.deps, newPassState(), persist); // one check at 2.1x, by a process that is gone afterwards
    expect(h.sent).toEqual([]);
    expect(Object.values(h.streaks())).toEqual([{ n: 1, t: now }]);
    now += 120;
    await runPass(cfg, h.deps, newPassState(), persist); // a brand new process, two minutes later
    expect(h.sent).toHaveLength(1);
    expect(h.streaks()).toEqual({});
  });

  it("without the database's count a process that starts fresh every time would never get to two (this is why it is kept)", async () => {
    let now = 1_000_000;
    const h = harness({ fills: oneBuy(), armed: 1_000_000, quotes: { m1: quote(0.003) } });
    h.deps.now = () => now;
    h.deps.minGapS = 60;
    await runPass(cfg, h.deps, newPassState());
    priceAt(h, 0.0042);
    for (let i = 0; i < 4; i++) {
      now += 120;
      await runPass(cfg, h.deps, newPassState()); // no persistStreaks
    }
    expect(h.sent).toEqual([]);
  });

  it("two runners looking at the same moment make one check, and a level is reported once whoever gets there first", async () => {
    let now = 1_000_000;
    const h = harness({ fills: oneBuy(), armed: 1_000_000, quotes: { m1: quote(0.003) } });
    h.deps.now = () => now;
    h.deps.minGapS = 60;
    const a = newPassState();
    const b = newPassState();
    await runPass(cfg, h.deps, a, persist);
    priceAt(h, 0.0042);
    await runPass(cfg, h.deps, a, persist);
    await runPass(cfg, h.deps, b, persist); // the same second: not a second check
    expect(h.sent).toEqual([]);
    now += 120;
    await runPass(cfg, h.deps, a, persist);
    now += 1;
    await runPass(cfg, h.deps, b, persist);
    now += 120;
    await runPass(cfg, h.deps, a, persist);
    await runPass(cfg, h.deps, b, persist);
    expect(h.sent).toHaveLength(1);
    expect(h.rows.get("m1|900000|2")?.state).toBe("sent");
  });

  it("reads the wallet's fills and the recorded levels again only when something changed", async () => {
    const fills = oneBuy();
    const h = harness({ fills, armed: 1_000_000, quotes: { m1: quote(0.003), m2: quote(0.003) } });
    await runPass(cfg, h.deps, h.st, persist);
    await runPass(cfg, h.deps, h.st, persist);
    await runPass(cfg, h.deps, h.st, persist);
    expect(h.reads.fills).toBe(1);
    expect(h.reads.knownAll).toBeLessThanOrEqual(2); // once, and once more because the first pass wrote the "seen" rows
    // a new buy: the fingerprint changes, the positions are worked out again and the new coin is seen
    fills.set("m2", [{ t: 999_000, side: "buy", tokens: 1000, usd: 2 }]);
    await runPass(cfg, h.deps, h.st, persist);
    expect(h.reads.fills).toBe(2);
    expect(h.rows.has("m2|999000|0")).toBe(true);
  });

  it("asks about the daily ceiling only when there is something to send", async () => {
    const h = harness({ fills: oneBuy(), armed: 1_000_000, quotes: { m1: quote(0.003) } });
    await runPass(cfg, h.deps, h.st);
    await runPass(cfg, h.deps, h.st);
    expect(h.reads.alertsLast24h).toBe(0);
    priceAt(h, 0.0042);
    await runPass(cfg, h.deps, h.st);
    await runPass(cfg, h.deps, h.st);
    expect(h.reads.alertsLast24h).toBe(1);
    expect(h.sent).toHaveLength(1);
  });
});
