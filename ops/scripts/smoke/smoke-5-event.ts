// Smoke phase 5 — the replayed Bhuj earthquake through the REAL FaultlineTrigger (faultline ARCHITECTURE §4, §6, D10, D14):
//   1. abort with nothing sent if the trigger is paused or the latest block is past submissionDeadline()
//   2. wait until the latest block >= observedAt (Bhuj replayed to riskStart + 60 s)
//   3. build the attestation from the SAVED REAL USGS record (oracle/fixtures/real-usgs-usp000a8ds-detail.geojson) with
//      shared/ts buildAttestation (chainId 296, replay terms from phase 3, nonce 1, deadline now + 1 h)
//   4. owner condition: eth_call trigger.hashAttestation(att) must equal the local attestationDigest(att, 296, trigger),
//      else abort with nothing sent
//   5. the oracle key signs (EIP-712, off-chain; no tx); the signature must recover to the oracle address
//   6. relayer (deployer) submits; print windowEndsAt; wait out the 60 s challenge window (unpaused effective time)
//   7. anyone (deployer) executes; assert L == 7000, sponsor claimable == floor(U * 7000 / 10000), A/B effective value,
//      ATS balances unchanged, event Executed, pendingCount 0; invariants
// One owner run: the keystore is unlocked once for the oracle and the deployer key. Steps skip themselves when the
// event is already Pending / Executed, so a rerun resumes. Any failure stops the run (no retry).
import { verifyTypedData } from "ethers";
import { signerFor } from "../lib/common.js";
import {
  ACCOUNTS, BHUJ_ID, EXECUTE, USD, balances, bhujFixture, bondAt, eventually, latestTs, loadSmoke, poolAt, printHbar, printInvariants, provider,
  saveSmoke, sharedTs, triggerAt, tx, untilSimulates, useFaultlineErrors, usd, waitForBlockTime, type Attestation,
} from "./lib.js";

const PHASE = "smoke-5";
const CHAIN_ID = 296n;
const STATUS = ["None", "Pending", "Vetoed", "Executed", "Superseded"];
const MAX_WAIT_OBSERVED_SEC = Number(process.env.MAX_WAIT_SEC ?? "1800");
const shared = sharedTs();
useFaultlineErrors();

const p = await provider();
const start = await balances();
const st = loadSmoke();
const bhuj = bhujFixture();
const eventId = shared.eventIdOf(BHUJ_ID);
const iso = (s: number) => new Date(s * 1000).toISOString().slice(11, 19) + "Z";
const json = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

console.log(`plan: wait for observedAt → build attestation (real ${BHUJ_ID} record, chainId 296) → check hashAttestation == local digest → oracle signs (no tx) → deployer submit → wait 60 s window → deployer execute`);
console.log("  HBAR estimate (deployer): submit ≈ 0.16 (local 137,626 gas) + execute ≈ 0.17 (local 147,557 gas, incl. pool.applyLoss)");

if (!st.trigger || !st.terms) {
  // Dry run before phase 3: show what the attestation will contain, with what-if replay terms.
  const now = await latestTs(p);
  const riskStart = now + 15 * 60;
  const terms = shared.kutchTerms("replay", riskStart + 60 - Math.floor(bhuj.properties.time / 1000));
  const att = shared.buildAttestation({ feature: bhuj, terms, chainId: CHAIN_ID, nonce: 1n, deadline: BigInt(now + 3600), nowSec: now });
  console.log(`\nthe trigger does not exist yet (phase 3) — plan only. Sample attestation with WHAT-IF terms (pool deployed now, riskStart ${iso(riskStart)}):`);
  for (const [k, v] of Object.entries(att)) console.log(`  ${k.padEnd(14)} ${String(v)}`);
  console.log(`  acceptance: ${json(shared.checkAcceptance(bhuj, terms, now))} (D14: cooling measured from the real 2001 origin time); lossBps 7000 = M7.7 on the 7.0 → 8.0 curve`);
  await printHbar(start);
  process.exit(0);
}

const trigger = triggerAt(p);
const pool = poolAt(p);
const triggerAddr = String(st.trigger);
const dep = ACCOUNTS.deployer;

// ------------------------------------------------------------ 1. hard stops
const deadline = Number(await trigger.submissionDeadline());
const now0 = await latestTs(p);
const record0 = await trigger.getEventRecord(eventId);
let status = STATUS[Number(record0.status)];
console.log(`\nevent ${BHUJ_ID} (eventId ${eventId}): ${status}; submissionDeadline ${deadline} (${iso(deadline)}), latest block ${now0} (${iso(now0)}); observedAt ${st.observedAt} (${iso(Number(st.observedAt))})`);
if (status === "None") {
  if (await trigger.paused()) throw new Error("trigger is paused — nothing sent");
  if (now0 > deadline) throw new Error("latest block is past submissionDeadline() — nothing sent");
}

// ------------------------------------------------------------ 2–6. submit
if (status === "None") {
  if (!(await waitForBlockTime(p, Number(st.observedAt), "Bhuj observedAt (riskStart + 60 s)", MAX_WAIT_OBSERVED_SEC))) {
    console.log(`  observedAt is more than ${MAX_WAIT_OBSERVED_SEC} s away — run this phase after ${iso(Number(st.observedAt))}; nothing sent`);
    process.exit(EXECUTE ? 1 : 0);
  }
  const nowSec = await latestTs(p);
  if (nowSec > deadline) throw new Error("past submissionDeadline() after waiting — nothing sent");
  const att: Attestation = shared.buildAttestation({ feature: bhuj, terms: st.terms as never, chainId: CHAIN_ID, nonce: 1n, deadline: BigInt(nowSec + 3600), nowSec });
  console.log("\nattestation (built by shared/ts from the saved real USGS record):");
  for (const [k, v] of Object.entries(att)) console.log(`  ${k.padEnd(14)} ${String(v)}`);
  const checks: [string, boolean][] = [
    [`observedAt == state ${st.observedAt}`, att.observedAt === BigInt(String(st.observedAt))],
    [`termsHash == trigger.termsHash()`, att.termsHash === (await trigger.termsHash())],
    [`lossBps == 7000`, att.lossBps === 7000n],
  ];
  const onChain: string = await trigger.hashAttestation(att);
  const local = shared.attestationDigest(att, CHAIN_ID, triggerAddr);
  checks.push([`trigger.hashAttestation(att) ${onChain} == local attestationDigest ${local}`, onChain === local]);
  for (const [k, ok] of checks) console.log(`  ${ok ? "✓" : "✖"} ${k}`);
  if (checks.some(([, ok]) => !ok)) throw new Error("attestation check failed — nothing sent");

  let sig = "0x" + "00".repeat(65); // dry run: no oracle key, so submit can only be simulated up to the signature check
  if (EXECUTE) {
    const oracle = await signerFor(ACCOUNTS.oracle.network);
    sig = await shared.signAttestation(oracle as never, att, CHAIN_ID, triggerAddr);
    const recovered = verifyTypedData(shared.attestationDomain(CHAIN_ID, triggerAddr), shared.ATTESTATION_TYPES, att, sig);
    console.log(`  oracle signature ${sig.slice(0, 18)}…  recovers to ${recovered} ${recovered.toLowerCase() === ACCOUNTS.oracle.evm.toLowerCase() ? "✓" : "✖"}`);
    if (recovered.toLowerCase() !== ACCOUNTS.oracle.evm.toLowerCase()) throw new Error("signature does not recover to the oracle — nothing sent");
    saveSmoke({ attestation: JSON.parse(json(att)), signature: sig, eventId });
    await untilSimulates(trigger, "submit", [att, sig], dep.evm, 60);
  } else console.log("  (dry run: dummy signature — the submit simulation is expected to stop at InvalidSignature, after the pause and deadline checks)");
  const r = await tx(PHASE, "deployer", `trigger.submit(Bhuj ${BHUJ_ID} attestation, oracle signature) — relayer`, trigger, "submit", [att, sig]);
  if (!EXECUTE) {
    await printHbar(start);
    process.exit(0);
  }
  saveSmoke({ submitTx: r.hash });
  status = "Pending";
}

// ------------------------------------------------------------ window
if (status === "Pending" && !EXECUTE) console.log(`\nevent is Pending: an EXECUTE run waits out the window, then executes (dry run: nothing waited)`);
if (status === "Pending" && EXECUTE) {
  // A stale (mirror-lagged) view of an unknown event gives windowEndsAt == 0 + 60 and windowRemaining == 0, so first
  // wait until Hashio shows the event as Pending.
  const seen = await eventually(async () => Number((await trigger.getEventRecord(eventId)).status), (v: number) => v === 1);
  if (seen !== 1) throw new Error("the submitted event is not visible as Pending through Hashio after ~30 s — stopped");
  const ends = Number(await trigger.windowEndsAt(eventId));
  console.log(`\nchallenge window: windowEndsAt ${ends} (effective time = unpaused), remaining ${await trigger.windowRemaining(eventId)} s`);
  for (let i = 0; i < 60; i++) {
    const left = Number(await trigger.windowRemaining(eventId));
    if (left === 0) break;
    if (i % 6 === 0) console.log(`  … ${left} s left in the window`);
    await new Promise((res) => setTimeout(res, 5000));
  }
  await untilSimulates(trigger, "execute", [eventId], dep.evm, 90);
  const r = await tx(PHASE, "deployer", `trigger.execute(${BHUJ_ID}) — anyone, after the 60 s window`, trigger, "execute", [eventId]);
  saveSmoke({ executeTx: r.hash });
}

// ------------------------------------------------------------ 7. assertions
if (EXECUTE || status === "Executed") {
  const b = bondAt(p);
  const L = Number(await eventually(() => pool.appliedLossBps(), (v: bigint) => v === 7000n));
  const U: bigint = await pool.unitsIssued();
  const credit = (U * 7000n) / 10000n;
  const rec = await trigger.getEventRecord(eventId);
  const [aP, aC] = await pool.effectiveValue(ACCOUNTS.investorA.evm);
  const [bP, bC] = await pool.effectiveValue(ACCOUNTS.investorB.evm);
  const checks: [string, boolean][] = [
    [`appliedLossBps == 7000 (got ${L})`, L === 7000],
    [`event status Executed (got ${STATUS[Number(rec.status)]}), pendingCount 0`, Number(rec.status) === 3 && (await trigger.pendingCount()) === 0n],
    [`sponsorCredited == floor(U*7000/10000) = ${usd(credit)}`, (await pool.sponsorCredited()) === credit],
    [`claimable(sponsor) == ${usd(credit)}`, (await pool.claimable(ACCOUNTS.sponsor.evm)) === credit],
    [`ATS balances unchanged: A 600, B 400, totalSupply 1,000`, (await b.balanceOf(ACCOUNTS.investorA.evm)) === USD(600n) && (await b.balanceOf(ACCOUNTS.investorB.evm)) === USD(400n) && (await b.totalSupply()) === USD(1_000n)],
    [`effectiveValue(A) principal ${usd(aP)} == 180 USD (+ coupon ${usd(aC)})`, aP === USD(180n)],
    [`effectiveValue(B) principal ${usd(bP)} == 120 USD (+ coupon ${usd(bC)})`, bP === USD(120n)],
  ];
  console.log("\nassertions:");
  for (const [k, ok] of checks) console.log(`  ${ok ? "✓" : "✖"} ${k}`);
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
  else saveSmoke({ eventExecutedAt: new Date().toISOString() });
  console.log(`  submissionDeadline ${iso(Number(await trigger.submissionDeadline()))}: phase 6 (settle) runs after it`);
}
await printInvariants(p);
await printHbar(start);
