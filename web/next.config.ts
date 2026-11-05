import path from "node:path";
import type { NextConfig } from "next";

// The dashboard imports the repo's shared/ts (HCS message format, attestation helpers, D16 signature checks), so the
// Turbopack root is the repo root (files outside the root are not resolved). shared/ts imports "ethers"; the alias
// pins it to web's own copy so the bundle carries one ethers.
const repoRoot = path.resolve(__dirname, "..");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
    resolveAlias: {
      ethers: "./web/node_modules/ethers",
    },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
