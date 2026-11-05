// Local oracle end-to-end (HANDOVER §10 step 6). MOCK-TESTED, LOCAL ONLY: Hardhat node, MockBond/MockUSD/MockHTS, the
// file mock of HCS. The oracle runs exactly as an operator would run it: the CLI in oracle/ as a child process
// (`npx tsx src/cli.ts …`), with Hardhat test accounts #3 (oracle) and #4 (relayer) — allowed on chainId 31337 only.
//   npm run oracle:e2e:local     # starts a node on :8545 if none is running, runs this, stops the node it started
//   ORACLE_E2E_LIVE=1 npm run oracle:e2e:local   # also one `watch --once` cycle against the LIVE USGS API
// Scenarios:
//   1. Bhuj (REAL record usp000a8ds, replay --offline): attestation + HCS line + submit; a second replay is a no-op;
//      48 h window; keeper executes → L = 7000, sponsor credited floor(U*7000/10000); ledger == chain.
//   2. D15 (SYNTHETIC): synthetic-kutch-3 pending, then a revision outside the box → advisory on HCS, nothing
//      submitted; a repeat does not publish a second advisory; the trustee vetoes.
//   3. D8 (SYNTHETIC): synthetic-kutch-2 pending, then merged under a new preferred id with M7.6 → revision nonce 2 on
//      the ORIGINAL eventId; the new id never gets its own event; the trustee vetoes.
//   4. SEC-08: the ledger file is deleted, the merged record is replayed again → still the original (Vetoed) event,
//      no second eventId, nothing published (the oracle checks every associated id on chain).
import fs from "node:fs";
import path from "node:path";
import { ethers } from "hardhat";
import { dataHash, eventIdOf, observedAtOf, type UsgsFeature } from "../shared/ts/attestation";
import { canonicalize } from "../shared/ts/jcs";
import { decodeMessage, recoverMessageSigner, HCS_MAX_BYTES, type AdvisoryMessage, type AttestationMessage } from "../shared/ts/hcsMessage";
import { BHUJ_FILE, loadFeature } from "./lib/fixtures";
import { LOCAL, TICKETS, latest, travelTo, usd } from "./lib/e2e";
import { ORACLE_DIR, deployOracleWorld, runOracleCli } from "./lib/oracle-local";

const DAY = 86_400n;
const STATUS = ["None", "Pending", "Vetoed", "Executed", "Superseded"];

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`oracle e2e assertion failed: ${msg}`);
}

const oracle = runOracleCli;

type Line = { topicId: string; sequenceNumber: number; consensusTimestamp: string; message: string };
const hcsLines = (topic: string): Line[] => {
  const f = path.join(ORACLE_DIR, ".hcs-mock", `${topic}.jsonl`);
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Line) : [];
};
const ledgerOf = (trigger: string) =>
  JSON.parse(fs.readFileSync(path.join(ORACLE_DIR, "out", "local", `ledger-31337-${trigger.toLowerCase()}.json`), "utf8")) as {
    events: Record<string, { usgsIds: string[]; chainStatus: string; chainNonce: number; publications: { nonce: number; hcs?: { sequenceNumber: string }; tx?: { hash: string; status: string } }[]; advisories: { reason: string; dataHash: string | null; hcs?: { sequenceNumber: string } }[] }>;
    idIndex: Record<string, string>;
  };
const fixture = (f: string) => JSON.parse(fs.readFileSync(path.join(ORACLE_DIR, "fixtures", f), "utf8")) as UsgsFeature;

async function main() {
  const log = (l: string) => console.log(l);
  const { w, trigger, topicId } = await deployOracleWorld(log);
  const t = w.trigger;
  const record = async (id: string) => {
    const r = await t.getEventRecord(id);
    return { status: STATUS[Number(r.status)]!, nonce: r.nonce, lossBps: r.lossBps, dataHash: r.dataHash };
  };

  // All three events (Bhuj at riskStart + 10 d, synthetic 2 / 3 at + 30 / + 35 d) must be in the past.
  await travelTo(w.s.riskStart + 36n * DAY);
  log(`\nchain time moved to riskStart + 36 days (${await latest()}); every replayed event is in the past`);

  oracle(["verify-config"]);

  // ------------------------------------------------------------ 1. Bhuj
  console.log("\n=== 1. Bhuj usp000a8ds (REAL USGS record, replay --offline) ===");
  const bhuj = loadFeature(BHUJ_FILE);
  const bhujId = eventIdOf("usp000a8ds");
  oracle(["replay", "--usgs-event", "usp000a8ds", "--offline"]);
  let rec = await record(bhujId);
  assert(rec.status === "Pending" && rec.nonce === 1n && rec.lossBps === 7000n, `Bhuj pending nonce 1 at 7000 bps (got ${rec.status} ${rec.nonce} ${rec.lossBps})`);
  assert(rec.dataHash === dataHash(bhuj), "on-chain dataHash == dataHash of the real record");
  let lines = hcsLines(topicId);
  assert(lines.length === 1, `one HCS line (got ${lines.length})`);
  const line = lines[0]!;
  const msg = decodeMessage(line.message) as AttestationMessage;
  assert(Buffer.byteLength(line.message) <= HCS_MAX_BYTES, "HCS message fits one 1024-byte chunk");
  assert(line.message === canonicalize(JSON.parse(line.message)), "HCS bytes are JCS-canonical");
  assert(JSON.stringify(Object.keys(msg).sort()) === JSON.stringify(["attestation", "chainId", "kind", "mode", "signature", "timeOffsetSec", "trigger", "usgsId", "v"]), "§6.5 keys");
  assert(msg.kind === "faultline.attestation" && msg.v === 1 && msg.chainId === 31337 && msg.trigger === trigger && msg.usgsId === "usp000a8ds", "§6.5 header fields");
  assert(msg.mode === "replay" && msg.timeOffsetSec === w.terms.timeOffsetSec, "mode + timeOffsetSec from the terms (D14)");
  assert(msg.attestation.eventId === bhujId && msg.attestation.nonce === 1 && msg.attestation.lossBps === 7000 && msg.attestation.observedAt === observedAtOf(bhuj, w.terms), "attestation fields == chain");
  assert(recoverMessageSigner(msg).toLowerCase() === w.oracle.address.toLowerCase(), "in-payload EIP-712 signature recovers to the oracle (D16)");
  let ledger = ledgerOf(trigger);
  let entry = ledger.events[bhujId]!;
  const bhujIds = bhuj.properties.ids.split(",").filter(Boolean);
  assert(entry && bhujIds.every((i) => entry.usgsIds.includes(i) && ledger.idIndex[i] === bhujId), "ledger maps all 7 Bhuj ids to the eventId (D8)");
  assert(entry.publications.length === 1 && entry.publications[0]!.hcs?.sequenceNumber === "1" && entry.publications[0]!.tx?.status === "mined", "ledger: nonce 1 published as seq 1 and mined");
  log(`\nHCS line: ${JSON.stringify(line)}`);
  log(`ledger entry: ${JSON.stringify({ eventId: bhujId, chainStatus: entry.chainStatus, chainNonce: entry.chainNonce, usgsIds: entry.usgsIds, publication: { nonce: 1, hcsSeq: entry.publications[0]!.hcs?.sequenceNumber, tx: entry.publications[0]!.tx } })}`);

  oracle(["replay", "--usgs-event", "usp000a8ds", "--offline"]); // same record again: nothing new
  assert(hcsLines(topicId).length === 1 && (await record(bhujId)).nonce === 1n, "a repeated replay publishes and submits nothing");

  const ends = await t.windowEndsAt(bhujId);
  await travelTo(ends + 1n);
  log(`\nchain time moved past the ${LOCAL.challengeWindow / 3600n} h window (windowEndsAt ${ends})`);
  oracle(["keeper", "--once"]);
  rec = await record(bhujId);
  const L = await w.pool.appliedLossBps();
  const U = await w.pool.unitsIssued();
  const credit = await w.pool.sponsorCredited();
  assert(rec.status === "Executed" && L === 7000n, `Bhuj executed, L = 7000 (got ${rec.status}, ${L})`);
  assert(U === TICKETS.A + TICKETS.B + TICKETS.C && credit === (U * 7000n) / 10000n && (await w.pool.claimable(w.sponsor.address)) === credit, "sponsor credited floor(U*7000/10000)");
  oracle(["status", "usp000a8ds"]);
  assert(ledgerOf(trigger).events[bhujId]!.chainStatus === "Executed", "ledger status == chain (Executed)");
  log(`\nresult: L ${L} bps, U ${usd(U)} USD, sponsor credited ${usd(credit)} USD`);
  if (process.env.ORACLE_E2E_LIVE === "1") {
    // Opt-in (network): one watch cycle against the LIVE USGS API. The box search over the risk period, shifted back by
    // timeOffsetSec (D10), finds the real Bhuj record; it is already Executed on chain, so nothing new is sent.
    const before = hcsLines(topicId).length;
    const out = oracle(["watch", "--once"]);
    assert(/usp000a8ds → finalised/.test(out) && hcsLines(topicId).length === before, "live watch: Bhuj found by the box search and left alone (finalised)");
  }

  // ------------------------------------------------------------ 2. D15
  console.log("\n=== 2. D15: a pending event revised OUT of the box (SYNTHETIC records) ===");
  const k3 = eventIdOf("synthetic-kutch-3");
  oracle(["replay", "--fixture", "synthetic-kutch-3.geojson"]);
  assert((await record(k3)).status === "Pending", "synthetic-kutch-3 pending");
  const before = hcsLines(topicId).length;
  oracle(["replay", "--fixture", "synthetic-kutch-3-revised-outside-box.geojson"]);
  lines = hcsLines(topicId);
  assert(lines.length === before + 1, "one advisory line");
  const adv = decodeMessage(lines.at(-1)!.message) as AdvisoryMessage;
  const revised = fixture("synthetic-kutch-3-revised-outside-box.geojson");
  assert(adv.kind === "faultline.advisory" && adv.reason === "box" && adv.eventId === k3 && adv.usgsId === "synthetic-kutch-3" && adv.action === "trustee should veto", "advisory fields (D15)");
  assert(adv.dataHash === dataHash(revised), "advisory carries the dataHash of the NEW record");
  assert(recoverMessageSigner(adv).toLowerCase() === w.oracle.address.toLowerCase(), "advisory EIP-191 signature recovers to the oracle (D16)");
  rec = await record(k3);
  assert(rec.status === "Pending" && rec.nonce === 1n, "nothing submitted: still Pending at nonce 1");
  oracle(["replay", "--fixture", "synthetic-kutch-3-revised-outside-box.geojson"]);
  assert(hcsLines(topicId).length === before + 1, "the same advisory is not published twice");
  await t.connect(w.trustee).veto(k3);
  assert((await record(k3)).status === "Vetoed", "trustee vetoed after the advisory");
  log(`\nadvisory line: ${lines.at(-1)!.message}`);

  // ------------------------------------------------------------ 3. D8 merge
  console.log("\n=== 3. D8: the same event under a new preferred id (SYNTHETIC records) ===");
  const k2 = eventIdOf("synthetic-kutch-2");
  oracle(["replay", "--fixture", "synthetic-kutch-2.geojson"]);
  assert((await record(k2)).lossBps === 5000n, "synthetic-kutch-2 pending at 5000 bps");
  oracle(["replay", "--fixture", "synthetic-kutch-2-merged.geojson"]);
  rec = await record(k2);
  assert(rec.status === "Pending" && rec.nonce === 2n && rec.lossBps === 6000n, `revision nonce 2 at 6000 bps on the ORIGINAL eventId (got ${rec.nonce}, ${rec.lossBps})`);
  assert((await record(eventIdOf("synthetic-kutch-2b"))).status === "None", "the new preferred id never became its own event");
  ledger = ledgerOf(trigger);
  assert(ledger.idIndex["synthetic-kutch-2b"] === k2 && ledger.idIndex["synthetic-kutch-2"] === k2, "ledger maps both ids to the original eventId");
  const last = decodeMessage(hcsLines(topicId).at(-1)!.message) as AttestationMessage;
  assert(last.attestation.eventId === k2 && last.attestation.nonce === 2 && last.usgsId === "synthetic-kutch-2b", "the revision's HCS line: original eventId, nonce 2, new preferred id");
  await t.connect(w.trustee).veto(k2);

  // ------------------------------------------------------------ 4. SEC-08: D8 survives a lost ledger
  console.log("\n=== 4. SEC-08: the ledger file is lost; the merged record must still map to the ORIGINAL event ===");
  const ledgerFile = path.join(ORACLE_DIR, "out", "local", `ledger-31337-${trigger.toLowerCase()}.json`);
  fs.rmSync(ledgerFile);
  const linesBefore = hcsLines(topicId).length;
  oracle(["replay", "--fixture", "synthetic-kutch-2-merged.geojson"]);
  assert((await record(eventIdOf("synthetic-kutch-2b"))).status === "None", "no second on-chain event for the new preferred id");
  assert((await record(k2)).status === "Vetoed" && hcsLines(topicId).length === linesBefore, "the original event stays Vetoed; nothing published");

  assert((await w.pool.appliedLossBps()) === 7000n && (await t.pendingCount()) === 0n, "end: L still 7000, nothing pending");
  console.log(`\n=== oracle e2e passed (mock-tested, local only): L ${await w.pool.appliedLossBps()} bps, sponsor credited ${usd(await w.pool.sponsorCredited())} USD, ${hcsLines(topicId).length} HCS lines on ${topicId} ===`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
