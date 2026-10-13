import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dexQuotes, keyboard, newPassState, pairFromUpdates, parseEnv, readConfig, runPass, setEnvVar, telegram, welcome, type Deps, type PassState, type Priced, type Store, type Streak, type Telegram, type Update } from "./exitLoop";
import { LEVELS_DEFAULT, type Fill, type MessageButton } from "../../web/lib/exitAlerts";
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

  it("has no configuration without a token, and defaults to the log ladder 2, 3, 5, 10, 20, 50, 100", () => {
    const f = tmp();
    expect(readConfig({}, f)).toBeNull();
    fs.writeFileSync(f, `EXIT_ALERT_TOKEN=${TOKEN}\n`);
    expect(readConfig({}, f)!.levels).toEqual([2, 3, 5, 10, 20, 50, 100]);
    fs.writeFileSync(f, `EXIT_ALERT_TOKEN=${TOKEN}\nEXIT_ALERT_LEVELS=nonsense,0.5\n`);
    expect(readConfig({}, f)!.levels).toEqual([2, 3, 5, 10, 20, 50, 100]);
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

  it("sends link and copy buttons two to a row with their colours, and a quiet message without a sound", async () => {
    let seenBody: any = null;
    const f = (async (_url: string, init: any) => {
      seenBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 6 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const buttons: MessageButton[] = [
      { text: "Open in FOMO", url: "https://fomo.family/coin?address=M&chainId=1399811149", style: "success" },
      { text: "DexScreener", url: "https://dexscreener.com/solana/P" },
      { text: "Kopieer adres", copy: "MINTADDRESS" },
    ];
    await telegram(TOKEN, f).send("42", "hi", { buttons, silent: true });
    expect(seenBody.disable_notification).toBe(true);
    expect(seenBody.reply_markup.inline_keyboard).toEqual([
      [{ text: "Open in FOMO", url: "https://fomo.family/coin?address=M&chainId=1399811149", style: "success" }, { text: "DexScreener", url: "https://dexscreener.com/solana/P" }],
      [{ text: "Kopieer adres", copy_text: { text: "MINTADDRESS" } }],
    ]);
    await telegram(TOKEN, f).send("42", "loud", { buttons });
    expect(seenBody.disable_notification).toBeUndefined();
  });

  it("when Telegram refuses a colour or a copy button it sends the message again with less, down to no buttons, and never loses the message", async () => {
    const bodies: any[] = [];
    const buttons: MessageButton[] = [
      { text: "Open in FOMO", url: "https://fomo.family/coin?address=M&chainId=1399811149", style: "success" },
      { text: "Kopieer adres", copy: "MINTADDRESS" },
    ];
    // refuses anything with a colour, then anything with a copy button
    const f = (async (_url: string, init: any) => {
      const b = JSON.parse(init.body);
      bodies.push(b);
      const kb = JSON.stringify(b.reply_markup ?? {});
      if (kb.includes('"style"')) return new Response(JSON.stringify({ ok: false, description: "Bad Request: BUTTON_STYLE_INVALID" }), { status: 400 });
      if (kb.includes("copy_text")) return new Response(JSON.stringify({ ok: false, description: "Bad Request: unsupported button type" }), { status: 400 });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 11 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await telegram(TOKEN, f).send("42", "hi", { buttons });
    expect(r).toEqual({ ok: true, messageId: 11 });
    expect(bodies).toHaveLength(3);
    expect(JSON.stringify(bodies[1].reply_markup)).not.toContain("style");
    expect(JSON.stringify(bodies[1].reply_markup)).toContain("copy_text");
    expect(JSON.stringify(bodies[2].reply_markup)).not.toContain("copy_text");
    expect(bodies[2].reply_markup.inline_keyboard).toEqual([[{ text: "Open in FOMO", url: "https://fomo.family/coin?address=M&chainId=1399811149" }]]);
    // and when every keyboard is refused the message itself still goes out
    const bodies2: any[] = [];
    const g = (async (_url: string, init: any) => {
      const b = JSON.parse(init.body);
      bodies2.push(b);
      return b.reply_markup ? new Response(JSON.stringify({ ok: false, description: "Bad Request: BUTTON_URL_INVALID" }), { status: 400 }) : new Response(JSON.stringify({ ok: true, result: { message_id: 12 } }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await telegram(TOKEN, g).send("42", "hi", { buttons })).toEqual({ ok: true, messageId: 12 });
    expect(bodies2[bodies2.length - 1].reply_markup).toBeUndefined();
  });

  it("builds the keyboard two buttons to a row, drops links that are not http(s), and trims what a copy button copies", () => {
    const rows = keyboard([
      { text: "a", url: "https://a.example" },
      { text: "b", url: "javascript:alert(1)" },
      { text: "c", copy: "x".repeat(400) },
      { text: "d", url: "https://d.example", style: "danger" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(2);
    expect((rows[0]![1] as any).copy_text.text).toHaveLength(256);
    expect(rows[1]).toEqual([{ text: "d", url: "https://d.example", style: "danger" }]);
    expect(keyboard([{ text: "d", url: "https://d.example", style: "danger" }], { plain: true })).toEqual([[{ text: "d", url: "https://d.example" }]]);
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
  const kv = new Map<string, string>();
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
    sentTop: async () => {
      const out = new Map<string, number>();
      for (const [k, v] of rows) {
        const [m, st, l] = k.split("|");
        if (v.state === "sent" && Number(l) > 0) out.set(`${m}|${st}`, Math.max(out.get(`${m}|${st}`) ?? 0, Number(l)));
      }
      return out;
    },
    kvGet: async (k) => kv.get(k) ?? null,
    kvSet: async (k, v) => {
      kv.set(k, v);
    },
  };
  return { store, rows, records, extraAlerts, reads, kv, streaks: () => streaks };
}

function harness(opts: { fills: Map<string, Fill[]>; armed: number | null; quotes: Record<string, Priced | undefined> }) {
  const { store, rows, records, extraAlerts, reads, kv, streaks } = memStore(opts.fills, opts.armed);
  const sent: string[] = [];
  const silent: boolean[] = [];
  const buttons: Array<MessageButton[] | undefined> = [];
  const logs: string[] = [];
  let fail = false;
  let retryAfter: number | undefined;
  const tg: Telegram = {
    send: async (_chat, text, opts) => {
      if (fail) return { ok: false, error: "Too Many Requests", ...(retryAfter ? { retryAfter } : {}) };
      sent.push(text);
      silent.push(Boolean(opts?.silent));
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
  return { deps, rows, records, reads, streaks, kv, sent, silent, buttons, logs, st: newPassState(), extraAlerts, setFail: (v: boolean) => (fail = v), setRetryAfter: (v: number | undefined) => (retryAfter = v) };
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
    expect(h.sent[0]).toContain("<b>M1</b> · koers <b>2,1×</b>");
    expect(h.sent[0]).toContain("Verkoop <b>50%</b> van wat je nu hebt");
    // the first level reported is the one with sound; the links are buttons under the message, not text in it
    expect(h.silent[0]).toBe(false);
    expect(h.sent[0]).not.toContain("https://");
    expect(h.buttons[0]!.map((b) => b.text)).toEqual(["Open in FOMO", "DexScreener", "Kopieer adres"]);
    expect(h.buttons[0]![1]).toEqual({ text: "DexScreener", url: "https://dexscreener.com/solana/PAIRX" });
    expect(h.buttons[0]![2]).toEqual({ text: "Kopieer adres", copy: "m1" });
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
    expect(h.sent[0]).toContain("koers <b>6,5×</b>");
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
    expect(h.records[0]!.html).toBe(`${h.sent[0]}\n\nOpen in FOMO: https://fomo.family/coin?address=m1&chainId=1399811149\nDexScreener: https://dexscreener.com/solana/PAIRX\nKopieer adres: m1`);
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


describe("the ladder, the quiet steps and the line (the site's own stop)", () => {
  const ladder = { chatId: "42", levels: LEVELS_DEFAULT };
  // bought after the alerts were switched on, so nothing is seeded: 1000 tokens for $2 (price 0.002)
  const fresh = () => oneBuy(1_000_500);
  const at = (h: ReturnType<typeof harness>, price: number, liq = 20_000) => {
    h.deps.prices = async () => new Map([["m1", quote(price, liq)]]);
  };
  /** a crossing needs two checks in a row */
  const hold = async (h: ReturnType<typeof harness>, price: number, passes = 2) => {
    at(h, price);
    for (let i = 0; i < passes; i++) await runPass(ladder, h.deps, h.st);
  };

  it("the first level reported has sound; the next levels are quiet steps that move the line up", async () => {
    const h = harness({ fills: fresh(), armed: 1_000_000, quotes: { m1: quote(0.003) } });
    await runPass(ladder, h.deps, h.st);
    await hold(h, 0.0042); // 2.1x
    await hold(h, 0.0064); // 3.2x
    await hold(h, 0.0104); // 5.2x
    expect(h.sent).toHaveLength(3);
    expect(h.silent).toEqual([false, true, true]);
    expect(h.sent[0]).toMatch(/^🟢/);
    expect(h.sent[0]).toContain("Verkoop <b>50%</b>");
    expect(h.sent[1]).toMatch(/^🔵/);
    expect(h.sent[1]).toContain("De lijn gaat omhoog naar <b>2,3×</b>");
    expect(h.sent[2]).toContain("De lijn gaat omhoog naar <b>3,8×</b>");
    expect(["2", "3", "5"].map((l) => h.rows.get(`m1|1000500|${l}`)?.state)).toEqual(["sent", "sent", "sent"]);
  });

  it("a coin that jumps over several levels gets one message, with sound if nothing was reported before", async () => {
    const h = harness({ fills: fresh(), armed: 1_000_000, quotes: { m1: quote(0.003) } });
    await runPass(ladder, h.deps, h.st);
    await hold(h, 0.022); // 11x
    expect(h.sent).toHaveLength(1);
    expect(h.silent[0]).toBe(false);
    expect(h.sent[0]).toContain("koers <b>11×</b>");
    for (const l of ["2", "3", "5", "10"]) expect(h.rows.get(`m1|1000500|${l}`)?.state).toBe("sent");
  });

  it("when the price falls to the line it says so once, with sound, after a second look: sell the rest", async () => {
    const sleeps: number[] = [];
    const h = harness({ fills: fresh(), armed: 1_000_000, quotes: { m1: quote(0.003) } });
    h.deps.sleep = async (ms) => {
      sleeps.push(ms);
    };
    await runPass(ladder, h.deps, h.st);
    await hold(h, 0.0042); // first profit at 2.1x, armed: the line is 1.5x = $0.003
    expect(h.sent).toHaveLength(1);
    at(h, 0.0028); // 1.4x: under the line
    sleeps.length = 0;
    await runPass(ladder, h.deps, h.st);
    expect(sleeps).toEqual([25_000]); // one look more, after a pause
    expect(h.sent).toHaveLength(2);
    expect(h.silent[1]).toBe(false);
    expect(h.sent[1]).toMatch(/^🔴 <b>M1<\/b> · koers <b>1,4×<\/b>/);
    expect(h.sent[1]).toContain("Laatste niveau: <b>2,0×</b>, de lijn lag op <b>1,5×</b>.");
    expect(h.sent[1]).toContain("Verkoop de rest (<b>100%</b>) nu: ≈ $2,80");
    expect(h.buttons[1]![0]).toMatchObject({ text: "Open in FOMO", style: "danger" });
    expect(h.rows.get("m1|1000500|-2")?.state).toBe("sent");
    // once: still under the line, nothing more
    at(h, 0.0025);
    await runPass(ladder, h.deps, h.st);
    await runPass(ladder, h.deps, h.st);
    expect(h.sent).toHaveLength(2);
    expect(h.records.filter((r) => r.kind === "alert" && r.ok)).toHaveLength(2);
  });

  it("one bad print under the line is not a fall: the second look cancels it and nothing is claimed", async () => {
    const h = harness({ fills: fresh(), armed: 1_000_000, quotes: { m1: quote(0.003) } });
    await runPass(ladder, h.deps, h.st);
    await hold(h, 0.0042);
    const seen: number[] = [];
    h.deps.prices = async () => {
      seen.push(seen.length);
      // the pass sees 1.4x, the look after the pause sees 1.9x again
      return new Map([["m1", quote(seen.length === 1 ? 0.0028 : 0.0038)]]);
    };
    await runPass(ladder, h.deps, h.st);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(h.sent).toHaveLength(1);
    expect(h.rows.has("m1|1000500|-2")).toBe(false);
  });

  it("a position that was already under its line before it was ever seen above it is never announced (nothing is said about old positions when this is switched on)", async () => {
    const h = harness({ fills: oneBuy(), armed: 1_000_000, quotes: { m1: quote(0.001) } }); // 0.5x now
    // the 2x alert was sent long ago, under the old ladder
    h.rows.set("m1|900000|0", { state: "seeded" });
    h.rows.set("m1|900000|2", { state: "sent", messageId: 5 });
    await runPass(ladder, h.deps, h.st);
    await runPass(ladder, h.deps, h.st);
    expect(h.sent).toEqual([]);
    // it rises above the line (armed), then falls under it: now it is announced
    at(h, 0.0045);
    await runPass(ladder, h.deps, h.st);
    at(h, 0.0025); // 1.25x
    await runPass(ladder, h.deps, h.st);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatch(/^🔴/);
  });

  it("the line follows the highest level reported: after 5x it is 3.75x", async () => {
    const h = harness({ fills: fresh(), armed: 1_000_000, quotes: { m1: quote(0.003) } });
    await runPass(ladder, h.deps, h.st);
    await hold(h, 0.0104); // 5.2x: first profit for the highest level
    expect(h.sent).toHaveLength(1);
    await hold(h, 0.0086); // 4.3x: above the line of 3.75x
    expect(h.sent).toHaveLength(1);
    await hold(h, 0.0066, 1); // 3.3x: under it
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]).toContain("de lijn lag op <b>3,8×</b>");
  });

  it("the line message needs a real pool and a position worth an order, like every other message", async () => {
    const h = harness({ fills: fresh(), armed: 1_000_000, quotes: { m1: quote(0.003) } });
    await runPass(ladder, h.deps, h.st);
    await hold(h, 0.0042);
    h.deps.prices = async () => new Map([["m1", quote(0.0028, 500)]]);
    await runPass(ladder, h.deps, h.st);
    expect(h.sent).toHaveLength(1);
  });

  it("a position worth less than $2 stays quiet: an order costs at least $0.10, which is 5% of it", async () => {
    // 400 tokens are left of the 1000 bought at 0.002; at 2.1x they are worth $1.68
    const small = new Map<string, Fill[]>([["m1", [{ t: 1_000_500, side: "buy", tokens: 1000, usd: 2 }, { t: 1_000_600, side: "sell", tokens: 600, usd: 2.4 }]]]);
    const h = harness({ fills: small, armed: 1_000_000, quotes: { m1: quote(0.003) } });
    await runPass(ladder, h.deps, h.st);
    await hold(h, 0.0042);
    expect(h.sent).toEqual([]);
  });

  it("the ladder is switched on without a flood: a position that had passed a level is not told about the new levels it is above, and later levels are reported as steps", async () => {
    const h = harness({ fills: oneBuy(), armed: 1_000_000, quotes: { m1: quote(0.012) } }); // 6x now
    // under the old ladder 2x and 5x were reported
    h.rows.set("m1|900000|0", { state: "seeded" });
    h.rows.set("m1|900000|2", { state: "sent", messageId: 1 });
    h.rows.set("m1|900000|5", { state: "sent", messageId: 2 });
    await runPass(ladder, h.deps, h.st);
    await runPass(ladder, h.deps, h.st);
    await runPass(ladder, h.deps, h.st);
    expect(h.sent).toEqual([]);
    expect(h.rows.get("m1|900000|3")?.state).toBe("seeded");
    expect(h.kv.get("ladder_v2")).toBeDefined();
    // it goes on to 10x: a quiet step, with the line at 3.75x (from the 5x that was reported before)
    await hold(h, 0.0215);
    expect(h.sent).toHaveLength(1);
    expect(h.silent[0]).toBe(true);
    expect(h.sent[0]).toContain("De lijn gaat omhoog naar <b>7,5×</b>");
    function hold(hh: ReturnType<typeof harness>, price: number) {
      hh.deps.prices = async () => new Map([["m1", quote(price)]]);
      return runPass(ladder, hh.deps, hh.st).then(() => runPass(ladder, hh.deps, hh.st));
    }
  });

  it("a position that had already passed levels when they were switched on (seeded, never reported) has its line under the highest of them, not under the first", async () => {
    const h = harness({ fills: oneBuy(), armed: 1_000_000, quotes: { m1: quote(0.048) } }); // 24x now
    await runPass(ladder, h.deps, h.st); // seeds 2, 3, 5, 10, 20: bought before arming, nothing reported
    expect(h.sent).toEqual([]);
    for (const l of ["2", "3", "5", "10", "20"]) expect(h.rows.get(`m1|900000|${l}`)?.state).toBe("seeded");
    await runPass(ladder, h.deps, h.st); // seen above the line of 20x (15x): armed
    // it falls to 12x: under the line of 15x, long before the old line of 1.5x
    h.deps.prices = async () => new Map([["m1", quote(0.024)]]);
    await runPass(ladder, h.deps, h.st);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatch(/^🔴/);
    expect(h.sent[0]).toContain("Laatste niveau: <b>20×</b>, de lijn lag op <b>15×</b>.");
  });

  it("the new levels are seeded once only: a position that has not reported anything and is above 3x still gets its first profit", async () => {
    const h = harness({ fills: fresh(), armed: 1_000_000, quotes: { m1: quote(0.003) } });
    await runPass(ladder, h.deps, h.st); // seen, nothing reported: known is {0}
    await hold(h, 0.0072); // 3.6x
    expect(h.sent).toHaveLength(1);
    expect(h.silent[0]).toBe(false);
    expect(h.sent[0]).toContain("koers <b>3,6×</b>");
  });

  it("at 10x the owner's own idea is offered, quietly, once", async () => {
    const fills = new Map<string, Fill[]>([["m1", [{ t: 1_000_500, side: "buy", tokens: 1000, usd: 2 }]]]);
    const h = harness({ fills, armed: 1_000_000, quotes: { m1: quote(0.003) } });
    await runPass(ladder, h.deps, h.st);
    await hold(h, 0.0042);
    await hold(h, 0.021); // 10.5x: a position of $21
    expect(h.sent).toHaveLength(2);
    expect(h.silent[1]).toBe(true);
    expect(h.sent[1]).toContain("verkoop <b>25%</b> van wat je nu hebt (≈ $5,25)");
  });

  it("the arming and the claim live in the database: another process fires the line once, and two runners never both send it", async () => {
    let now = 1_000_000;
    const h = harness({ fills: fresh(), armed: 1_000_000, quotes: { m1: quote(0.003) } });
    h.deps.now = () => now;
    h.deps.minGapS = 60;
    const persist = { persistStreaks: true } as const;
    await runPass(ladder, h.deps, newPassState(), persist);
    at(h, 0.0042);
    await runPass(ladder, h.deps, newPassState(), persist);
    now += 120;
    await runPass(ladder, h.deps, newPassState(), persist); // first profit sent; the armed line is written to the database
    expect(h.sent).toHaveLength(1);
    expect(JSON.parse(h.kv.get("lines") ?? "{}")).toEqual({ "m1|1000500": 2 });
    now += 120;
    at(h, 0.0028);
    await runPass(ladder, h.deps, newPassState(), persist); // a brand new process reads the armed line and fires
    expect(h.sent).toHaveLength(2);
    await runPass(ladder, h.deps, newPassState(), persist); // another runner, same moment
    expect(h.sent).toHaveLength(2);
  });

  it("forgets the line of a position that is no longer held", async () => {
    const fills = fresh();
    const h = harness({ fills, armed: 1_000_000, quotes: { m1: quote(0.003) } });
    await runPass(ladder, h.deps, h.st, { persistStreaks: true });
    await hold(h, 0.0042);
    expect(h.st.lines.size).toBe(1);
    fills.set("m1", [{ t: 1_000_500, side: "buy", tokens: 1000, usd: 2 }, { t: 1_001_000, side: "sell", tokens: 1000, usd: 4 }]);
    await runPass(ladder, h.deps, h.st, { persistStreaks: true });
    expect(h.st.lines.size).toBe(0);
  });
});

describe("the loss message (a fresh position that fell 30%)", () => {
  const ladder = { chatId: "42", levels: LEVELS_DEFAULT };
  const fresh = (t = 1_000_500, usd = 2) => new Map<string, Fill[]>([["m1", [{ t, side: "buy", tokens: 1000, usd }]]]);
  const run = async (h: ReturnType<typeof harness>, price: number, passes = 2, liq = 20_000, cfgOver: { loss?: boolean } = {}) => {
    h.deps.prices = async () => new Map([["m1", quote(price, liq)]]);
    for (let i = 0; i < passes; i++) await runPass({ ...ladder, ...cfgOver }, h.deps, h.st);
  };
  const started = async (h: ReturnType<typeof harness>) => {
    h.deps.now = () => 1_001_000;
    await run(h, 0.002, 1); // seen at its own price: nothing
  };

  it("is sent once, quietly, after two checks in a row at 70% of what was paid or lower", async () => {
    const h = harness({ fills: fresh(), armed: 1_000_000, quotes: { m1: quote(0.002) } });
    await started(h);
    await run(h, 0.0013, 1); // 0.65x: one check
    expect(h.sent).toEqual([]);
    await run(h, 0.0013, 1);
    expect(h.sent).toHaveLength(1);
    expect(h.silent[0]).toBe(true);
    expect(h.sent[0]).toMatch(/^🟠 <b>M1<\/b> · koers <b>0,6×<\/b>/);
    expect(h.sent[0]).toContain("Verkoop alles (<b>100%</b>): ≈ $1,30.");
    expect(h.rows.get("m1|1000500|-0.7")?.state).toBe("sent");
    await run(h, 0.0008, 3);
    expect(h.sent).toHaveLength(1);
  });

  it("one check is not enough, and a glitch that recovers sends nothing", async () => {
    const h = harness({ fills: fresh(), armed: 1_000_000, quotes: { m1: quote(0.002) } });
    await started(h);
    await run(h, 0.0012, 1);
    await run(h, 0.002, 1);
    await run(h, 0.0012, 1);
    expect(h.sent).toEqual([]);
  });

  it("is only for positions under 72 hours old, and only until the position has passed 2x", async () => {
    const old = harness({ fills: fresh(600_000), armed: 1_000_000, quotes: { m1: quote(0.002) } }); // bought 4.6 days before "now"
    await runPass(ladder, old.deps, old.st);
    await run(old, 0.0012, 3);
    expect(old.sent).toEqual([]);
    const profit = harness({ fills: fresh(), armed: 1_000_000, quotes: { m1: quote(0.002) } });
    await started(profit);
    await run(profit, 0.0042, 2); // first profit
    expect(profit.sent).toHaveLength(1);
    await run(profit, 0.0012, 3); // down to 0.6x: the line's business, not a fresh loser
    expect(profit.sent.filter((t) => t.startsWith("🟠"))).toEqual([]);
  });

  it("needs a position worth $1, a real pool and a position that is small next to it, and can be switched off", async () => {
    const tiny = harness({ fills: new Map<string, Fill[]>([["m1", [{ t: 1_000_500, side: "buy", tokens: 500, usd: 1 }]]]), armed: 1_000_000, quotes: { m1: quote(0.002) } });
    tiny.deps.now = () => 1_001_000;
    await runPass(ladder, tiny.deps, tiny.st);
    await run(tiny, 0.0012, 3); // $0.60 of value
    expect(tiny.sent).toEqual([]);
    const thin = harness({ fills: fresh(), armed: 1_000_000, quotes: { m1: quote(0.002) } });
    await started(thin);
    await run(thin, 0.0012, 3, 500);
    expect(thin.sent).toEqual([]);
    const off = harness({ fills: fresh(), armed: 1_000_000, quotes: { m1: quote(0.002) } });
    await started(off);
    await run(off, 0.0012, 3, 20_000, { loss: false });
    expect(off.sent).toEqual([]);
  });

  it("is not sent for a position that was already 30% down when it was switched on, and a later first profit still has sound", async () => {
    const h = harness({ fills: fresh(), armed: 1_000_000, quotes: { m1: quote(0.0012) } });
    h.deps.now = () => 1_001_000;
    await run(h, 0.0012, 3); // seen for the first time at 0.6x, with the new ladder not yet seeded
    expect(h.sent).toEqual([]);
    expect(h.rows.get("m1|1000500|-0.7")?.state).toBe("seeded");
    await run(h, 0.0042, 2);
    expect(h.sent).toHaveLength(1);
    expect(h.silent[0]).toBe(false);
    expect(h.sent[0]).toMatch(/^🟢/);
  });
});

describe("prices for the held coins", () => {
  const MINT = "HgTGdc29D5bDMrDvsCLnorxz899VyDj7ZN7FPa6vpump";
  const OTHER = "OTHERmint1111111111111111111111111111111111";
  const json = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);

  it("takes the most liquid priced pool of each coin from the batch answer", async () => {
    const f = (async () => json([{ baseToken: { address: MINT, symbol: "VEIL" }, priceUsd: "0.0025", liquidity: { usd: 142_000 }, pairAddress: "LIVE" }])) as unknown as typeof fetch;
    const q = await dexQuotes([MINT], f);
    expect(q.get(MINT)).toEqual({ price: 0.0025, liq: 142_000, pair: "LIVE", symbol: "VEIL" });
  });

  it("a coin whose batch pair has no price (an old bonding-curve pair) is priced from its other pools, so its alert can still fire", async () => {
    const urls: string[] = [];
    const f = (async (url: string) => {
      urls.push(url);
      if (url.includes("/tokens/v1/")) return json([{ baseToken: { address: MINT, symbol: "VEIL" }, dexId: "pumpfun", priceUsd: null, liquidity: { usd: null }, pairAddress: "CURVE" }]);
      return json({ pairs: [{ chainId: "solana", baseToken: { address: MINT, symbol: "VEIL" }, dexId: "pumpswap", priceUsd: "0.0024", liquidity: { usd: 140_000 }, pairAddress: "LIVE" }] });
    }) as unknown as typeof fetch;
    const q = await dexQuotes([MINT], f);
    expect(q.get(MINT)).toEqual({ price: 0.0024, liq: 140_000, pair: "LIVE", symbol: "VEIL" });
    expect(urls.some((u) => u.includes(`/latest/dex/tokens/${MINT}`))).toBe(true);
  });

  it("a coin the batch answer does not list at all is not asked about again (it is gone), and a coin with a price costs no extra call", async () => {
    const urls: string[] = [];
    const f = (async (url: string) => {
      urls.push(url);
      return json([{ baseToken: { address: MINT, symbol: "VEIL" }, priceUsd: "0.1", liquidity: { usd: 50_000 }, pairAddress: "P" }]);
    }) as unknown as typeof fetch;
    const q = await dexQuotes([MINT, OTHER], f);
    expect(q.has(OTHER)).toBe(false);
    expect(urls).toHaveLength(1);
  });
});
