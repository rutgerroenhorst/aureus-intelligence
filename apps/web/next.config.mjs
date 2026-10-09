import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */

// `next build` and `next dev` must not share an output directory. They did, so a
// `pnpm -r build` run while the dev server was up overwrote the chunks the running
// server had already resolved, and every page 500'd with "Cannot find module
// './646.js'" until .next was deleted by hand. Giving the production build its own
// directory removes the collision instead of documenting it as a hazard.
// Driven by an env var, NOT by sniffing process.argv: Next re-reads this config in
// child processes whose argv does not contain "build", so an argv heuristic makes the
// build phases disagree about where the manifest lives. The environment propagates.
const nextConfig = {
  reactStrictMode: true,
  // Type errors must not block a deploy: `next dev` never type-checks, so type nits slip in unnoticed.
  typescript: { ignoreBuildErrors: true },
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Workspace packages ship as source-mapped ESM; transpile them for Next.
  transpilePackages: ["@aureus/config", "@aureus/contracts", "@aureus/readiness", "@aureus/rule-engine", "@aureus/research"],
  experimental: {
    // pnpm workspace: serverless file tracing must start at the repo root, not apps/web.
    outputFileTracingRoot: path.join(here, "../.."),
    // pg / ioredis are server-only deps — keep them external to the bundle.
    serverComponentsExternalPackages: ["pg", "ioredis"],
    // The site runs the scanner itself (lib/cloudScan.ts imports apps/worker/src/run.ts), which lives outside this app.
    externalDir: true,
  },
  webpack(config) {
    // The worker is written for tsx/Node ESM, where "./pipeline.js" means pipeline.ts. Teach webpack the same rule.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};
export default nextConfig;
