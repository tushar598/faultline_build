// Full demo phase 5 — Flow B: the REAL 2001 Bhuj record usp000a8ds, fetched LIVE from USGS by the oracle, replayed
// into the risk period (replay terms, D10/D14), attested, executed by the oracle's keeper (faultline ARCHITECTURE §4, §6).
//   1. hard stops: Flow A verified, trigger not paused, latest block <= submissionDeadline, >= Bhuj's replayed observedAt
//   2. oracle replay --usgs-event usp000a8ds (live fetch) → rule (7000 bps) → sign + gate → simulate → HCS → submit
//   3. HCS read-back from the mirror node (bytes, payer relayer, signature oracle, usgsId)
//   4. wait out the 120 s window (effective time; demo-only)
//   5. oracle keeper --once (relayer key only) → execute
//   6. assert L == 7000, sponsor credited floor(500 × 7000 / 10000) = 350, effective principal A 90 / B 60, ATS
//      balances unchanged, Bhuj Executed, the SYNTHETIC event still Vetoed, pendingCount 0
// Resumable: a Pending event skips step 2; an Executed one skips to 6.
import { explain, signerFor } from "../lib/common.js";
import {
  ACCOUNTS, BHUJ_ID, EXECUTE, LOSS, SYNTHETIC_ID, TICKET, TOTAL_UNITS, USD, balances, bondAt, eventually, iso, latestTs, ledgerEntry, loadDemo, oracleKeys,
  poolAt, printHbar, printInvariants, provider, report, runOracle, saveSmoke, sharedTs, triggerAt, useFaultlineErrors, usd, verifyHcsAttestation, waitForBlockTime,
} from "./lib.js";

const STATUS = ["None", "Pending", "Vetoed", "Executed", "Superseded"];
const MAX_WAIT_SEC = Number(process.env.MAX_WAIT_SEC ?? "900");
const shared = sharedTs();
useFaultlineErrors();

const p = await provider();
const start = await balances();
const st = loadDemo();
const eventId = shared.eventIdOf(BHUJ_ID);
console.log(`Flow B — REAL USGS record ${BHUJ_ID} (2001 Bhuj, M7.7 mwc), fetched live, replayed (D10); eventId ${eventId}`);
console.log("plan: oracle replay --usgs-event (live) → HCS → submit (relay) → 120 s window → oracle keeper --once (relay) → asserts");
console.log("  HBAR (relayer): HCS 0.009 + submit ≈ 0.15 + execute ≈ 0.16");

if (!st.trigger || !st.terms) {
  console.log("\nthe trigger does not exist yet (phase 2) — plan only");
  await printHbar(start);
  process.exit(0);
}
const trigger = triggerAt(p);
const pool = poolAt(p);
const triggerAddr = String(st.trigger);
const observedAt = (st.observedAt as { bhuj: number }).bhuj;
const status = async () => STATUS[Number((await trigger.getEventRecord(eventId)).status)];

if (!EXECUTE) {
  const now = await latestTs(p);
  const res = await fetch(`https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=${BHUJ_ID}&format=geojson`);
  const live = (await res.json()) as Parameters<typeof shared.buildAttestation>[0]["feature"];
  const att = shared.buildAttestation({ feature: live, terms: st.terms as never, chainId: 296n, nonce: 1n, deadline: BigInt(now + 3600), nowSec: now });
  report("dry-run checks (no keys; live USGS record)", [
    [`live record → lossBps ${att.lossBps} == ${LOSS.bhuj}, observedAt ${iso(Number(att.observedAt))} == state`, att.lossBps === LOSS.bhuj && Number(att.observedAt) === observedAt],
    [`trigger.hashAttestation(att) == local attestationDigest`, (await trigger.hashAttestation(att)) === shared.attestationDigest(att, 296n, triggerAddr)],
    [`Bhuj status now ${await status()}; trigger paused ${await trigger.paused()}`, true],
  ]);
  let sim = "OK";
  try {
    await trigger.submit.staticCall(att, "0x" + "00".repeat(65), { from: ACCOUNTS.relayer.evm });
  } catch (e) {
    sim = explain(e);
  }
  console.log(`  submit with a dummy signature simulates to: ${sim} (expected InvalidSignature once observedAt has passed)`);
  await runOracle(["status", BHUJ_ID]);
  console.log("\n(dry run — EXECUTE=1 runs the oracle with the oracle + relayer keys, then the keeper with the relayer key only)");
  await printHbar(start);
  process.exit(0);
}

// ------------------------------------------------------------ EXECUTE
if (!st.flowAVerifiedAt) throw new Error("Flow A (phase 4) has not been verified — nothing sent");
let s = await status();
if (s === "None") {
  if (await trigger.paused()) throw new Error("trigger is paused — nothing sent");
  if (!(await waitForBlockTime(p, observedAt + 3, "Bhuj's replayed observedAt", MAX_WAIT_SEC))) throw new Error("observedAt too far away — nothing sent");
  if ((await latestTs(p)) > Number(await trigger.submissionDeadline())) throw new Error("past submissionDeadline — nothing sent");
  const r = await runOracle(["replay", "--usgs-event", BHUJ_ID], await oracleKeys());
  if (r.code !== 0 || !/→ submit-new/.test(r.out)) throw new Error(`oracle replay did not submit (exit ${r.code}) — stop and report`);
  const pub = ledgerEntry(triggerAddr, eventId)?.publications.find((x) => x.nonce === 1);
  saveSmoke({ flowB: { eventId, usgsId: BHUJ_ID, submitTx: pub?.tx?.hash, hcsSeq: pub?.hcs?.sequenceNumber } });
  s = "Pending";
}

const pub = ledgerEntry(triggerAddr, eventId)?.publications.find((x) => x.nonce === 1);
if (!pub?.hcs) throw new Error("the oracle ledger has no HCS publication for Bhuj");
const hcs = await verifyHcsAttestation({ topicId: String(st.topicId), seq: pub.hcs.sequenceNumber, trigger: triggerAddr, terms: st.terms, publication: pub, usgsId: BHUJ_ID });
if (!report("HCS message (mirror node)", hcs.checks)) process.exitCode = 1;

if (s === "Pending") {
  const seen = await eventually(status, (v) => v === "Pending");
  if (seen !== "Pending") throw new Error("the submitted event is not visible as Pending after ~30 s — stopped");
  console.log(`\nchallenge window: windowEndsAt ${await trigger.windowEndsAt(eventId)} (effective time), remaining ${await trigger.windowRemaining(eventId)} s`);
  for (let i = 0; i < 90 && Number(await trigger.windowRemaining(eventId)) > 0; i++) {
    if (i % 6 === 0) console.log(`  … ${await trigger.windowRemaining(eventId)} s left`);
    await new Promise((res) => setTimeout(res, 5000));
  }
  await signerFor("flhRelayer"); // unlocks the keystore before the keeper (prints the address only)
  // The keeper reads windowRemaining through the (mirror-backed) RPC; retry once after 10 s if it saw nothing ready.
  let executeTx: string | undefined;
  for (let attempt = 1; attempt <= 3 && (await status()) === "Pending"; attempt++) {
    const k = await runOracle(["keeper", "--once"], await oracleKeys({ oracle: false, relayer: true }));
    executeTx = /execute 0x[0-9a-fA-F]{64}: mined (0x[0-9a-fA-F]{64})/.exec(k.out)?.[1];
    if (executeTx) break;
    if (k.code !== 0 && !/nothing to execute/.test(k.out)) throw new Error(`keeper failed (exit ${k.code}) — stop and report`);
    await new Promise((res) => setTimeout(res, 10_000));
  }
  saveSmoke({ flowB: { ...(loadDemo().flowB as object), hcsConsensusTimestamp: hcs.consensusTimestamp, hcsBytes: hcs.bytes, ...(executeTx ? { executeTx } : {}) } });
}

// ------------------------------------------------------------ assertions
const b = bondAt(p);
const L = Number(await eventually(() => pool.appliedLossBps(), (v: bigint) => v === LOSS.bhuj));
const credit = (TOTAL_UNITS * LOSS.bhuj) / 10_000n;
const [aP] = await pool.effectiveValue(ACCOUNTS.investorA.evm);
const [bP] = await pool.effectiveValue(ACCOUNTS.investorB.evm);
const ok = report("Flow B assertions", [
  [`appliedLossBps == ${LOSS.bhuj} (got ${L})`, BigInt(L) === LOSS.bhuj],
  [`Bhuj ${BHUJ_ID} Executed; pendingCount 0`, (await status()) === "Executed" && (await trigger.pendingCount()) === 0n],
  [`SYNTHETIC ${SYNTHETIC_ID} still Vetoed`, STATUS[Number((await trigger.getEventRecord(shared.eventIdOf(SYNTHETIC_ID))).status)] === "Vetoed"],
  [`sponsorCredited == claimable(sponsor) == floor(U × 7000 / 10000) = ${usd(credit)}`, (await pool.sponsorCredited()) === credit && (await pool.claimable(ACCOUNTS.sponsor.evm)) === credit],
  [`ATS balances unchanged: A ${usd(TICKET.investorA)}, B ${usd(TICKET.investorB)}`, (await b.balanceOf(ACCOUNTS.investorA.evm)) === TICKET.investorA && (await b.balanceOf(ACCOUNTS.investorB.evm)) === TICKET.investorB],
  [`effectiveValue(A) principal ${usd(aP)} == 90 USD`, aP === USD(90n)],
  [`effectiveValue(B) principal ${usd(bP)} == 60 USD`, bP === USD(60n)],
]);
if (ok) saveSmoke({ flowBVerifiedAt: new Date().toISOString() });
else process.exitCode = 1;
console.log(`  submissionDeadline ${iso(Number(await trigger.submissionDeadline()))}: phase 6 (settle) runs after it`);
await printInvariants(p);
await printHbar(start);
