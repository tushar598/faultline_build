// FaultlineTrigger fixtures (wired to the REAL FaultlinePool), attestation building/signing with the shared EIP-712
// spec, and a status model check (pendingCount == number of Pending events; terminal statuses never change).
import { expect } from "chai";
import { ethers } from "hardhat";
import type { Signer } from "ethers";
import { attestationDomain, attestationTypes } from "./eip712";
import { A_UNITS, B_UNITS, CAP, deployPoolFixture, wirePool } from "./pool";
import { DAY, HOUR, travelTo } from "./time";
import type { FaultlineTrigger } from "../../typechain-types";

export const TERMS = ethers.id("faultline-terms:test:v1");
export const WINDOW = 3_600n;
export const CHAIN_ID = 31_337n;
export const Status = { None: 0n, Pending: 1n, Vetoed: 2n, Executed: 3n, Superseded: 4n } as const;
export const EV_A = ethers.id("usgs:test-event-A");
export const EV_B = ethers.id("usgs:test-event-B");
export const EV_C = ethers.id("usgs:test-event-C");

export type Attestation = {
  eventId: string;
  lossBps: bigint;
  magnitudeX100: bigint;
  observedAt: bigint;
  usgsUpdatedAt: bigint;
  nonce: bigint;
  termsHash: string;
  dataHash: string;
  deadline: bigint;
};

/** Pool + real FaultlineTrigger, wired (D5: pool → trigger → initialize), reserve funded; chain time is riskStart. */
export async function deployTriggerFixture() {
  const f = await deployPoolFixture();
  const signers = await ethers.getSigners();
  const [oracle, trustee, oracle2, relayer] = [signers[7], signers[8], signers[9], signers[10]];
  const mockTrigger = f.trigger;
  const trigger = await ethers.deployContract("FaultlineTrigger", [
    await f.pool.getAddress(),
    TERMS,
    WINDOW,
    oracle.address,
    f.admin.address,
    trustee.address,
  ]);
  await wirePool(f, await trigger.getAddress());
  await f.pool.connect(f.sponsor).fundCoupons(await f.pool.requiredReserve(CAP));
  return { ...f, trigger, mockTrigger, oracle, trustee, oracle2, relayer };
}

/** Trigger fixture + investor bought A_UNITS, investor2 B_UNITS; chain time is riskStart + 1 day. */
export async function triggerFixture() {
  const f = await deployTriggerFixture();
  await travelTo(f.s.issuanceStart);
  await f.pool.connect(f.investor).invest(A_UNITS);
  await f.pool.connect(f.investor2).invest(B_UNITS);
  await travelTo(f.s.riskStart + DAY);
  return f;
}

export type TriggerWorld = Awaited<ReturnType<typeof deployTriggerFixture>>;

/** A valid attestation for event A (5000 bps, observed 1 h into the risk period), with overrides. */
export function makeAtt(f: TriggerWorld, over: Partial<Attestation> = {}): Attestation {
  const observedAt = f.s.riskStart + HOUR;
  return {
    eventId: EV_A,
    lossBps: 5_000n,
    magnitudeX100: 700n,
    observedAt,
    usgsUpdatedAt: observedAt + 600n,
    nonce: 1n,
    termsHash: TERMS,
    dataHash: ethers.id("usgs-record:A"),
    deadline: f.s.maturity + f.s.grace + 30n * DAY,
    ...over,
  };
}

/** EIP-712 signature over `att` for `verifyingContract` on `chainId` (types from shared/attestation.eip712.json). */
export function sign(signer: Signer, att: Attestation, verifyingContract: string, chainId: bigint = CHAIN_ID): Promise<string> {
  return signer.signTypedData(attestationDomain(chainId, verifyingContract), attestationTypes, att);
}

/** Oracle signs `att` for `f.trigger` and the relayer submits it. */
export async function submit(f: TriggerWorld, att: Attestation, signer: Signer = f.oracle) {
  const sig = await sign(signer, att, await f.trigger.getAddress());
  return f.trigger.connect(f.relayer).submit(att, sig);
}

/** `effectiveTime()` the next block will see, if it is mined at `ts` and the trigger is not paused. */
export async function effectiveAt(trigger: FaultlineTrigger, ts: bigint): Promise<bigint> {
  return ts - (await trigger.totalPausedSeconds());
}

/** Every known event has the modelled status, and pendingCount equals the number of Pending ones. */
export async function expectStatuses(trigger: FaultlineTrigger, model: Record<string, bigint>) {
  let pending = 0n;
  for (const [id, status] of Object.entries(model)) {
    expect((await trigger.getEventRecord(id)).status, `status of ${id.slice(0, 10)}`).to.equal(status);
    if (status === Status.Pending) pending++;
  }
  expect(await trigger.pendingCount(), "pendingCount").to.equal(pending);
}
