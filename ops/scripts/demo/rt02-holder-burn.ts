// RT-02 (faultline docs/REMAINING-TESTS.md, SEC-15, D18): prove on the real ATS bond that a holder's own burn no longer
// locks anyone. Written 2026-10-31, NOT RUN. It belongs to the NEXT demo deployment of a build with D18, between phase 3
// (subscribe) and phase 6 (settle): it refuses a pre-D18 deployment, so the finished `e617570` evidence cannot be touched.
//   PART=burn (default)  investor A burns 1 base unit with ATS redeem(1, "") (no role); checks the supply fell by 1.
//   PART=check           after submissionDeadline(), simulation only: every holder's pool.redeem() and pool.sweepExcess().
// Then run demo-6 (PART=a with B_BY_SCRIPT=1 or the dashboard, then PART=sweep): every holder redeems, and its final
// assertions close the books with the burned unit allowed for. Dry run by default; EXECUTE=1 by the owner only, and
// only PART=burn ever sends. If the burn fails on the real bond, stop and report: ATS was only simulated so far.
import { execFileSync } from "node:child_process";
import { Contract } from "ethers";
import { explain } from "../lib/common.js";
import {
  ACCOUNTS, EXECUTE, FAULTLINE, balances, bondAt, eventually, iso, latestTs, loadDemo, poolAt, printHbar, printInvariants, provider, report, saveSmoke,
  triggerAt, tx, useFaultlineErrors, usd,
} from "./lib.js";

const PHASE = "rt-02";
const PART = process.env.PART ?? "burn";
const BURN = 1n;
useFaultlineErrors();

const p = await provider();
const start = await balances();
const st = loadDemo();
if (!st.pool || !st.trigger) throw new Error("no deployment in out/demo-state.json — run phases 0 to 3 first; nothing sent");
const build = st.build as { commit: string } | undefined;
if (!build) throw new Error("no build recorded — nothing sent");
const deployed = execFileSync("git", ["-C", FAULTLINE, "show", `${build.commit}:contracts/FaultlinePool.sol`], { encoding: "utf8" });
if (!deployed.includes("if (actual > expected) revert SupplyMismatch")) throw new Error(`the deployment in the state file is build ${build.commit.slice(0, 7)}, before D18: this script needs the fixed build — nothing sent`);
if (st.settledAt) throw new Error("this deployment is already settled — nothing sent");

const pool = poolAt(p);
const bond = bondAt(p);
const trigger = triggerAt(p);
const A = ACCOUNTS.investorA.evm;
const B = ACCOUNTS.investorB.evm;
console.log(`build ${build.commit.slice(0, 7)}, pool ${st.pool}, bond ${st.bond}, PART=${PART}`);

if (PART === "burn") {
  if (st.holderBurned) throw new Error(`already burned ${st.holderBurned} (out/demo-state.json) — nothing sent`);
  const [supply, issued, redeemed, heldByA] = (await Promise.all([bond.totalSupply(), pool.unitsIssued(), pool.unitsRedeemed(), bond.balanceOf(A)])).map(BigInt);
  console.log(`supply ${usd(supply)}, books ${usd(issued - redeemed)}, investor A ${usd(heldByA)}`);
  if (supply !== issued - redeemed) throw new Error("supply already differs from the books — stop and report; nothing sent");
  if (heldByA < BURN) throw new Error("investor A holds nothing to burn (phase 3 first) — nothing sent");
  // BOND_ABI has no holder `redeem`: it was extracted for the controller path.
  const holderBond = new Contract(String(st.bond), ["function redeem(uint256 value, bytes data)"], p);
  await tx(PHASE, "investorA", `investor A burns ${BURN} base unit: bond.redeem (ATS, no role)`, holderBond, "redeem", [BURN, "0x"]);
  if (EXECUTE) {
    const after: bigint = await eventually(() => bond.totalSupply(), (v: bigint) => v === supply - BURN);
    const ok = report("burn", [
      [`bond totalSupply fell by ${BURN}: ${usd(supply)} → ${usd(after)}`, after === supply - BURN],
      [`investor A balance fell by ${BURN}`, (await bond.balanceOf(A)) === heldByA - BURN],
      ["isSolvent() stays true", await pool.isSolvent()],
    ]);
    if (ok) saveSmoke({ holderBurned: BURN.toString() });
    else process.exitCode = 1;
  }
} else if (PART === "check") {
  const deadline = Number(await trigger.submissionDeadline());
  const now = await latestTs(p);
  console.log(`submissionDeadline ${iso(deadline)}, latest block ${iso(now)}, supply ${usd(await bond.totalSupply())}, books ${usd(BigInt(await pool.unitsIssued()) - BigInt(await pool.unitsRedeemed()))}`);
  if (now <= deadline) throw new Error("redemption is not open yet — nothing simulated");
  const simulate = async (what: string, method: string, from: string) => {
    let got = "OK";
    try {
      await pool.getFunction(method).staticCall({ from });
    } catch (e) {
      got = `REVERT ${explain(e)}`;
      process.exitCode = 1;
    }
    console.log(`  ${what}: ${got}`);
  };
  for (const who of [A, B]) if ((await bond.balanceOf(who)) > 0n) await simulate(`redeem by ${who}`, "redeem", who);
  await simulate("sweepExcess", "sweepExcess", ACCOUNTS.deployer.evm);
} else throw new Error(`unknown PART=${PART}`);

await printInvariants(p);
await printHbar(start);
