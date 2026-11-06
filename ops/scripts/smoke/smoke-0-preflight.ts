// Smoke phase 0 — preflight. NO transaction, ever.
//
// 1. Keystore: the six FLH_* names exist (names only, no password). With CHECK_KEYS=1 (owner, types the keystore
//    password) each key is loaded, its address derived and compared with docs/ACCOUNTS.md; any
//    mismatch aborts. Only addresses are printed.
// 2. Accounts on the mirror node: balance, hollow or complete, nonce; the oracle pays nothing (its Hedera account,
//    if any, is only reported).
// 3. Main repo: `npm run compile`, commit hash, uncommitted changes in contracts/ or shared/, keccak256 of the
//    FaultlinePool and FaultlineTrigger creation bytecode (saved as the build the smoke run must use).
// 4. shared/ts loads from this repo (the REAL module) and the live USGS record of usp000a8ds (read-only) has the
//    same dataHash as the saved fixture.
// 5. The plan and an HBAR estimate per phase and account; the balances now become the HBAR baseline.
import { execFileSync } from "node:child_process";
import { formatUnits } from "ethers";
import { ROOT, gasPriceWei, signerFor } from "../lib/common.js";
import { usdPerHbar } from "../lib/hedera.js";
import { ACCOUNTS, BHUJ_ID, FAULTLINE, PAYING_ROLES, SMOKE_ROLES, bhujFixture, buildInfo, loadSmoke, mirrorAccount, provider, saveSmoke, sharedTs, type Role } from "./lib.js";

let failed = false;
const fail = (msg: string) => {
  failed = true;
  console.log(`  ✖ ${msg}`);
};
const p = await provider();
console.log(`chainId ${(await p.getNetwork()).chainId} (Hashio testnet)`);

// ---------------------------------------------------------------- 1. keystore
console.log("\n1. keystore");
const names = execFileSync("npx", ["hardhat", "keystore", "list"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split(/\s+/);
for (const r of SMOKE_ROLES) if (!names.includes(ACCOUNTS[r].keyName)) fail(`keystore has no ${ACCOUNTS[r].keyName}`);
console.log(`  names present: ${SMOKE_ROLES.every((r) => names.includes(ACCOUNTS[r].keyName)) ? "all six FLH_* keys" : "NO"}`);
if (process.env.CHECK_KEYS === "1") {
  for (const r of SMOKE_ROLES) {
    const w = await signerFor(ACCOUNTS[r].network); // prints "signer (NAME): <address>" only
    if (w.address.toLowerCase() !== ACCOUNTS[r].evm.toLowerCase()) fail(`${ACCOUNTS[r].keyName} derives to ${w.address}, expected ${ACCOUNTS[r].evm}`);
    else console.log(`  ${r}: OK`);
  }
} else {
  console.log("  key → address check skipped (needs the keystore password): owner runs CHECK_KEYS=1 once before phase 1");
}

// ---------------------------------------------------------------- 2. accounts
console.log("\n2. accounts (mirror node)");
for (const r of SMOKE_ROLES) {
  const a = ACCOUNTS[r];
  const m = await mirrorAccount(a.id ?? a.evm);
  if (r === "oracle") {
    // The oracle signer pays nothing; its funded Hedera account (0.0.11329557) is only reported.
    if (m) console.log(`  oracle    ${a.evm}: Hedera account ${m.account} (${(m.balance.balance / 1e8).toFixed(4)} HBAR), never a payer (signs EIP-712 only) ✓`);
    else console.log(`  oracle    ${a.evm}: no Hedera account (signs EIP-712 only) ✓`);
    continue;
  }
  if (!m) { fail(`${r} ${a.id} not found on the mirror node`); continue; }
  if (m.evm_address.toLowerCase() !== a.evm.toLowerCase()) fail(`${r} ${a.id} has EVM ${m.evm_address}, expected ${a.evm}`);
  const state = m.key ? `complete (${m.key._type})` : "HOLLOW (completes on its first signed tx)";
  console.log(`  ${r.padEnd(9)} ${m.account} ${m.evm_address}: ${(m.balance.balance / 1e8).toFixed(4)} HBAR, ${state}, ethereum_nonce ${m.ethereum_nonce}, max_auto_assoc ${m.max_automatic_token_associations}`);
}

// ---------------------------------------------------------------- 3. main repo build
console.log("\n3. main repo build");
execFileSync("npm", ["run", "compile"], { cwd: FAULTLINE, stdio: ["ignore", "ignore", "inherit"] });
const build = buildInfo();
console.log(`  ${FAULTLINE} @ ${build.commit}${build.dirty ? "  ✖ contracts/ or shared/ have UNCOMMITTED changes" : " (contracts/ and shared/ clean)"}`);
console.log(`  FaultlinePool    creation bytecode keccak256 ${build.poolInitcodeKeccak}`);
console.log(`  FaultlineTrigger creation bytecode keccak256 ${build.triggerInitcodeKeccak}`);
if (build.dirty) fail("commit the main repo before the smoke run");
const prev = loadSmoke().build as typeof build | undefined;
if (prev && (prev.poolInitcodeKeccak !== build.poolInitcodeKeccak || prev.triggerInitcodeKeccak !== build.triggerInitcodeKeccak)) {
  console.log(`  ⚠ bytecode differs from the build recorded earlier (commit ${prev.commit}); a deployed pool/trigger would not match`);
}

// ---------------------------------------------------------------- 4. shared/ts + live USGS
console.log("\n4. shared/ts and the live USGS record");
const shared = sharedTs();
const fixture = bhujFixture();
const fixtureHash = shared.dataHash(fixture);
console.log(`  shared/ts loaded from ${FAULTLINE}/shared/ts; replay allowed on chainIds ${shared.REPLAY_CHAIN_IDS.join(", ")}`);
console.log(`  saved fixture ${BHUJ_ID}: dataHash ${fixtureHash}`);
const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=${BHUJ_ID}&format=geojson`;
const res = await fetch(url, { headers: { accept: "application/json" } });
if (!res.ok) fail(`USGS ${url}: HTTP ${res.status}`);
else {
  const live = (await res.json()) as typeof fixture;
  const liveHash = shared.dataHash(live);
  const pr = live.properties;
  console.log(`  live USGS ${live.id}: M${pr.mag} ${pr.magType}, ${pr.status}, depth ${live.geometry.coordinates[2]} km, ${live.geometry.coordinates[1]} N ${live.geometry.coordinates[0]} E, updated ${pr.updated}`);
  console.log(`  live dataHash ${liveHash} ${liveHash === fixtureHash ? "== fixture ✓" : "≠ fixture"}`);
  if (liveHash !== fixtureHash) fail("the live USGS record changed since the fixture was saved; re-save the fixture before the smoke run");
}

// ---------------------------------------------------------------- 5. plan + estimate
// Gas per tx: measured on testnet in spikes S1/S3 where the same call was made (faultline/docs/LESSONS.md), else
// the local Hardhat gas report (marked "local"; Hedera may differ). SDK fees: measured S3 HBAR values.
const price = await gasPriceWei(p);
const hbarPerGas = Number(formatUnits(price, 18));
type Item = [role: Role, what: string, gas?: number, sdkHbar?: number];
const PLAN: Record<string, Item[]> = {
  "1 token": [
    ["deployer", "TokenCreate fUSD (SDK; S3 13.393)", undefined, 13.393],
    ["sponsor", "associate() via HIP-719 facade (S3 726,488)", 726_488],
    ["investorA", "associate() via HIP-719 facade (S3)", 726_488],
    ["investorB", "associate() via HIP-719 facade (S3)", 726_488],
    ["deployer", "TokenGrantKyc ×3 + TokenTransfer ×3 (SDK; S3 0.013 each)", undefined, 6 * 0.013],
  ],
  "2 bond": [
    ["deployer", "deployBond (S1 7,332,487)", 7_332_487],
    ["deployer", "addIssuer (S1 126,989)", 126_989],
    ["deployer", "grantKyc A, B (S1 ≈257k each)", 2 * 257_000],
  ],
  "3 deploy": [
    ["deployer", "deploy FaultlinePool (local 2,210,014)", 2_210_014],
    ["deployer", "deploy FaultlineTrigger (local 2,001,766)", 2_001_766],
    ["deployer", "initialize → associate (S3 contract 733,941)", 760_000],
    ["deployer", "TokenGrantKyc(pool) (SDK)", undefined, 0.013],
    ["deployer", "applyRoles ISSUER+CONTROLLER → pool (S1 321,620)", 321_620],
  ],
  "4 subscribe": [
    ["sponsor", "approve (S3 727,020) + fundCoupons (local 117,841 + isKyc)", 727_020 + 170_000],
    ["investorA", "approve + invest (local 168,512 + first ATS mint S1 477,449 + isKyc)", 727_020 + 700_000],
    ["investorB", "approve + invest", 727_020 + 700_000],
  ],
  "5 event": [
    ["deployer", "submit (local 137,626) + execute (local 147,557)", 137_626 + 147_557],
  ],
  "6 settle": [
    ["investorA", "redeem (local 195,969 + controllerRedeem S1 178,446) + claim (local 70,391)", 400_000 + 70_391],
    ["investorB", "redeem + claim", 400_000 + 70_391],
    ["sponsor", "claim ×2", 2 * 70_391],
    ["deployer", "sweepExcess (local 120,294) + sweepDust (local 53,833)", 120_294 + 53_833],
  ],
};
console.log(`\n5. plan and HBAR estimate (gas price ${formatUnits(price, 9)} gwei-equivalent; $${(await usdPerHbar()).toFixed(4)}/HBAR; fees follow gas USED, the 1.3× limit is free)`);
const perRole: Record<string, number> = {};
for (const [phase, items] of Object.entries(PLAN)) {
  let sum = 0;
  for (const [role, what, gas, sdk] of items) {
    const h = (gas ?? 0) * hbarPerGas + (sdk ?? 0);
    perRole[role] = (perRole[role] ?? 0) + h;
    sum += h;
    console.log(`  phase ${phase.padEnd(11)} ${role.padEnd(9)} ${h.toFixed(3).padStart(7)} HBAR  ${what}`);
  }
  console.log(`  phase ${phase.padEnd(11)} ${"total".padEnd(9)} ${sum.toFixed(3).padStart(7)} HBAR`);
}
const baseline: Record<string, number> = {};
for (const r of PAYING_ROLES) {
  const bal = (await mirrorAccount(ACCOUNTS[r].id!))!.balance.balance;
  baseline[r] = bal;
  const est = perRole[r] ?? 0;
  const ok = bal / 1e8 >= est * 1.5;
  console.log(`  ${r.padEnd(9)} estimate ${est.toFixed(2).padStart(6)} HBAR vs balance ${(bal / 1e8).toFixed(2)} ${ok ? "✓ (≥ 1.5× estimate)" : "⚠ below 1.5× estimate"}`);
}

if (failed) {
  console.log("\nPREFLIGHT FAILED — nothing may be sent. Fix the ✖ items above.");
  process.exitCode = 1;
} else {
  // Keep the first baseline across reruns, so "since preflight" stays the whole smoke run.
  const st = loadSmoke();
  saveSmoke({ build, baselineTinybar: st.baselineTinybar ?? baseline, preflightAt: new Date().toISOString(), ...(process.env.CHECK_KEYS === "1" ? { keysCheckedAt: new Date().toISOString() } : {}) });
  console.log(`\nPREFLIGHT OK${process.env.CHECK_KEYS === "1" ? "" : " (except the key check: CHECK_KEYS=1)"} — state in out/smoke-state.json`);
}
