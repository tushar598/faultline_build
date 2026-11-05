// Ported from the reference repo (ops/scripts/demo/demo-0-preflight.ts) on 2026-11-06 with the new FLH_* accounts; nothing from the old deployment is reused.
// Full demo phase 0 — preflight. NO transaction, ever.
//
// 1. RPC: every candidate relay (FL_RPC_URL or Hashio, thirdweb) — chainId, latest block, latency, browser CORS; the
//    one this run uses is recorded in out/demo-state.json.
// 2. Keystore: the eight FLH_* names exist (names only). With CHECK_KEYS=1 (owner, types the keystore password) every
//    key is loaded, its address derived and compared with docs/ACCOUNTS.md. Only addresses printed.
// 3. Accounts on the mirror node: HBAR balance, hollow or complete; the oracle signer pays nothing (its
//    Hedera account, if any, is only reported).
// 4. fUSD from this repo's smoke run (reused, docs/DEPLOYMENTS.md): treasury/KYC/supply key = deployer; sponsor, A and B associated,
//    KYC GRANTED and holding enough for this run.
// 5. Main repo: `npm run compile`, commit, uncommitted changes in contracts/ shared/ oracle/, keccak256 of both creation
//    bytecodes, and the D17 markers in the source.
// 6. Records: live USGS usp000a8ds dataHash == the saved fixture; the SYNTHETIC Flow A fixture is labelled, passes the
//    rule and maps to 5000 bps; the oracle CLI starts.
// 7. HBAR budget per account (measured smoke-run / S7 fees, +20 %) vs balance; the deployer must keep >= 10 HBAR.
// 8. The timeline if phase 1 ran now and phase 2 followed 5 min later.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { RPC_CANDIDATES, ROOT, rpcHealth, rpcUrl, signerFor } from "../lib/common.js";
import { mirror, usdPerHbar } from "../lib/hedera.js";
import {
  ACCOUNTS, BHUJ_ID, BOND, FAULTLINE, FUSD, LOSS, MIN, P, PAYING_ROLES, RESERVE, SYNTHETIC_FIXTURE, TICKET, bhujFixture, buildInfo, loadDemo, mirrorAccount,
  printTimeline, provider, runOracle, saveSmoke, scheduleFor, sharedTs, syntheticFixture, termsFor, usd, type Role,
} from "./lib.js";

let failed = false;
const fail = (msg: string) => {
  failed = true;
  console.log(`  ✖ ${msg}`);
};
const DEMO_ROLES = ["deployer", "trustee", "trusteeBackup", "oracle", "relayer", "sponsor", "investorA", "investorB"] as const satisfies readonly Role[];

// ---------------------------------------------------------------- 1. RPC
console.log("1. RPC relays (Hedera docs: json-rpc-relay page lists Hashio and thirdweb without an API key)");
for (const url of RPC_CANDIDATES) {
  const h = await rpcHealth(url);
  let cors = "?";
  try {
    const r = await fetch(url, { method: "OPTIONS", headers: { Origin: "http://localhost:3000", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" }, signal: AbortSignal.timeout(10_000) });
    cors = r.headers.get("access-control-allow-origin") ?? "none";
  } catch (e) {
    cors = `error ${(e as Error).message}`;
  }
  console.log(`  ${h.ok ? "✓" : "✖"} ${url}: ${h.ok ? `block ${h.block}, ${h.ms} ms` : h.error}; browser CORS allow-origin ${cors}`);
}
const p = await provider(); // picks the first healthy candidate
console.log(`  this run uses ${rpcUrl()} (chainId ${(await p.getNetwork()).chainId})`);

// ---------------------------------------------------------------- 2. keystore
console.log("\n2. keystore");
const names = execFileSync("npx", ["hardhat", "keystore", "list"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split(/\s+/);
for (const r of DEMO_ROLES) if (!names.includes(ACCOUNTS[r].keyName)) fail(`keystore has no ${ACCOUNTS[r].keyName}`);
console.log(`  names present: ${DEMO_ROLES.every((r) => names.includes(ACCOUNTS[r].keyName)) ? "all eight FLH_* keys" : "NO"}`);
if (process.env.CHECK_KEYS === "1") {
  for (const r of DEMO_ROLES) {
    const w = await signerFor(ACCOUNTS[r].network); // prints "signer (NAME): <address>" only
    if (w.address.toLowerCase() !== ACCOUNTS[r].evm.toLowerCase()) fail(`${ACCOUNTS[r].keyName} derives to ${w.address}, expected ${ACCOUNTS[r].evm}`);
    else console.log(`  ${r}: OK`);
  }
} else console.log("  key → address check skipped (needs the keystore password): owner runs CHECK_KEYS=1 once before phase 1");

// ---------------------------------------------------------------- 3. accounts
console.log("\n3. accounts (mirror node)");
const hbar: Record<string, number> = {};
for (const r of DEMO_ROLES) {
  const a = ACCOUNTS[r];
  const m = await mirrorAccount(a.id ?? a.evm);
  if (r === "oracle") {
    // The reference's oracle had no Hedera account; this repo's oracle key also has one. No script pays from it.
    if (m) console.log(`  oracle        ${a.evm}: Hedera account ${m.account} (${(m.balance.balance / 1e8).toFixed(4)} HBAR), never a payer (signs EIP-712 and is the HCS submit key) ✓`);
    else console.log(`  oracle        ${a.evm}: no Hedera account (signs EIP-712 and is the HCS submit key; pays nothing) ✓`);
    continue;
  }
  if (!m) { fail(`${r} ${a.id} not found on the mirror node`); continue; }
  if (m.evm_address.toLowerCase() !== a.evm.toLowerCase()) fail(`${r} ${a.id} has EVM ${m.evm_address}, expected ${a.evm}`);
  hbar[r] = m.balance.balance / 1e8;
  console.log(`  ${r.padEnd(13)} ${m.account} ${m.evm_address}: ${hbar[r].toFixed(4)} HBAR, ${m.key ? `complete (${m.key._type})` : "HOLLOW (completes on its first signed tx)"}, ethereum_nonce ${m.ethereum_nonce}`);
}

// ---------------------------------------------------------------- 4. fUSD
console.log(`\n4. fUSD ${FUSD.id || "(not created yet)"} (reused from the smoke run)`);
if (!FUSD.id) fail("no fUSD yet: run the smoke run (smoke-1) and fill FUSD in scripts/demo/lib.ts first");
type TokenInfo = { name: string; symbol: string; decimals: string; treasury_account_id: string; kyc_key: { key: string } | null; supply_key: { key: string } | null; total_supply: string };
const info = FUSD.id ? await mirror<TokenInfo>(`/api/v1/tokens/${FUSD.id}`) : undefined;
const deployerKey = (await mirrorAccount(ACCOUNTS.deployer.id!))?.key?.key;
if (!info) fail(`token ${FUSD.id} not found`);
else {
  console.log(`  ${info.name} (${info.symbol}), ${info.decimals} decimals, total supply ${usd(BigInt(info.total_supply))}, treasury ${info.treasury_account_id}`);
  if (info.treasury_account_id !== ACCOUNTS.deployer.id) fail("treasury is not the deployer");
  if (info.kyc_key?.key !== deployerKey) fail("KYC key is not the deployer's key (pool KYC in phase 2 needs it)");
  else console.log("  KYC key == deployer key ✓ (phase 2 grants the pool's KYC)");
}
const needs: [Role, bigint][] = [["sponsor", RESERVE], ["investorA", TICKET.investorA], ["investorB", TICKET.investorB]];
for (const [r, need] of needs) {
  const rel = (await mirror<{ tokens: { balance: number; kyc_status: string }[] }>(`/api/v1/accounts/${ACCOUNTS[r].id}/tokens?token.id=${FUSD.id}`))?.tokens?.[0];
  const bal = BigInt(rel?.balance ?? 0);
  const ok = rel?.kyc_status === "GRANTED" && bal >= need;
  console.log(`  ${ok ? "✓" : "✖"} ${r.padEnd(9)} associated ${rel ? "yes" : "NO"}, KYC ${rel?.kyc_status ?? "-"}, balance ${usd(bal)} fUSD (needs ${usd(need)})`);
  if (!ok) fail(`${r} cannot pay ${usd(need)} fUSD`);
}

// ---------------------------------------------------------------- 5. main repo build
console.log("\n5. main repo build");
execFileSync("npm", ["run", "compile"], { cwd: FAULTLINE, stdio: ["ignore", "ignore", "inherit"] });
const build = buildInfo();
const dirtyOracle = execFileSync("git", ["-C", FAULTLINE, "status", "--porcelain", "--", "oracle/src", "oracle/fixtures", "oracle/package.json"], { encoding: "utf8" }).trim() !== "";
console.log(`  ${FAULTLINE} @ ${build.commit}${build.dirty || dirtyOracle ? "  ✖ contracts/, shared/ or oracle/ have UNCOMMITTED changes" : " (contracts/, shared/, oracle/ clean)"}`);
console.log(`  FaultlinePool    creation bytecode keccak256 ${build.poolInitcodeKeccak}`);
console.log(`  FaultlineTrigger creation bytecode keccak256 ${build.triggerInitcodeKeccak}`);
if (build.dirty || dirtyOracle) fail("commit the main repo before the demo");
const trig = fs.readFileSync(path.join(FAULTLINE, "contracts", "FaultlineTrigger.sol"), "utf8");
const pool = fs.readFileSync(path.join(FAULTLINE, "contracts", "FaultlinePool.sol"), "utf8");
const d17: [string, boolean][] = [
  ["trigger: _setRoleAdmin(TRUSTEE_ROLE, TRUSTEE_ROLE)", trig.includes("_setRoleAdmin(TRUSTEE_ROLE, TRUSTEE_ROLE)")],
  ["trigger: MAX_CHALLENGE_WINDOW = 30 days", /MAX_CHALLENGE_WINDOW = 30 days/.test(trig)],
  ["pool: MAX_GRACE = 365 days", /MAX_GRACE = 365 days/.test(pool)],
  ["pool: claim pre-checks _requireKyc(address(this))", pool.includes("_requireKyc(address(this))")],
  ["pool: D18 supply guard reverts only above the books (SEC-15)", pool.includes("if (actual > expected) revert SupplyMismatch")],
];
for (const [k, ok] of d17) {
  console.log(`  ${ok ? "✓" : "✖"} ${k}`);
  if (!ok) fail(`not the current build: ${k}`);
}
const smoke = fs.existsSync(path.join(ROOT, "out", "smoke-state.json")) ? JSON.parse(fs.readFileSync(path.join(ROOT, "out", "smoke-state.json"), "utf8")).build : undefined;
if (smoke) console.log(`  smoke-run build ${String(smoke.commit).slice(0, 7)}: pool keccak ${smoke.poolInitcodeKeccak === build.poolInitcodeKeccak ? "same" : "differs"}, trigger keccak ${smoke.triggerInitcodeKeccak === build.triggerInitcodeKeccak ? "same" : "differs"} (info only: in this repo the smoke run already used the D17 build)`);
const prev = loadDemo().build as typeof build | undefined;
if (prev && (prev.poolInitcodeKeccak !== build.poolInitcodeKeccak || prev.triggerInitcodeKeccak !== build.triggerInitcodeKeccak)) {
  console.log(`  ⚠ bytecode differs from the build recorded earlier for this demo (commit ${prev.commit})`);
  if (loadDemo().pool) fail("a pool is already deployed from another build");
}

// ---------------------------------------------------------------- 6. records + oracle CLI
console.log("\n6. records and the oracle CLI");
const shared = sharedTs();
const fixtureHash = shared.dataHash(bhujFixture());
const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=${BHUJ_ID}&format=geojson`;
const res = await fetch(url, { headers: { accept: "application/json" } });
if (!res.ok) fail(`USGS ${url}: HTTP ${res.status}`);
else {
  const live = (await res.json()) as ReturnType<typeof bhujFixture>;
  const liveHash = shared.dataHash(live);
  const pr = live.properties;
  console.log(`  live USGS ${live.id}: M${pr.mag} ${pr.magType}, ${pr.status}, depth ${live.geometry.coordinates[2]} km, updated ${pr.updated}`);
  console.log(`  live dataHash ${liveHash} ${liveHash === fixtureHash ? "== saved fixture ✓" : "≠ saved fixture"}`);
  if (liveHash !== fixtureHash) fail("the live USGS record changed since the fixture was saved (Flow B would attest different data than the docs say)");
}
const syn = syntheticFixture();
const now = Number((await p.getBlock("latest"))!.timestamp);
const whatIf = termsFor(scheduleFor(now + 5 * MIN, now + 120, now + BOND.maturityMin * MIN).s, 296n);
const synAtt = shared.buildAttestation({ feature: syn, terms: whatIf.terms, chainId: 296n, nonce: 1n, deadline: BigInt(now + 3600), nowSec: now });
const bhujAtt = shared.buildAttestation({ feature: bhujFixture(), terms: whatIf.terms, chainId: 296n, nonce: 1n, deadline: BigInt(now + 3600), nowSec: now });
console.log(`  SYNTHETIC ${SYNTHETIC_FIXTURE}: id ${syn.id}, "${String((syn.properties as { title?: unknown }).title)}"; rule ${JSON.stringify(shared.checkAcceptance(syn, whatIf.terms, now))}, lossBps ${synAtt.lossBps}`);
console.log(`  Bhuj ${BHUJ_ID}: lossBps ${bhujAtt.lossBps}; replayed observedAt − synthetic observedAt = ${whatIf.observedAt.synthetic - whatIf.observedAt.bhuj} s`);
if (synAtt.lossBps !== LOSS.synthetic) fail(`synthetic lossBps ${synAtt.lossBps} ≠ ${LOSS.synthetic}`);
if (bhujAtt.lossBps !== LOSS.bhuj) fail(`Bhuj lossBps ${bhujAtt.lossBps} ≠ ${LOSS.bhuj}`);
const cli = await runOracle([]); // no command: prints the usage and exits 2
console.log(`  oracle CLI starts: ${cli.code === 2 && cli.out.includes("usage") ? "yes (usage, exit 2) ✓" : `✖ exit ${cli.code}`}`);
if (cli.code !== 2) fail("the oracle CLI does not start (npm ci in faultline/oracle?)");

// ---------------------------------------------------------------- 7. HBAR budget
// Measured fees (HBAR, mirror charged_tx_fee): smoke run 2026-10-26 and S7 2026-10-27 (the reference repo's docs/TESTNET-EVIDENCE.md);
// "est." = a call not made on testnet before, from the local gas report at the smoke run's ~1.1e-6 HBAR/gas.
const BUDGET: [Exclude<Role, "oracle">, string, number][] = [
  ["deployer", "1 deployBond (smoke 7.9363)", 7.9363],
  ["deployer", "1 addIssuer + grantKyc A, B (smoke 0.1397 + 0.3012 + 0.2823)", 0.7232],
  ["deployer", "2 deploy pool + trigger (smoke 2.4765 + 2.2019; D17 adds a few hundred bytes)", 4.6784],
  ["deployer", "2 initialize + TokenGrantKyc(pool) + applyRoles (smoke 0.8195 + 0.0130 + 0.3538)", 1.1863],
  ["deployer", "4 unpause as admin (est. ~60k gas)", 0.07],
  ["deployer", "6 sweepExcess + sweepDust (smoke 0.1400 + 0.0867)", 0.2267],
  ["trustee", "2 grantRole(TRUSTEE_ROLE, backup) — first tx, completes the hollow account (est. ~90k gas)", 0.1],
  ["trustee", "4 pause + veto (est. ~60k gas each)", 0.14],
  ["relayer", "1 TopicCreate (S7 0.3935)", 0.3935],
  ["relayer", "4+5 two HCS messages (S7 0.0088 each)", 0.0176],
  ["relayer", "4+5 two submits (smoke 0.1514 each)", 0.3028],
  ["relayer", "5 keeper execute (smoke 0.1570)", 0.157],
  ["relayer", "4 optional: the replay-rejection tx sent as on-chain evidence, reverts EventFinalised (est.)", 0.06],
  ["sponsor", "3 approve + fundCoupons (smoke 0.7997 + 0.0809)", 0.8806],
  ["sponsor", "6 claim ×2 (smoke 0.0511 each)", 0.1022],
  ["investorA", "3 approve + invest (smoke 0.7997 + 0.5965)", 1.3962],
  ["investorA", "6 redeem + claim (smoke 0.3600 + 0.0564)", 0.4164],
  ["investorB", "3 approve + invest (smoke 0.7997 + 0.5213)", 1.321],
  ["investorB", "6/8 redeem + claim, through the dashboard with MetaMask (smoke 0.2669 + 0.0564)", 0.3233],
];
const CONTINGENCY = 1.2;
// EVM fees are gas used × gas price: the smoke run paid 1,100 gwei-equivalent (fee / gas used, every tx); SDK fees
// (TokenGrantKyc, TopicCreate, HCS) are USD-priced and drift with HBAR/USD. Scale EVM items by today's gas price.
const SMOKE_GWEI = 1100;
const gwei = Number((await p.getFeeData()).gasPrice ?? 0n) / 1e9;
const isSdk = (what: string) => /TopicCreate|HCS messages/.test(what);
console.log(`\n7. HBAR budget (measured fees; EVM items × gas price ${gwei} / ${SMOKE_GWEI} gwei-equivalent; then ×${CONTINGENCY}; $${(await usdPerHbar()).toFixed(4)}/HBAR now)`);
const per: Record<string, number> = {};
for (const [r, what, measured] of BUDGET) {
  const h = isSdk(what) ? measured : (measured * gwei) / SMOKE_GWEI;
  per[r] = (per[r] ?? 0) + h;
  console.log(`  ${r.padEnd(13)} ${h.toFixed(4).padStart(7)}  phase ${what}`);
}
let topUp = false;
for (const r of PAYING_ROLES) {
  const est = (per[r] ?? 0) * CONTINGENCY;
  const left = (hbar[r] ?? 0) - est;
  const minLeft = r === "deployer" ? 10 : 1;
  const ok = left >= minLeft;
  if (!ok) topUp = true;
  console.log(`  ${ok ? "✓" : "⚠"} ${r.padEnd(13)} budget ${est.toFixed(2).padStart(6)} HBAR vs balance ${(hbar[r] ?? 0).toFixed(2).padStart(6)} → ${left.toFixed(2)} left${r === "deployer" ? " (owner rule: >= 10)" : " (>= 1)"}`);
}
const total = Object.values(per).reduce((a, b) => a + b, 0);
console.log(`  total ≈ ${total.toFixed(2)} HBAR (×${CONTINGENCY} = ${(total * CONTINGENCY).toFixed(2)})`);
if (topUp) console.log("  ⚠ TOP UP the ⚠ account(s) from the faucet (portal.hedera.com) before phase 1");

// ---------------------------------------------------------------- 8. timeline
const t2 = now + 5 * MIN;
const bondDates = { start: now + 120, maturity: now + BOND.maturityMin * MIN };
const sched = scheduleFor(t2, bondDates.start, bondDates.maturity);
console.log(`\n8. timeline IF phase 1 (bond) ran now and phase 2 (pool deploy) 5 min later (BOND_MATURITY_MIN ${BOND.maturityMin}):`);
printTimeline(t2, sched.s, whatIf.observedAt, bondDates);
// Latest pool deploy t with bondMaturity >= t + issuanceStartDelay + issuance + margin (scheduleFor).
const latest = bondDates.maturity - (P.issuanceStartDelay + P.issuance + P.margin) - now;
console.log(`  phase 2 must start within ${(latest / MIN).toFixed(1)} min of the bond deploy, else the bond no longer fits (new bond = another ~7.9 HBAR)`);

if (failed) {
  console.log("\nPREFLIGHT FAILED — nothing may be sent. Fix the ✖ items above.");
  process.exitCode = 1;
} else {
  const st = loadDemo();
  const baseline: Record<string, number> = {};
  for (const r of PAYING_ROLES) baseline[r] = Math.round((hbar[r] ?? 0) * 1e8);
  saveSmoke({
    build,
    token: FUSD.id,
    tokenAddress: FUSD.evm,
    rpcUrl: rpcUrl(),
    baselineTinybar: st.baselineTinybar ?? baseline,
    preflightAt: new Date().toISOString(),
    ...(process.env.CHECK_KEYS === "1" ? { keysCheckedAt: new Date().toISOString() } : {}),
  });
  console.log(`\nPREFLIGHT OK${process.env.CHECK_KEYS === "1" ? "" : " (except the key check: CHECK_KEYS=1)"} — state in out/demo-state.json`);
}
