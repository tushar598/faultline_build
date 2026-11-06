// S7 preflight (no transaction): keystore names; with CHECK_KEYS=1 the relayer, trustee and oracle keys must derive to
// their documented addresses (only addresses printed); relayer/trustee account state; the sample message offline
// (size, in-payload signature recovers to the oracle); fee estimates.
import { execFileSync } from "node:child_process";
import { ROOT, signerFor } from "../lib/common.js";
import { mirror, usdPerHbar } from "../lib/hedera.js";
import { FEE_USD, ORACLE, RELAYER, TRUSTEE, hcsMessage, sampleMessage } from "./s7.js";

let failed = false;
const names = execFileSync("npx", ["hardhat", "keystore", "list"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split(/\s+/);
for (const a of [RELAYER, TRUSTEE, ORACLE]) {
  const has = names.includes(a.keyName);
  console.log(`keystore has ${a.keyName}: ${has ? "yes" : "NO"}`);
  failed ||= !has;
}
if (process.env.CHECK_KEYS === "1") {
  for (const a of [RELAYER, TRUSTEE, ORACLE]) {
    const w = await signerFor(a.network);
    const ok = w.address.toLowerCase() === a.evm.toLowerCase();
    console.log(`  ${a.keyName} → ${w.address} ${ok ? "✓" : `✖ expected ${a.evm}`}`);
    failed ||= !ok;
  }
} else console.log("key → address check skipped (needs the keystore password): run once with CHECK_KEYS=1");

for (const [label, id] of [["relayer", RELAYER.id], ["trustee", TRUSTEE.id]] as const) {
  const m = await mirror<{ account: string; evm_address: string; balance: { balance: number }; key: { _type: string } | null }>(`/api/v1/accounts/${id}`);
  console.log(`${label} ${m?.account} ${m?.evm_address}: ${((m?.balance.balance ?? 0) / 1e8).toFixed(4)} HBAR, ${m?.key ? `complete (${m.key._type})` : "HOLLOW"}`);
}

const { msg, bytes } = sampleMessage();
const signer = hcsMessage().recoverMessageSigner(msg);
console.log(`\nsample message: the smoke run's Bhuj attestation (nonce ${msg.attestation.nonce}, ${msg.attestation.lossBps} bps), ${bytes.length} bytes (≤ 1024), mode ${msg.mode}`);
console.log(`  in-payload EIP-712 signature recovers to ${signer} ${signer.toLowerCase() === ORACLE.evm.toLowerCase() ? "== oracle ✓" : "✖ NOT the oracle"}`);
failed ||= signer.toLowerCase() !== ORACLE.evm.toLowerCase();

const usd = await usdPerHbar();
const h = (x: number) => (x / usd).toFixed(5);
console.log(`\nfee estimate at $${usd.toFixed(4)}/HBAR (base fees; S5 measured TopicCreate at 2× base): TopicCreate ≈ ${h(FEE_USD.ConsensusCreateTopic)}–${h(2 * FEE_USD.ConsensusCreateTopic)}, submit ≈ ${h(FEE_USD.ConsensusSubmitMessage)} (S5: 636 B = 0.00684), failed submit ≈ 0.002 (S5), TopicUpdate ×2 ≈ ${h(2 * FEE_USD.ConsensusUpdateTopic)} → total ≈ 0.27–0.29 HBAR, all paid by the relayer`);
if (failed) {
  console.log("\nPREFLIGHT FAILED — nothing may be sent.");
  process.exitCode = 1;
} else console.log(`\nPREFLIGHT OK${process.env.CHECK_KEYS === "1" ? "" : " (except the key check: CHECK_KEYS=1)"}`);
