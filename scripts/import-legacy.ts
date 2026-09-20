/**
 * pnpm import:legacy [file] [--commit]
 *
 * Default file: legacy/inbox/Wallet_Deployer_Intelligence_DB.xlsx
 * Dry-run (no --commit): parses, stages to legacy.* (if DB reachable), writes a
 * report. --commit also promotes PENDING rows into canonical tables.
 * Always writes a timestamped report to legacy/reports/.
 */
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, basename } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { getPool, closePool } from "@aureus/db";
import { runImport } from "@aureus/legacy-import";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const fileArg = args.find((a) => !a.startsWith("--"));
const file = resolve(
  fileArg ?? join(root, "legacy", "inbox", "Wallet_Deployer_Intelligence_DB.xlsx"),
);

if (!existsSync(file)) {
  console.error(`Legacy file not found: ${file}`);
  console.error(
    "Drop the workbook at legacy/inbox/Wallet_Deployer_Intelligence_DB.xlsx (see legacy/README.md), then re-run.",
  );
  process.exit(1);
}

const generatedAt = new Date().toISOString();
const stamp = generatedAt.replace(/[:.]/g, "-");

// Try to connect to the DB; if unreachable, do a parse-only dry run.
let pool: ReturnType<typeof getPool> | undefined;
try {
  pool = getPool();
  await pool.query("SELECT 1");
} catch {
  console.warn("DB not reachable — parse-only dry run (nothing staged/promoted).");
  pool = undefined;
}

try {
  const { report, markdown, runId } = await runImport({ file, commit, generatedAt, pool });

  const base = join(root, "legacy", "reports", `import-${stamp}`);
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${base}.md`, markdown);

  console.log(markdown);
  console.log(`\nReport written: ${basename(base)}.md / .json`);
  if (runId) console.log(`Import run id: ${runId} (committed=${commit})`);
  if (!commit) console.log("Dry run — re-run with --commit to promote PENDING rows.");
} catch (err) {
  console.error("IMPORT ERROR:", (err as Error).message);
  process.exitCode = 1;
} finally {
  if (pool) await closePool();
}
