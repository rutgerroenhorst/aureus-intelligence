import { describe, it, expect } from "vitest";
import { loadConfig } from "./index.js";

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
};

describe("source modes from environment", () => {
  it("Helius is DEGRADED without a key (never fabricates live data)", () => {
    const cfg = loadConfig({ ...base, HELIUS_API_KEY: "" } as NodeJS.ProcessEnv);
    expect(cfg.modes.helius).toBe("DEGRADED");
  });

  it("Helius is LIVE with a key", () => {
    const cfg = loadConfig({
      ...base,
      HELIUS_API_KEY: "test-key",
    } as NodeJS.ProcessEnv);
    expect(cfg.modes.helius).toBe("LIVE");
  });

  it("Dex Screener and GeckoTerminal are LIVE without keys", () => {
    const cfg = loadConfig(base as NodeJS.ProcessEnv);
    expect(cfg.modes.dexscreener).toBe("LIVE");
    expect(cfg.modes.geckoterminal).toBe("LIVE");
  });

  it("Bubblemaps api mode without key is DISABLED", () => {
    const cfg = loadConfig({
      ...base,
      BUBBLEMAPS_MODE: "api",
      BUBBLEMAPS_API_KEY: "",
    } as NodeJS.ProcessEnv);
    expect(cfg.modes.bubblemaps).toBe("DISABLED");
  });

  it("FOMO is always DEGRADED (manual import only)", () => {
    const cfg = loadConfig(base as NodeJS.ProcessEnv);
    expect(cfg.modes.fomo).toBe("DEGRADED");
  });

  it("rejects an invalid DATABASE_URL", () => {
    expect(() =>
      loadConfig({ ...base, DATABASE_URL: "not-a-url" } as NodeJS.ProcessEnv),
    ).toThrow(/Invalid environment/);
  });
});
