// Smoke test of the dashboard against a local Hardhat node (MOCK-TESTED, LOCAL ONLY). Run from the repo root with
// `npm run web:e2e`, which starts a node on :8545 when none is running. The test deploys a fresh demo world itself.
import { defineConfig } from "@playwright/test";

const PORT = 3210;

export default defineConfig({
  testDir: "e2e",
  timeout: 360_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [["list"]],
  outputDir: "e2e/.results",
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure" },
  webServer: { command: `npm run build && FAULTLINE_LOCAL_API=1 npx next start -p ${PORT}`, url: `http://localhost:${PORT}`, timeout: 240_000, reuseExistingServer: false },
});
