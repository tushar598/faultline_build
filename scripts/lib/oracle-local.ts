// The local world for the oracle (HANDOVER §10 step 6): exactly the local e2e world (scripts/lib/e2e.ts deployWorld:
// MockUSD + MockHTS at 0x167 + MockBond, the REAL FaultlinePool + FaultlineTrigger, local profile §12.1, replay terms
// with Bhuj at riskStart + 10 days, investors A/B/C subscribed) on an HTTP Hardhat node, plus the two files the oracle
// reads: oracle/terms/local.json and oracle/config.local.json (both gitignored, rewritten on every deploy).
// MOCK-TESTED, LOCAL ONLY: MockBond is not ATS, MockUSD/MockHTS are not HTS, the HCS publisher is the file mock.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ethers, network } from "hardhat";
import { termsHash } from "../../shared/ts/attestation";
import { deployWorld, type Log, type World } from "./e2e";

export const ORACLE_DIR = path.join(__dirname, "..", "..", "oracle");
export const CONFIG_FILE = path.join(ORACLE_DIR, "config.local.json");
export const TERMS_FILE = path.join(ORACLE_DIR, "terms", "local.json");

/** Hardhat account indexes the oracle CLI uses on the local chain (keys.ts HARDHAT_ACCOUNT_*); same signers as deployWorld. */
export const LOCAL_ACCOUNTS = { oracle: 3, relayer: 4, trustee: 2 } as const;

export type OracleWorld = { w: World; trigger: string; topicId: string; configFile: string; termsFile: string };

export async function deployOracleWorld(log: Log, opts: { challengeWindow?: bigint } = {}): Promise<OracleWorld> {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  if (chainId !== 31_337n) throw new Error(`deploy-local runs only on the local chain (31337), not ${chainId}`);
  const url = (network.config as { url?: string }).url;
  if (!url) throw new Error("the oracle needs an HTTP node: start `npm run node` and use --network localhost");
  const fromBlock = await ethers.provider.getBlockNumber();
  const w = await deployWorld("oracle local (mock HCS)", log, opts); // includes the D14 replay-chain guard
  const trigger = await w.trigger.getAddress();
  const topicId = `local-${trigger.slice(2, 10).toLowerCase()}`;

  // A fresh Hardhat node deploys to the SAME deterministic addresses, so a ledger or mock-HCS file left by an earlier
  // run would describe another chain's history under this trigger address. Local state for it starts empty.
  for (const stale of [path.join(ORACLE_DIR, "out", "local", `ledger-31337-${trigger.toLowerCase()}.json`), path.join(ORACLE_DIR, ".hcs-mock", `${topicId}.jsonl`)]) {
    if (fs.existsSync(stale)) {
      fs.rmSync(stale);
      log(`  removed stale local oracle state from an earlier run at the same address: ${path.relative(process.cwd(), stale)}`);
    }
  }
  fs.mkdirSync(path.dirname(TERMS_FILE), { recursive: true });
  fs.writeFileSync(TERMS_FILE, JSON.stringify(w.terms, null, 2) + "\n");
  const config = {
    rpcUrl: url,
    chainId: 31337,
    trigger,
    termsFile: "terms/local.json",
    hcs: { mode: "mock", topicId, mockDir: ".hcs-mock" },
    pollIntervalSec: 60,
    pendingPollSec: 10,
    attestationTtlSec: 3600,
    stateDir: "out/local",
    fromBlock,
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
  log(`  oracle files: ${path.relative(process.cwd(), CONFIG_FILE)}, ${path.relative(process.cwd(), TERMS_FILE)} (termsHash ${termsHash(w.terms)})`);
  log(`  mock HCS topic ${topicId}; oracle = Hardhat account #${LOCAL_ACCOUNTS.oracle} ${w.oracle.address}, relayer = #${LOCAL_ACCOUNTS.relayer} ${w.relayer.address}`);
  return { w, trigger, topicId, configFile: CONFIG_FILE, termsFile: TERMS_FILE };
}

/** Runs the oracle CLI like an operator (`npx tsx src/cli.ts …` in oracle/) with the LOCAL Hardhat test accounts;
 *  prints its output indented and returns stdout. A real key from the shell never reaches a local run. */
export function runOracleCli(args: string[], expectExit = 0): string {
  const env: NodeJS.ProcessEnv = { ...process.env, ORACLE_CONFIG: "config.local.json", HARDHAT_ACCOUNT_ORACLE: String(LOCAL_ACCOUNTS.oracle), HARDHAT_ACCOUNT_RELAYER: String(LOCAL_ACCOUNTS.relayer) };
  delete env.ORACLE_PRIVATE_KEY;
  delete env.RELAYER_PRIVATE_KEY;
  console.log(`\n$ cd oracle && npx tsx src/cli.ts ${args.join(" ")}`);
  const r = spawnSync("npx", ["tsx", "src/cli.ts", ...args], { cwd: ORACLE_DIR, env, encoding: "utf8" });
  const text = `${r.stdout}${r.stderr}`.trimEnd();
  if (text) console.log(text.split("\n").map((l) => `  │ ${l}`).join("\n"));
  if (r.status !== expectExit) throw new Error(`oracle ${args[0]} exited ${r.status}, expected ${expectExit}`);
  return r.stdout;
}
