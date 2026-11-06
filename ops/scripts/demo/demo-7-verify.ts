// Full demo phase 7 — source verification of the demo's FaultlinePool and FaultlineTrigger for HashScan.
//
// HOW (researched 2026-10-27): HashScan's own verification form is disabled; Hedera verification goes through Sourcify,
// which supports testnet chainId 296 natively, and HashScan shows the source and badge once Sourcify has it
// (docs.hedera.com/evm/tutorials/intermediate/verify-hashscan; docs.hedera.com/evm/quickstart/deploy-with-hardhat uses
// @nomicfoundation/hardhat-verify with `sourcify: { enabled: true }` on Hardhat 3). The main repo is Hardhat 2 and this
// script adds no dependency: it calls Sourcify's v2 API (docs.sourcify.dev/docs/api) directly with the main repo's
// compiler input from artifacts/build-info, which is exactly what the Hardhat plugin sends:
//   POST https://sourcify.dev/server/v2/verify/296/<address>  { stdJsonInput, compilerVersion, contractIdentifier,
//        creationTransactionHash }  → { verificationId }
//   GET  https://sourcify.dev/server/v2/verify/<verificationId>  until the job completes
//   GET  https://sourcify.dev/server/v2/contract/296/<address>   → match / creationMatch / runtimeMatch
// No Hedera transaction and no HBAR. EXECUTE=1 is still required because it PUBLISHES the full Solidity source of the
// main repo's contracts/ (and the test mocks in the same compiler input) to Sourcify; the owner approved that
// (2026-10-27). Before anything is sent, the PUBLICATION GATE below lists every file in the compiler input and refuses
// to send if any file contains key material, a keystore reference, a local path, an e-mail address or the owner's
// name, if a 32-byte hex literal in our own files is not a known public constant, or if an OpenZeppelin file differs
// from the installed package (so only unmodified upstream code is published under its name).
import fs from "node:fs";
import path from "node:path";
import { keccak256 } from "ethers";
import { ROLES } from "../lib/common.js";
import { EXECUTE, FAULTLINE, artifact, buildInfo, loadDemo, report, saveSmoke } from "./lib.js";

const SOURCIFY = "https://sourcify.dev/server";
const st = loadDemo();

const dir = path.join(FAULTLINE, "artifacts", "build-info");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
if (files.length !== 1) throw new Error(`expected one build-info file in ${dir}, found ${files.length} — run \`npm run compile\` from a clean tree`);
const bi = JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf8")) as { solcLongVersion: string; input: { sources: Record<string, { content: string }>; settings: unknown } };
const build = buildInfo();
const recorded = st.build as typeof build | undefined;
const sameBuild = recorded && recorded.poolInitcodeKeccak === build.poolInitcodeKeccak && recorded.triggerInitcodeKeccak === build.triggerInitcodeKeccak;
console.log(`compiler ${bi.solcLongVersion}; build-info ${files[0]} with ${Object.keys(bi.input.sources).length} sources; artifacts ${sameBuild ? "== the deployed build ✓" : "≠ the deployed build ✖"}`);
if (!sameBuild) throw new Error("the local artifacts are not the build that was deployed (check out the recorded commit and recompile) — nothing sent");

// ------------------------------------------------------------ publication gate
// 32-byte literals allowed in our own files: the ATS role ids (public, IAtsBond.sol) and MockBond's partition id 1.
const KNOWN_HEX32 = new Set([...Object.values(ROLES), "0x" + "00".repeat(31) + "01"].map((x) => x.toLowerCase()));
const RULES: [string, RegExp, "any" | "own"][] = [
  ["key material / keystore wording", /PRIVATE_KEY|keystore|mnemonic|seed phrase|BEGIN [A-Z ]*PRIVATE/i, "own"],
  ["local path", /\/Users\/|\/home\/|[A-Z]:\\/, "any"],
  ["e-mail address", /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, "any"],
  ["owner's name", /tushar|chouhan/i, "any"],
];
console.log("\npublication gate — every file the compiler input publishes:");
const gate: string[] = [];
const settings = JSON.stringify(bi.input.settings);
if (/\/Users\/|\/home\//.test(settings)) gate.push("compiler settings contain a local path");
for (const [name, src] of Object.entries(bi.input.sources)) {
  const own = !name.startsWith("@openzeppelin/");
  const issues: string[] = [];
  for (const [label, re, scope] of RULES) if ((scope === "any" || own) && re.test(src.content)) issues.push(label);
  if (own) {
    for (const m of src.content.matchAll(/0x[0-9a-fA-F]{64}/g)) if (!KNOWN_HEX32.has(m[0].toLowerCase())) issues.push(`unknown 32-byte literal ${m[0].slice(0, 12)}…`);
  } else {
    const installed = path.join(FAULTLINE, "node_modules", name);
    if (!fs.existsSync(installed) || fs.readFileSync(installed, "utf8") !== src.content) issues.push("differs from the installed OpenZeppelin package");
  }
  console.log(`  ${issues.length ? "✖" : "✓"} ${own ? "own " : "OZ  "} ${name} (${src.content.length} bytes)${issues.length ? ` — ${issues.join("; ")}` : ""}`);
  for (const i of issues) gate.push(`${name}: ${i}`);
}
console.log(`  ${Object.keys(bi.input.sources).length} files; settings ${settings}`);
if (gate.length) throw new Error(`publication gate failed (${gate.length}) — nothing sent:\n  ${gate.join("\n  ")}`);
console.log("  gate passed: no key material, keystore reference, local path, e-mail or personal name; own 32-byte literals are the ATS role ids; OpenZeppelin files are unmodified");

const targets = [
  { name: "FaultlinePool" as const, address: st.pool as string | undefined, creationTx: st.poolDeployTx as string | undefined },
  { name: "FaultlineTrigger" as const, address: st.trigger as string | undefined, creationTx: st.triggerDeployTx as string | undefined },
];
type Lookup = { match: string | null; creationMatch: string | null; runtimeMatch: string | null; verifiedAt?: string };
const lookup = async (address: string) => {
  const r = await fetch(`${SOURCIFY}/v2/contract/296/${address}`, { headers: { accept: "application/json" } });
  return r.status === 404 ? undefined : ((await r.json()) as Lookup);
};

const results: Record<string, unknown> = {};
for (const t of targets) {
  const identifier = `contracts/${t.name}.sol:${t.name}`;
  console.log(`\n${t.name} ${t.address ?? "(not deployed yet)"}: ${identifier}, init code keccak ${keccak256(artifact(t.name).bytecode)}`);
  if (!t.address || !t.creationTx) { console.log("  deferred: deploy first (phase 2)"); continue; }
  const before = await lookup(t.address);
  console.log(`  Sourcify now: ${before ? `match ${before.match}, creation ${before.creationMatch}, runtime ${before.runtimeMatch}` : "not verified"}`);
  if (before?.match) { results[t.name] = before; continue; }
  console.log(`  plan: POST ${SOURCIFY}/v2/verify/296/${t.address} { stdJsonInput (${Object.keys(bi.input.sources).length} sources), compilerVersion ${bi.solcLongVersion}, contractIdentifier ${identifier}, creationTransactionHash ${t.creationTx} }`);
  if (!EXECUTE) { console.log("  (dry run — nothing published; EXECUTE=1 after the owner's OK publishes the source to Sourcify)"); continue; }
  const res = await fetch(`${SOURCIFY}/v2/verify/296/${t.address}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stdJsonInput: bi.input, compilerVersion: bi.solcLongVersion, contractIdentifier: identifier, creationTransactionHash: t.creationTx }),
  });
  const body = (await res.json()) as { verificationId?: string; message?: string };
  if (!body.verificationId) throw new Error(`Sourcify refused ${t.name}: HTTP ${res.status} ${JSON.stringify(body)}`);
  console.log(`  job ${body.verificationId}`);
  let job: { isJobCompleted: boolean; error?: unknown; contract?: Lookup } | undefined;
  for (let i = 0; i < 60 && !job?.isJobCompleted; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    job = (await (await fetch(`${SOURCIFY}/v2/verify/${body.verificationId}`)).json()) as typeof job;
  }
  if (!job?.isJobCompleted) throw new Error(`${t.name}: Sourcify job not finished after 5 min`);
  if (job.error) throw new Error(`${t.name}: Sourcify job failed: ${JSON.stringify(job.error)}`);
  results[t.name] = { ...(await lookup(t.address)), verificationId: body.verificationId };
}

const done = targets.filter((t) => t.address);
if (done.length) {
  const ok = report("verification", done.map((t) => {
    const r = results[t.name] as Lookup | undefined;
    return [`${t.name}: Sourcify ${r?.match ?? "none"} (creation ${r?.creationMatch ?? "-"}, runtime ${r?.runtimeMatch ?? "-"}); HashScan https://hashscan.io/testnet/contract/${t.address}`, Boolean(r?.match)] as [string, boolean];
  }));
  if (ok) saveSmoke({ sourcify: results, sourcifyVerifiedAt: new Date().toISOString() });
}
