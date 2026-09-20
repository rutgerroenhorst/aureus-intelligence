import { defineConfig } from "vitest/config";
import { readFileSync } from "fs";
import { resolve } from "path";

// Read pnpm-workspace to resolve package aliases
const workspaceYaml = readFileSync("pnpm-workspace.yaml", "utf-8");
const packages = workspaceYaml
  .split("\n")
  .filter((line: string) => line.startsWith("  - "))
  .map((line: string) => line.replace("  - ", "").replace(/\/\*\*/, ""));

// Build alias map for all packages
const alias: Record<string, string> = {};
for (const pkg of packages) {
  const packageJsonPath = resolve(pkg, "package.json");
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    if (packageJson.name) {
      alias[packageJson.name] = resolve(pkg, "src");
    }
  } catch {
    // Skip if package.json doesn't exist or is invalid
  }
}

export default defineConfig({
  resolve: {
    alias,
  },
  test: {
    include: ["packages/**/*.test.ts", "scripts/**/*.test.ts", "tests/**/*.test.ts", "apps/**/*.test.ts"],
    environment: "node",
    globals: false,
    // DB-backed integration tests do real Postgres round-trips; the first one also
    // pays cold-start (pool connect + tsx compile). 5s is too tight — allow 30s.
    testTimeout: 30_000,
  },
});
