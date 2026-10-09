/**
 * @aureus/config — validated environment + per-source operating mode.
 *
 * Design rule (binding): a missing credential NEVER silently becomes fake live
 * data. It produces an explicit MOCK/DEGRADED/DISABLED mode that the rest of the
 * system reads and surfaces. In particular, without HELIUS_API_KEY the on-chain
 * source is DEGRADED and Safety can never reach PASSED (see safety engine).
 */
import { z } from "zod";
import type { SourceMode } from "@aureus/contracts";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  DATABASE_URL: z
    .string()
    .url()
    .default("postgres://aureus:aureus@localhost:5432/aureus"),
  DATABASE_URL_APP: z.string().url().optional(),
  DATABASE_URL_OUTCOME: z.string().url().optional(),
  DATABASE_URL_READONLY: z.string().url().optional(),

  REDIS_URL: z.string().url().default("redis://localhost:6379"),

  HELIUS_API_KEY: z.string().trim().optional().default(""),

  DEXSCREENER_BASE_URL: z.string().url().default("https://api.dexscreener.com"),
  GECKOTERMINAL_BASE_URL: z
    .string()
    .url()
    .default("https://api.geckoterminal.com/api/v2"),

  BUBBLEMAPS_API_KEY: z.string().trim().optional().default(""),
  BUBBLEMAPS_MODE: z.enum(["iframe", "api"]).default("iframe"),
});

export type Env = z.infer<typeof EnvSchema>;

export interface SourceModes {
  dexscreener: SourceMode;
  geckoterminal: SourceMode;
  helius: SourceMode;
  bubblemaps: SourceMode;
  fomo: SourceMode;
}

export interface AppConfig {
  env: Env;
  modes: SourceModes;
}

let cached: AppConfig | null = null;

export function loadConfig(raw: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  const env = parsed.data;

  const modes: SourceModes = {
    // Dex Screener + GeckoTerminal need no key → LIVE (public REST).
    dexscreener: "LIVE",
    geckoterminal: "LIVE",
    // Helius: LIVE only with a key; otherwise DEGRADED (on-chain checks UNAVAILABLE).
    helius: env.HELIUS_API_KEY ? "LIVE" : "DEGRADED",
    // Bubblemaps: iframe evidence link works without a key; api mode needs one.
    bubblemaps:
      env.BUBBLEMAPS_MODE === "api"
        ? env.BUBBLEMAPS_API_KEY
          ? "LIVE"
          : "DISABLED"
        : "DEGRADED", // iframe-only = evidence link, not data
    // FOMO: manual-import only until permission established.
    fomo: "DEGRADED",
  };

  cached = { env, modes };
  return cached;
}

export function getConfig(): AppConfig {
  return cached ?? loadConfig();
}

/** Human-readable summary for `pnpm env:check`. */
export function describeConfig(cfg: AppConfig): string {
  const { env, modes } = cfg;
  const redact = (u: string) => u.replace(/\/\/([^:]+):[^@]+@/, "//$1:****@");
  const lines = [
    `NODE_ENV            ${env.NODE_ENV}`,
    `DATABASE_URL        ${redact(env.DATABASE_URL)}`,
    `REDIS_URL           ${env.REDIS_URL}`,
    `--- source modes ---`,
    `dexscreener         ${modes.dexscreener}  (public REST, polling)`,
    `geckoterminal       ${modes.geckoterminal}  (public REST, 10 rpm free)`,
    `helius              ${modes.helius}${
      modes.helius === "DEGRADED"
        ? "  (no HELIUS_API_KEY → on-chain checks UNAVAILABLE; Safety cannot PASS)"
        : "  (key present)"
    }`,
    `bubblemaps          ${modes.bubblemaps}  (${env.BUBBLEMAPS_MODE})`,
    `fomo                ${modes.fomo}  (manual import only)`,
  ];
  return lines.join("\n");
}
