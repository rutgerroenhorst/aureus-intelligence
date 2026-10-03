import { describe, it, expect } from "vitest";
import { TelegramChannel, FakeChannel, escapeHtml } from "./telegram.js";
import { renderMessage, type MessageFacts } from "./format.js";
import type { AlertProposal } from "@aureus/alert-engine";

const facts: MessageFacts = {
  symbol: "TES<b>T", liquidityUsd: 81_000, fdvUsd: 640_000, volumeUsd: 420_000,
  pairAgeLabel: "18m", dexUrl: "https://dexscreener.com/solana/POOL", aureusUrl: "http://localhost:3000/candidate/x",
  invalidation: ["Below $0.01", "Liquidity drain > 30%"], risks: ["Holder concentration: 22%"], heliusDegraded: false,
};
function proposal(over: Partial<AlertProposal> = {}): AlertProposal {
  return {
    policyId: "ENTRY_READY", policyVersion: "ae-0.1.0", level: "ENTRY_READY", severity: "HIGH",
    stateFrom: "ENTRY_WATCH", stateTo: "ENTRY_READY", evidence: {}, evidenceHash: "abc12345",
    reasons: ["Safety PASS"], positives: ["Structure confirmed", "Retest confirmed"], missing: [], riskReasons: [], ...over,
  };
}

describe("html escaping", () => {
  it("escapes angle brackets and ampersands", () => {
    expect(escapeHtml("a<b>&c")).toBe("a&lt;b&gt;&amp;c");
  });
  it("renders a symbol safely (no raw tags injected)", () => {
    const msg = renderMessage(proposal(), facts);
    expect(msg).toContain("$TES&lt;b&gt;T");
    expect(msg).not.toContain("$TES<b>T");
    expect(msg).toContain("Not financial advice.");
    expect(msg).toContain("Invalidation:");
  });
  it("RISK message shows previous/new state", () => {
    const msg = renderMessage(proposal({ level: "RISK", policyId: "RISK", stateFrom: "ENTRY_WATCH", stateTo: "REJECTED", riskReasons: ["SAF-005 FAIL"] }), facts);
    expect(msg).toContain("AUREUS RISK");
    expect(msg).toContain("New state: REJECTED");
    expect(msg).toContain("SAF-005 FAIL");
  });
  it("WATCH with helius degraded adds on-chain unavailable note", () => {
    const msg = renderMessage(proposal({ level: "WATCH", policyId: "NEW_WATCH", stateTo: "STRUCTURE_WATCH", missing: ["Entry structure not confirmed"] }), { ...facts, heliusDegraded: true });
    expect(msg).toContain("On-chain confirmation unavailable — not entry ready");
  });
});

describe("telegram channel safety", () => {
  it("is DEGRADED without config and never sends", async () => {
    const ch = new TelegramChannel({ token: "", chatId: "", enabled: false });
    expect(ch.mode).toBe("DEGRADED");
    const r = await ch.send({ text: "hi" });
    expect(r.ok).toBe(false);
  });
  it("never leaks the bot token in a returned error", async () => {
    const ch = new TelegramChannel({ token: "SECRET123:abcdef", chatId: "42", enabled: true, apiBase: "http://127.0.0.1:1", timeoutMs: 300 });
    const r = await ch.send({ text: "hi" });
    expect(r.ok).toBe(false);
    expect(r.error ?? "").not.toContain("SECRET123");
  });
});

describe("fake channel", () => {
  it("records sent messages and can script failures", async () => {
    const ch = new FakeChannel({ failFirst: 1 });
    expect((await ch.send({ text: "a" })).ok).toBe(false);
    expect((await ch.send({ text: "b" })).ok).toBe(true);
    expect(ch.sent.length).toBe(1);
  });
});
