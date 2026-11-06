// Full demo phase 4 — Flow A: a SYNTHETIC event is attested by the REAL oracle, then paused and vetoed by the trustee
// (faultline ARCHITECTURE §4, D2, D16, D17). One owner run; the keystore is unlocked once, BEFORE the oracle runs.
// The window is 120 s (demo-only). Every EVM tx goes through the relay (owner 2026-10-27):
//   1. wait until the latest block >= the synthetic record's replayed observedAt (riskStart + 120 s); simulate the
//      trustee's pause and SIGN it (nonce and gas price from the relay) before the oracle starts
//   2. oracle (oracle/src, child process, keys in its environment only, evm.transport "relay"):
//        replay --fixture synthetic-kutch-testnet-a.geojson
//      → rule (5000 bps) → build + sign + hashAttestation gate → simulate → HCS publish (relayer pays, oracle = submit
//        key) → submit (relayer) → receipt → prints "submit nonce 1 mined"
//   3. the moment that line appears (the oracle process is still running), the presigned pause is broadcast with
//      eth_sendRawTransaction — no read of any kind before it; afterwards the chain's pauseStart vs the event's
//      windowStart give the seconds left in the window. While paused, effectiveTime() is frozen and submissionDeadline()
//      moves with the clock (two reads >= 20 s apart); execute() simulates to IsPaused
//   4. trustee veto(eventId) WHILE PAUSED (the frozen effective time keeps the window open) → Vetoed
//   5. admin (deployer) unpause(); totalPausedSeconds == the pause length; the deadline moved by exactly that
//   6. replay rejection: the SAME attestation + signature, re-submitted by the relayer, simulates to EventFinalised;
//      with SEND_REVERT=1 it is also SENT once (fixed gas limit) so the revert is on HashScan; and the oracle itself,
//      run again on the same record, decides "finalised" and publishes nothing
//   7. the HCS message from the mirror node: bytes, payer = relayer, in-payload signature = oracle, usgsId SYNTHETIC
// Resumable: each step looks at the chain first (Pending → pause; paused → veto; Vetoed + paused → unpause; …).
import { Contract } from "ethers";
import { explain, record, signerFor } from "../lib/common.js";
import {
  ACCOUNTS, EXECUTE, LOSS, P, SYNTHETIC_FIXTURE, SYNTHETIC_ID, balances, broadcastPresigned, eventually, iso, latestTs, ledgerEntry, loadDemo, oracleKeys, poolAt,
  presignEvm, printHbar, printInvariants, provider, report, runOracle, saveSmoke, settlePresigned, sharedTs, syntheticFixture, triggerAt, tx, untilSimulates,
  useFaultlineErrors, verifyHcsAttestation, waitForBlockTime, type Presigned,
} from "./lib.js";

const PHASE = "demo-4";
const STATUS = ["None", "Pending", "Vetoed", "Executed", "Superseded"];
const MAX_WAIT_SEC = Number(process.env.MAX_WAIT_SEC ?? "900");
const SEND_REVERT = process.env.SEND_REVERT === "1";
const shared = sharedTs();
useFaultlineErrors();

const p = await provider();
const start = await balances();
const st = loadDemo();
const eventId = shared.eventIdOf(SYNTHETIC_ID);
console.log(`Flow A — SYNTHETIC event ${SYNTHETIC_ID} (NOT a real USGS event), eventId ${eventId}`);
console.log("plan: presign trustee pause → oracle replay --fixture (HCS publish + submit) → pause broadcast the moment the oracle prints the submit mined → veto while paused → admin unpause → same signature rejected (EventFinalised) → HCS read-back");
console.log("  HBAR: relayer HCS 0.009 + submit ≈ 0.15 (+ optional reverted re-submit ≈ 0.06); trustee pause + veto ≈ 0.14; deployer unpause ≈ 0.07");

if (!st.trigger || !st.terms) {
  console.log("\nthe trigger does not exist yet (phase 2) — plan only");
  await printHbar(start);
  process.exit(0);
}
const trigger = triggerAt(p);
const triggerAddr = String(st.trigger);
const observedAt = (st.observedAt as { synthetic: number }).synthetic;
const rec = async () => {
  const r = await trigger.getEventRecord(eventId);
  return { status: STATUS[Number(r.status)], windowStart: Number(r.windowStart) };
};
const state = async () => ({ ...(await rec()), paused: (await trigger.paused()) as boolean });

// ------------------------------------------------------------ dry run: what can be checked without keys
if (!EXECUTE) {
  const now = await latestTs(p);
  const att = shared.buildAttestation({ feature: syntheticFixture(), terms: st.terms as never, chainId: 296n, nonce: 1n, deadline: BigInt(now + 3600), nowSec: now });
  const onChain: string = await trigger.hashAttestation(att);
  const local = shared.attestationDigest(att, 296n, triggerAddr);
  report("dry-run checks (no keys)", [
    [`attestation lossBps ${att.lossBps} == ${LOSS.synthetic}, observedAt ${att.observedAt} == state ${observedAt} (${iso(observedAt)})`, att.lossBps === LOSS.synthetic && Number(att.observedAt) === observedAt],
    [`trigger.hashAttestation(att) == local attestationDigest (${local.slice(0, 18)}…)`, onChain === local],
    [`event status now: ${(await rec()).status}; trigger paused: ${await trigger.paused()}`, true],
  ]);
  let sim = "OK";
  try {
    await trigger.submit.staticCall(att, "0x" + "00".repeat(65), { from: ACCOUNTS.relayer.evm });
  } catch (e) {
    sim = explain(e);
  }
  console.log(`  submit with a dummy signature simulates to: ${sim} (expected InvalidSignature once observedAt has passed, else ObservedOutsideRiskPeriod)`);
  for (const [who, method, args] of [["trustee", "pause", []], ["trustee", "veto", [eventId]], ["deployer", "unpause", []]] as const) {
    let r = "OK";
    try {
      await trigger.getFunction(method).staticCall(...args, { from: ACCOUNTS[who].evm });
    } catch (e) {
      r = explain(e);
    }
    console.log(`  ${who} ${method}() simulates to: ${r}`);
  }
  const g = await trigger.pause.estimateGas({ from: ACCOUNTS.trustee.evm }).catch(() => undefined);
  console.log(`  EXECUTE presigns the pause (gas ${g ?? "?"} × 1.3, trustee nonce + gas price from the relay) BEFORE the oracle runs, and broadcasts it (eth_sendRawTransaction) the moment the oracle prints "submit nonce 1 mined", with no read in between; window ${P.challengeWindow} s; then the chain's pauseStart vs windowStart give the seconds left`);
  await runOracle(["verify-config"]);
  await runOracle(["status", SYNTHETIC_ID]);
  console.log(`\n(dry run — EXECUTE=1 waits for ${iso(observedAt)}, unlocks the oracle, relayer, trustee and deployer keys once, then runs steps 2–7)`);
  await printHbar(start);
  process.exit(0);
}

// ------------------------------------------------------------ EXECUTE
if (!st.subscribedAt) throw new Error("phase 3 has not completed (subscribedAt missing) — nothing sent");
const deadline = Number(await trigger.submissionDeadline());
let s = await state();
console.log(`\nnow: event ${s.status}, trigger paused ${s.paused}; observedAt ${iso(observedAt)}; submissionDeadline ${iso(deadline)}`);

// Unlock every key this phase needs first (one keystore prompt), so nothing waits on a password after the submit.
const keys = await oracleKeys();
await signerFor("flhTrustee");
await signerFor("flhDeployer");
const WINDOW = Number(P.challengeWindow);
if (Number(await trigger.challengeWindow()) !== WINDOW) throw new Error(`trigger window ${await trigger.challengeWindow()} s ≠ ${WINDOW} s — stop and report`);

/** Simulates pause() from the trustee and signs it (relay nonce) — done BEFORE the submit it must follow. */
async function presignPause(): Promise<Presigned> {
  let gas: bigint;
  try {
    await trigger.pause.staticCall({ from: ACCOUNTS.trustee.evm });
    gas = await trigger.pause.estimateGas({ from: ACCOUNTS.trustee.evm });
  } catch (e) {
    throw new Error(`pause simulation reverted: ${explain(e)} — nothing sent`);
  }
  const signed = await presignEvm("trustee", "trigger.pause() — trustee, the moment the oracle reports the SYNTHETIC submit mined", trigger, "pause", [], (gas * 13n) / 10n);
  console.log(`  pause presigned: nonce ${signed.nonce}, gas limit ${signed.gasLimit} (simulated ${gas}), hash ${signed.hash}`);
  return signed;
}

// ------------------------------------------------------------ 1–3. oracle attests; pause on its "mined" line
if (s.status === "None" || (s.status === "Pending" && !s.paused)) {
  if (s.paused) throw new Error("trigger is paused before Flow A — stop and report; nothing sent");
  let signed: Presigned;
  let sending: Promise<string> | undefined;
  if (s.status === "None") {
    if (!(await waitForBlockTime(p, observedAt + 3, "the synthetic record's replayed observedAt", MAX_WAIT_SEC))) throw new Error(`observedAt ${iso(observedAt)} is more than ${MAX_WAIT_SEC} s away — run later; nothing sent`);
    if ((await latestTs(p)) > deadline) throw new Error("past submissionDeadline — nothing sent");
    signed = await presignPause();
    const r = await runOracle(["replay", "--fixture", SYNTHETIC_FIXTURE], keys, (all) => {
      if (!sending && /submit nonce 1 mined/.test(all)) {
        sending = broadcastPresigned(PHASE, signed); // at once, while the child is still running
        sending.catch(() => undefined); // awaited (and rethrown) below, after the child exits
      }
    });
    const pub = ledgerEntry(triggerAddr, eventId)?.publications.find((x) => x.nonce === 1);
    saveSmoke({ flowA: { ...(loadDemo().flowA as object), eventId, usgsId: SYNTHETIC_ID, submitTx: pub?.tx?.hash, hcsSeq: pub?.hcs?.sequenceNumber } });
    if (!sending) throw new Error(`the oracle did not report the submit mined (exit ${r.code}) — no pause sent; stop and report`);
    if (r.code !== 0 || !/→ submit-new/.test(r.out)) console.log(`  ⚠ oracle exit ${r.code} after the submit was mined (the pause went out); check its log above`);
  } else {
    // Resumed run: the submit happened earlier and nothing paused yet — pause at once.
    signed = await presignPause();
    sending = broadcastPresigned(PHASE, signed);
  }
  await sending;
  await settlePresigned(PHASE, signed);
  saveSmoke({ flowA: { ...(loadDemo().flowA as object), pauseTx: signed.hash } });
  s = { ...s, status: "Pending", paused: true };
}

// ------------------------------------------------------------ 3a. seconds left at the pause, from chain values
if (s.status === "Pending" && s.paused) {
  if (!(await eventually(() => trigger.paused(), (v: boolean) => v === true))) throw new Error("pause not visible after ~30 s — stop and report");
  const pauseStart = Number(await trigger.pauseStart());
  const w = await eventually(rec, (x) => x.status === "Pending" && x.windowStart > 0);
  const left = w.windowStart + WINDOW - pauseStart;
  console.log(`  ⏱ seconds left in the ${WINDOW} s window at the pause: ${left} (chain: windowStart ${w.windowStart} = ${iso(w.windowStart)}, pauseStart ${pauseStart} = ${iso(pauseStart)})`);
  saveSmoke({ flowA: { ...(loadDemo().flowA as object), pauseStart, windowStart: w.windowStart, secondsLeftAtPause: left } });
  if (left <= 0) throw new Error("the pause landed after the window closed: the veto would revert WindowClosed. Trigger stays PAUSED (nothing can execute). STOP and report — do not unpause.");
}

// ------------------------------------------------------------ 3b. frozen clock evidence
if (s.status === "Pending" && s.paused) {
  const a = { eff: Number(await trigger.effectiveTime()), left: Number(await trigger.windowRemaining(eventId)), dl: Number(await trigger.submissionDeadline()), block: await latestTs(p) };
  await new Promise((res) => setTimeout(res, 20_000));
  const b = { eff: Number(await trigger.effectiveTime()), left: Number(await trigger.windowRemaining(eventId)), dl: Number(await trigger.submissionDeadline()), block: await latestTs(p) };
  let execSim = "OK";
  try {
    await trigger.execute.staticCall(eventId, { from: ACCOUNTS.deployer.evm });
  } catch (e) {
    execSim = explain(e);
  }
  const ok = report("while paused (two reads ~20 s apart)", [
    [`block time ${a.block} → ${b.block} advanced`, b.block > a.block],
    [`effectiveTime() frozen: ${a.eff} → ${b.eff}`, a.eff === b.eff],
    [`windowRemaining(event) frozen: ${a.left} s → ${b.left} s (> 0)`, a.left === b.left && a.left > 0],
    [`submissionDeadline() moves with the clock: +${b.dl - a.dl} s for +${b.block - a.block} s (D2: a pause before the deadline keeps redemption closed)`, b.dl - a.dl === b.block - a.block],
    [`execute(event) simulates to IsPaused (got ${execSim})`, execSim.startsWith("IsPaused")],
  ]);
  saveSmoke({ flowA: { ...(loadDemo().flowA as object), frozen: { before: a, after: b, execSim } } });
  if (!ok) throw new Error("pause evidence failed — trigger stays paused; stop and report");

  // ---------------------------------------------------------- 4. veto while paused
  await untilSimulates(trigger, "veto", [eventId], ACCOUNTS.trustee.evm, 60);
  const v = await tx(PHASE, "trustee", `trigger.veto(${SYNTHETIC_ID}) — trustee, while paused`, trigger, "veto", [eventId]);
  saveSmoke({ flowA: { ...(loadDemo().flowA as object), vetoTx: v.hash } });
  s = { ...s, status: "Vetoed" };
}

// ------------------------------------------------------------ 5. unpause
if (s.status === "Vetoed" && (await eventually(() => trigger.paused(), (v: boolean) => typeof v === "boolean"))) {
  await eventually(rec, (x) => x.status === "Vetoed");
  const before = { total: Number(await trigger.totalPausedSeconds()), start: Number(await trigger.pauseStart()) };
  await untilSimulates(trigger, "unpause", [], ACCOUNTS.deployer.evm, 60);
  const u = await tx(PHASE, "deployer", "trigger.unpause() — admin", trigger, "unpause", []);
  const total = Number(await eventually(() => trigger.totalPausedSeconds(), (x: bigint) => Number(x) > before.total));
  const pool = poolAt(p);
  const dl = Number(await trigger.submissionDeadline());
  const ok = report("after unpause", [
    [`paused == false`, !(await trigger.paused())],
    [`totalPausedSeconds ${before.total} → ${total} (paused for ${total - before.total} s)`, total > before.total],
    [`submissionDeadline() == maturity + grace + totalPausedSeconds = ${iso(dl)}`, dl === Number(await pool.maturity()) + Number(await pool.grace()) + total],
  ]);
  saveSmoke({ flowA: { ...(loadDemo().flowA as object), unpauseTx: u.hash, pausedFor: total - before.total, deadlineAfter: dl } });
  if (!ok) process.exitCode = 1;
}

// ------------------------------------------------------------ 6. replay rejection
const final = await eventually(state, (x) => x.status === "Vetoed" && !x.paused);
if (final.status !== "Vetoed" || final.paused) throw new Error(`expected Vetoed + unpaused, got ${final.status} / paused ${final.paused} — stop and report`);
const pub = ledgerEntry(triggerAddr, eventId)?.publications.find((x) => x.nonce === 1);
if (!pub) throw new Error("the oracle ledger has no publication for the synthetic event");
const a = pub.att;
const att = { eventId: a.eventId, lossBps: BigInt(a.lossBps), magnitudeX100: BigInt(a.magnitudeX100), observedAt: BigInt(a.observedAt), usgsUpdatedAt: BigInt(a.usgsUpdatedAt), nonce: BigInt(a.nonce), termsHash: a.termsHash, dataHash: a.dataHash, deadline: BigInt(a.deadline) };
let replaySim = "OK";
try {
  await trigger.submit.staticCall(att, pub.signature, { from: ACCOUNTS.relayer.evm });
} catch (e) {
  replaySim = explain(e);
}
const replayOk = replaySim.startsWith("EventFinalised(") && replaySim.includes(", 2)");
console.log(`\n[${PHASE}] replay rejection: the same attestation + oracle signature re-submitted by the relayer simulates to ${replaySim} ${replayOk ? "✓ (status 2 = Vetoed)" : "✖"}`);
let replayTx: string | undefined;
if (SEND_REVERT && replayOk && !(loadDemo().flowA as { replayTx?: string }).replayTx) {
  // Sent on purpose as on-chain evidence (like spike S2): eth_estimateGas cannot estimate a reverting call, so a fixed
  // limit is used; the relayer pays for the gas used.
  const relayer = await signerFor("flhRelayer");
  const sent = await (trigger.connect(relayer) as Contract).getFunction("submit")(att, pub.signature, { gasLimit: 200_000n });
  console.log(`  sent: ${sent.hash} (expected to revert)`);
  const rcpt = await p.waitForTransaction(sent.hash);
  replayTx = sent.hash;
  record(PHASE, `replay rejection: re-submit the vetoed SYNTHETIC attestation with the same signature — expected revert EventFinalised (status ${rcpt?.status === 0 ? "REVERTED as expected" : "SUCCESS ✖"})`, sent.hash, { status: rcpt?.status === 0 ? "REVERTED_AS_EXPECTED" : "UNEXPECTED_SUCCESS", gasUsed: rcpt?.gasUsed?.toString(), from: ACCOUNTS.relayer.evm });
  if (rcpt?.status !== 0) process.exitCode = 1;
}
const again = await runOracle(["replay", "--fixture", SYNTHETIC_FIXTURE], keys);
const oracleRefuses = again.code === 0 && /→ finalised/.test(again.out);
saveSmoke({ flowA: { ...(loadDemo().flowA as object), replaySim, ...(replayTx ? { replayTx } : {}), oracleRerun: oracleRefuses ? "finalised, nothing published" : `exit ${again.code}` } });

// ------------------------------------------------------------ 7. HCS read-back
const hcs = await verifyHcsAttestation({ topicId: String(st.topicId), seq: pub.hcs!.sequenceNumber, trigger: triggerAddr, terms: st.terms, publication: pub, usgsId: SYNTHETIC_ID });
const L = Number(await poolAt(p).appliedLossBps());
const ok = report("Flow A assertions", [
  ...hcs.checks,
  [`event ${SYNTHETIC_ID} (SYNTHETIC) is Vetoed`, final.status === "Vetoed"],
  [`replay rejection: ${replaySim}`, replayOk],
  [`oracle re-run on the same record: ${oracleRefuses ? "finalised, no new HCS message" : "✖"}`, oracleRefuses],
  [`appliedLossBps still 0 (got ${L}); pendingCount 0`, L === 0 && (await trigger.pendingCount()) === 0n],
]);
saveSmoke({ flowA: { ...(loadDemo().flowA as object), hcsConsensusTimestamp: hcs.consensusTimestamp, hcsBytes: hcs.bytes } });
if (ok) saveSmoke({ flowAVerifiedAt: new Date().toISOString() });
else process.exitCode = 1;
console.log(`  HCS: https://hashscan.io/testnet/topic/${st.topicId} seq ${pub.hcs!.sequenceNumber} (consensus ${hcs.consensusTimestamp})`);
await printInvariants(p);
await printHbar(start);
