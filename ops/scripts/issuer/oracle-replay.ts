// Issuer helper: the oracle step for a bond launched from the web issuer page (/issuer) on Hedera testnet. A browser wallet
// cannot do it: the oracle signs an EIP-712 attestation with its own key, the relayer publishes it to the bond's HCS topic
// (TopicSubmitMessage is a native transaction) and sends trigger.submit. Everything after that (trustee pause and veto,
// admin unpause, Execute, redeem, claim, sweeps) is a plain wallet call on the dashboard. Written 2026-11-06, NOT
// testnet-verified; the same oracle path ran in demo phases 4 and 5.
//
//   pbpaste > out/issuer/deployment.json     # the "Deployment config entry" the issuer page shows after the audit
//   [DEPLOYMENT=out/issuer/deployment.json] [EVENT=bhuj|synthetic] npx hardhat run --network testnetRead scripts/issuer/oracle-replay.ts
//   EXECUTE=1 …                               # owner only: the oracle + relayer keys from the keystore, in the child only
//
// EVENT=bhuj (default): the REAL 2001 Bhuj record usp000a8ds, fetched live from USGS. EVENT=synthetic: the labelled
// SYNTHETIC fixture (time = Bhuj + 60 s), for the pause / veto flow. Both need replay terms whose offset places Bhuj in the
// risk period (the issuer page's "Place Bhuj" button). Files: out/issuer/oracle-<trigger>/ (config, terms, oracle ledger;
// public data only). The oracle's own startup gate re-checks chainId, termsHash, type hash and D14 before it signs.
import fs from "node:fs";
import path from "node:path";
import { Contract, getAddress } from "ethers";
import { EXECUTE, ROOT, explain, rpcUrl } from "../lib/common.js";
import {
  ACCOUNTS, BHUJ_ID, SYNTHETIC_FIXTURE, bhujFixture, SYNTHETIC_ID, artifact, eventually, iso, latestTs, ledgerEntry, oracleKeys, provider, report, runOracle, sharedTs,
  syntheticFixture, useFaultlineErrors, verifyHcsAttestation, waitForBlockTime,
} from "../demo/lib.js";
import { saveResult } from "./lib.js";

const STATUS = ["None", "Pending", "Vetoed", "Executed", "Superseded"];
const MAX_WAIT_SEC = Number(process.env.MAX_WAIT_SEC ?? "900");
const EVENT = (process.env.EVENT ?? "bhuj").toLowerCase();
if (EVENT !== "bhuj" && EVENT !== "synthetic") throw new Error(`EVENT must be bhuj or synthetic (got ${EVENT})`);
const usgsId = EVENT === "bhuj" ? BHUJ_ID : SYNTHETIC_ID;
const shared = sharedTs();
useFaultlineErrors();

// ------------------------------------------------------------ the deployment entry from the issuer page
const file = path.resolve(ROOT, process.env.DEPLOYMENT ?? path.join("out", "issuer", "deployment.json"));
if (!fs.existsSync(file)) throw new Error(`${file} not found: copy the issuer page's "Deployment config entry" into it (pbpaste > out/issuer/deployment.json)`);
type Entry = { chainId: number; trigger: string; topicId: string | null; termsHash: string; terms: Parameters<typeof shared.termsHash>[0]; fromBlock: number; label?: string };
const d = JSON.parse(fs.readFileSync(file, "utf8")) as Entry;
if (d.chainId !== 296) throw new Error(`the entry is for chain ${d.chainId}, not Hedera testnet (296)`);
if (!d.topicId || !/^0\.0\.\d+$/.test(d.topicId)) throw new Error("the entry has no HCS topic id: finish the topic step on the issuer page first");
if (d.terms?.mode !== "replay") throw new Error("the bond's terms are live: this helper replays a historical record and needs replay terms (D10, D14)");
const trigger = getAddress(d.trigger);
console.log(`bond ${d.label ?? "(no label)"}: trigger ${trigger}, topic ${d.topicId}, replay offset ${d.terms.timeOffsetSec} s`);
console.log(`event: ${EVENT === "bhuj" ? `REAL USGS record ${BHUJ_ID} (2001 Bhuj; live from USGS, else the saved real record)` : `SYNTHETIC fixture ${SYNTHETIC_FIXTURE} (not a real event)`}, eventId ${shared.eventIdOf(usgsId)}`);

const p = await provider();
const t = new Contract(trigger, artifact("FaultlineTrigger").abi as never, p);
const onChainHash = String(await t.termsHash());
const onChainOracle = getAddress(String(await t.oracle()));
const ok = report("entry and trigger", [
  [`termsHash(entry terms) == entry termsHash`, shared.termsHash(d.terms) === d.termsHash],
  [`entry termsHash == trigger.termsHash() ${onChainHash.slice(0, 10)}…`, d.termsHash.toLowerCase() === onChainHash.toLowerCase()],
  [`trigger.oracle() ${onChainOracle} == flhOracle ${ACCOUNTS.oracle.evm}`, onChainOracle === getAddress(ACCOUNTS.oracle.evm)],
]);
if (!ok) throw new Error("the entry does not match the trigger, or the oracle is not flhOracle — nothing sent");

// ------------------------------------------------------------ oracle config for this bond (public data)
const dir = path.join(ROOT, "out", "issuer", `oracle-${trigger.toLowerCase()}`);
const stateDir = path.join(dir, "oracle-state");
const configFile = path.join(dir, "oracle.testnet.json");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "terms.json"), JSON.stringify(d.terms, null, 2) + "\n");
fs.writeFileSync(
  configFile,
  JSON.stringify(
    {
      rpcUrl: rpcUrl(),
      chainId: 296,
      trigger,
      termsFile: "terms.json",
      hcs: { mode: "real", topicId: d.topicId, network: "testnet", payerAccountId: ACCOUNTS.relayer.id },
      pollIntervalSec: 60,
      pendingPollSec: 10,
      attestationTtlSec: 3600,
      stateDir: "oracle-state",
      fromBlock: d.fromBlock,
      evm: { transport: "relay" },
    },
    null,
    2,
  ) + "\n",
);

// ------------------------------------------------------------ the record, the rule and the timing
const now = await latestTs(p);
let feature: Parameters<typeof shared.buildAttestation>[0]["feature"];
// Bhuj: the live USGS record, 3 tries; if USGS cannot be reached (a slow network timed out on 2026-11-06), the saved REAL
// record oracle/fixtures/real-usgs-usp000a8ds-detail.geojson, whose dataHash equals the live one (demo preflight check
// 6), and the oracle CLI then runs with --offline on that same file. USGS_OFFLINE=1 forces it.
let offline = process.env.USGS_OFFLINE === "1";
if (EVENT === "bhuj") {
  for (let i = 1; i <= 3 && !offline && !feature!; i++) {
    try {
      const res = await fetch(`https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=${BHUJ_ID}&format=geojson`, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      feature = (await res.json()) as typeof feature;
    } catch (e) {
      console.log(`  USGS try ${i}/3 failed: ${(e as Error).message}${(e as { cause?: { code?: string } }).cause?.code ? ` (${(e as { cause: { code: string } }).cause.code})` : ""}`);
      if (i < 3) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (!feature!) {
    offline = true;
    feature = bhujFixture() as typeof feature;
    console.log(`  using the saved REAL USGS record (oracle/fixtures/real-usgs-${BHUJ_ID}-detail.geojson); the oracle runs with --offline`);
  }
} else {
  feature = syntheticFixture() as typeof feature;
}
const att = shared.buildAttestation({ feature, terms: d.terms, chainId: 296n, nonce: 1n, deadline: BigInt(now + 3600), nowSec: now });
const observedAt = Number(att.observedAt);
const deadline = Number(await t.submissionDeadline());
const eventId = shared.eventIdOf(usgsId);
const status = async () => STATUS[Number((await t.getEventRecord(eventId)).status)];
console.log(`\n  rule → lossBps ${att.lossBps}; replayed observedAt ${iso(observedAt)} (${observedAt - now} s from chain time ${iso(now)})`);
console.log(`  submissionDeadline ${iso(deadline)}; trigger paused ${await t.paused()}; event status ${await status()}`);
if (att.lossBps === 0n) console.log("  ✖ loss 0: the record is outside the terms (box, depth, magnitude type or floor); the oracle will not submit");

if (!EXECUTE) {
  let sim = "OK";
  try {
    await t.submit.staticCall(att, "0x" + "00".repeat(65), { from: ACCOUNTS.relayer.evm });
  } catch (e) {
    sim = explain(e);
  }
  console.log(`  submit with a dummy signature simulates to: ${sim} (expected InvalidSignature once observedAt has passed)`);
  await runOracle(["status", usgsId], undefined, undefined, configFile);
  console.log(`\n(dry run — EXECUTE=1 waits for observedAt (at most ${MAX_WAIT_SEC} s), then runs the oracle with the oracle + relayer keys)`);
  process.exit(0);
}

// ------------------------------------------------------------ EXECUTE
let s = await status();
if (s === "None") {
  if (await t.paused()) throw new Error("trigger is paused — nothing sent");
  if (!(await waitForBlockTime(p, observedAt + 3, "the replayed observedAt", MAX_WAIT_SEC))) throw new Error("observedAt too far away — nothing sent (run again later)");
  if ((await latestTs(p)) > deadline) throw new Error("past submissionDeadline — nothing sent");
  const args = EVENT === "bhuj" ? ["replay", "--usgs-event", BHUJ_ID, ...(offline ? ["--offline"] : [])] : ["replay", "--fixture", SYNTHETIC_FIXTURE];
  const r = await runOracle(args, await oracleKeys(), undefined, configFile);
  if (r.code !== 0 || !/→ submit-new/.test(r.out)) throw new Error(`oracle replay did not submit (exit ${r.code}) — stop and report`);
  s = await eventually(status, (v) => v === "Pending");
} else {
  console.log(`\nevent already ${s}: the oracle is not run again`);
}

const pub = ledgerEntry(trigger, eventId, stateDir)?.publications.find((x) => x.nonce === 1);
if (pub?.hcs) {
  const hcs = await verifyHcsAttestation({ topicId: d.topicId, seq: pub.hcs.sequenceNumber, trigger, terms: d.terms, publication: pub, usgsId });
  if (!report("HCS message (mirror node)", hcs.checks)) process.exitCode = 1;
  const saved = saveResult(`oracle-${EVENT}-${trigger.toLowerCase()}`, { trigger, topicId: d.topicId, usgsId, eventId, lossBps: String(att.lossBps), submitTx: pub.tx?.hash, hcsSeq: pub.hcs.sequenceNumber, hcsConsensusTimestamp: hcs.consensusTimestamp, status: await status() });
  console.log(`  saved ${saved}`);
}
console.log(`\nevent ${eventId} is ${await status()}; window ${await t.windowRemaining(eventId)} s left.`);
console.log(EVENT === "synthetic" ? "Next, in the browser (/trustee, trustee wallet): Pause, then Veto event; admin wallet: Unpause." : "Next, in the browser (/trustee, any wallet): Execute once the window is complete.");
