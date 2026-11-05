// The calculation agent. One record at a time (process): ids → ledger (D8) → chain record → rule → decision (§6.6,
// D15) → act. Acting on a new or revised attestation is always: build + sign + hashAttestation gate → simulate the
// submit → publish to HCS → submit → ledger. A failed simulation publishes nothing; a submit that fails after the
// publish is recorded and later re-sent with the SAME message, never a second one for that (eventId, nonce).
//
// watch() runs two loops: a box search every pollIntervalSec (new events and changes), and a re-check of every
// PENDING event's own record every pendingPollSec for its whole challenge window (D15: an event that moves out of the
// box or below the floor no longer shows up in the box search, and the advisory must go out at once).
import type { Contract, JsonRpcProvider, Wallet } from "ethers";
import { eventIdOf, type Terms } from "../../shared/ts/attestation.js";
import { attestationMessage, signedAdvisory } from "../../shared/ts/hcsMessage.js";
import { buildAndSign } from "./attest.js";
import { chainTime, errorText, eventRecord, linkText } from "./chain.js";
import { decide, type Decision, type RecordState } from "./decision.js";
import type { HcsPublisher } from "./hcs.js";
import type { EvmSender } from "./hederaEvm.js";
import { attFromJson, attToJson, type Ledger } from "./ledger.js";
import { log } from "./log.js";
import { evaluate } from "./rule.js";
import { send, simulate } from "./submit.js";
import { resolveIdentity } from "./identity.js";
import { asUsgsFeature, idsOf, type DetailResult, type UsgsClient } from "./usgs.js";

export type OracleDeps = {
  chainId: bigint;
  provider: JsonRpcProvider;
  triggerAddress: string;
  /** Trigger connected to the provider (reads, hashAttestation). */
  trigger: Contract;
  /** Trigger connected to the relayer wallet (submit). */
  triggerAsRelayer: Contract;
  /** How the relayer's transactions are sent: the relay (undefined) or Hedera consensus nodes (src/hederaEvm.ts). */
  evm?: EvmSender;
  signer: Wallet;
  terms: Terms;
  ledger: Ledger;
  hcs: HcsPublisher;
  usgs: UsgsClient;
  attestationTtlSec: number;
  /** The bond's risk period (read from the trigger); observedAt outside it → skip / D15 advisory. */
  risk: { riskStart: number; maturity: number };
};

export type Outcome = { eventId: string; usgsId: string; decision: Decision["action"] | "conflict" | "error"; detail: string; txHash?: string; hcsSeq?: string };

export class Oracle {
  constructor(private readonly d: OracleDeps) {}

  /** Handles one USGS answer for `usgsId` (a live detail, or a fixture in replay --offline). */
  async process(usgsId: string, res: DetailResult): Promise<Outcome> {
    const d = this.d;
    const ids = res.kind === "ok" ? idsOf(res.feature) : [usgsId];
    const preferred = res.kind === "ok" ? res.feature.id : usgsId;
    const look = await resolveIdentity(ids, d.ledger.lookup(ids), async (id) => (await eventRecord(d.trigger, id)).status);
    if (look.kind === "conflict") {
      log.error("D8: the record's ids belong to two different events — refusing to act", { usgsId: preferred, eventIds: look.eventIds });
      return { eventId: "", usgsId: preferred, decision: "conflict", detail: `ids overlap events ${look.eventIds.join(", ")}` };
    }
    const eventId = look.kind === "known" ? look.eventId : eventIdOf(preferred);
    if (look.kind === "known" && look.newIds.length) {
      d.ledger.upsert(eventId, preferred, ids);
      if (look.recoveredFromChain) log.warn("D8: the ledger did not know this record, but one of its ids is already an on-chain event; using that eventId", { eventId, preferredNow: preferred });
      else log.info("D8: new ids mapped to the original event", { eventId, preferredNow: preferred, newIds: look.newIds });
    }

    const now = await chainTime(d.provider);
    const chain = await eventRecord(d.trigger, eventId);
    const entry = d.ledger.get(eventId);
    if (entry) {
      d.ledger.update(eventId, (e) => {
        e.chainStatus = chain.status;
        e.chainNonce = chain.nonce;
        for (const p of e.publications) if (p.nonce <= chain.nonce && p.tx?.status === "sent") p.tx.status = "mined";
      });
    }
    const state: RecordState = res.kind === "ok" ? { kind: "found", evaluation: evaluate(res.feature, d.terms, now) } : { kind: res.kind };
    const decision = decide(state, chain, d.ledger.get(eventId), now, d.risk);
    const base = { eventId, usgsId: preferred };

    switch (decision.action) {
      case "finalised":
        return { ...base, decision: "finalised", detail: `event is ${decision.status} on chain` };
      case "skip":
      case "none":
        log.info(`${preferred}: ${decision.reason}`, { eventId, chainStatus: chain.status });
        return { ...base, decision: decision.action, detail: decision.reason };
      case "advisory":
        return this.advisory(base, ids, decision.reason, decision.dataHash);
      case "note": {
        const v = decision.values;
        d.ledger.upsert(eventId, preferred, ids);
        d.ledger.update(eventId, (e) => {
          (e.notes ??= []).push({ seenAt: new Date().toISOString(), usgsId: preferred, ...v });
          e.last = { dataHash: v.dataHash, usgsUpdatedAt: v.usgsUpdatedAt, lossBps: v.lossBps, magnitudeX100: v.magnitudeX100, observedAt: v.observedAt };
        });
        log.info(`${preferred}: newer USGS record, lossBps unchanged (${v.lossBps}) — recorded in the ledger only; no revision, the window is not restarted (§6.6)`, { eventId, magnitudeX100: v.magnitudeX100, observedAt: v.observedAt, dataHash: v.dataHash });
        return { ...base, decision: "note", detail: "lossBps unchanged: ledger note only" };
      }
      case "resubmit": {
        const p = decision.publication;
        log.warn(`${preferred}: re-sending the already published attestation nonce ${p.nonce} (no new HCS message)`, { eventId });
        return this.submitPublished(base, p.nonce, attFromJson(p.att), p.signature, p.hcs?.sequenceNumber, "resubmit");
      }
      case "submit-new":
      case "revise": {
        if (res.kind !== "ok") throw new Error("unreachable: attest without a record");
        const feature = asUsgsFeature(res.feature)!;
        d.ledger.upsert(eventId, preferred, ids);
        let signed;
        try {
          signed = await buildAndSign({ feature, terms: d.terms, chainId: d.chainId, trigger: d.trigger, triggerAddress: d.triggerAddress, eventId, nonce: decision.nonce, deadline: now + d.attestationTtlSec, nowSec: now, signer: d.signer });
        } catch (e) {
          log.error(`${preferred}: ${(e as Error).message}`, { eventId });
          return { ...base, decision: "error", detail: (e as Error).message };
        }
        const sim = await simulate(d.triggerAsRelayer, "submit", [signed.att, signed.signature]);
        if (!sim.ok) {
          const level = sim.alreadyHandled ? "info" : "error";
          log[level](`${preferred}: submit simulation reverts ${errorText(sim.error)} — nothing published`, { eventId, nonce: decision.nonce });
          return { ...base, decision: sim.alreadyHandled ? "none" : "error", detail: `simulation: ${errorText(sim.error)}` };
        }
        const msg = attestationMessage({ chainId: d.chainId, trigger: d.triggerAddress, terms: d.terms, att: signed.att, signature: signed.signature, usgsId: preferred });
        const hcs = await d.hcs.publish(msg);
        d.ledger.update(eventId, (e) => {
          e.publications.push({ nonce: decision.nonce, att: attToJson(signed.att), signature: signed.signature, hcs });
          const v = decision.values;
          e.last = { dataHash: v.dataHash, usgsUpdatedAt: v.usgsUpdatedAt, lossBps: v.lossBps, magnitudeX100: v.magnitudeX100, observedAt: v.observedAt };
        });
        log.info(`${preferred}: published ${decision.action === "revise" ? "revision" : "attestation"} nonce ${decision.nonce} to HCS`, { eventId, topic: hcs.topicId, sequence: hcs.sequenceNumber, lossBps: decision.values.lossBps });
        return this.submitPublished(base, decision.nonce, signed.att, signed.signature, hcs.sequenceNumber, decision.action);
      }
    }
  }

  private async submitPublished(base: { eventId: string; usgsId: string }, nonce: number, att: ReturnType<typeof attFromJson>, signature: string, hcsSeq: string | undefined, label: "submit-new" | "revise" | "resubmit"): Promise<Outcome> {
    const d = this.d;
    const r = await send(d.triggerAsRelayer, "submit", [att, signature], d.evm);
    const setTx = (status: "sent" | "mined" | "reverted" | "already-handled", hash: string, note?: string) =>
      d.ledger.update(base.eventId, (e) => {
        const p = e.publications.find((x) => x.nonce === nonce);
        if (p) p.tx = { hash, status, ...(note ? { note } : {}) };
      });
    if (r.kind === "mined") {
      setTx("mined", r.hash);
      // Logged at once, before the chain read below: a supervisor may act on this line (the testnet demo's trustee pause).
      log.info(`${base.usgsId}: submit nonce ${nonce} mined — ${linkText(d.chainId, r.hash)}`, { eventId: base.eventId, gasUsed: r.gasUsed });
      const chain = await eventRecord(d.trigger, base.eventId);
      d.ledger.update(base.eventId, (e) => {
        e.chainStatus = chain.status;
        e.chainNonce = chain.nonce;
      });
      log.info(`${base.usgsId}: chain status after the submit: ${chain.status} (nonce ${chain.nonce})`, { eventId: base.eventId });
      return { ...base, decision: label, detail: `submitted nonce ${nonce}`, txHash: r.hash, hcsSeq };
    }
    if (r.kind === "reverted") {
      setTx("reverted", r.hash, errorText(r.error));
      log.error(`${base.usgsId}: submit nonce ${nonce} REVERTED ${errorText(r.error)} — ${linkText(d.chainId, r.hash)}`, { eventId: base.eventId });
      return { ...base, decision: "error", detail: `reverted: ${errorText(r.error)}`, txHash: r.hash, hcsSeq };
    }
    if (r.alreadyHandled) setTx("already-handled", "", errorText(r.error));
    log[r.alreadyHandled ? "info" : "error"](`${base.usgsId}: submit nonce ${nonce} not sent: ${errorText(r.error)}`, { eventId: base.eventId });
    return { ...base, decision: r.alreadyHandled ? "none" : "error", detail: `not sent: ${errorText(r.error)}`, hcsSeq };
  }

  private async advisory(base: { eventId: string; usgsId: string }, ids: string[], reason: Parameters<typeof signedAdvisory>[1]["reason"], dataHash: string | null): Promise<Outcome> {
    const d = this.d;
    d.ledger.upsert(base.eventId, base.usgsId, ids);
    const msg = await signedAdvisory(d.signer as unknown as Parameters<typeof signedAdvisory>[0], { chainId: d.chainId, trigger: d.triggerAddress, eventId: base.eventId, usgsId: base.usgsId, reason, dataHash });
    log.error(`D15 ADVISORY: pending event ${base.usgsId} no longer passes the rule (${reason}). The oracle cannot revise it to 0 and submits nothing. TRUSTEE SHOULD VETO ${base.eventId} before its window ends.`, { eventId: base.eventId, reason, dataHash });
    const hcs = await d.hcs.publish(msg);
    d.ledger.update(base.eventId, (e) => e.advisories.push({ reason, dataHash, hcs, at: new Date().toISOString() }));
    log.error(`D15 advisory published to HCS`, { topic: hcs.topicId, sequence: hcs.sequenceNumber });
    return { ...base, decision: "advisory", detail: `advisory (${reason}) published`, hcsSeq: hcs.sequenceNumber };
  }

  /** One box search over the risk period (shifted back by timeOffsetSec in replay mode, D10), each hit re-read by id. */
  async searchOnce(): Promise<Outcome[]> {
    const d = this.d;
    const { riskStart, maturity } = d.risk;
    const now = await chainTime(d.provider);
    const off = d.terms.timeOffsetSec;
    const start = new Date((riskStart - off) * 1000);
    const end = new Date((Math.min(now, maturity) - off) * 1000);
    if (end <= start) return [];
    const hits = await d.usgs.search({ start, end, box: d.terms.box, minMagnitude: d.terms.floorMagX100 / 100 });
    const out: Outcome[] = [];
    for (const f of hits) out.push(await this.process(f.id, await d.usgs.detail(f.id)));
    return out;
  }

  /** D15 fast loop: re-reads the record of every event the ledger knows as Pending. */
  async pendingOnce(): Promise<Outcome[]> {
    const out: Outcome[] = [];
    for (const e of this.d.ledger.entries()) {
      const chain = await eventRecord(this.d.trigger, e.eventId);
      if (chain.status !== "Pending") {
        if (e.chainStatus !== chain.status) this.d.ledger.update(e.eventId, (x) => (x.chainStatus = chain.status));
        continue;
      }
      out.push(await this.process(e.lastPreferredId, await this.d.usgs.detail(e.lastPreferredId)));
    }
    return out;
  }
}

/** Runs `tasks` on their own intervals until `signal` aborts; a running task always finishes first. */
export async function loop(tasks: { name: string; everySec: number; run: () => Promise<unknown> }[], signal: AbortSignal): Promise<void> {
  const next = new Map(tasks.map((t) => [t.name, 0]));
  while (!signal.aborted) {
    for (const t of tasks) {
      if (signal.aborted) break;
      if (Date.now() < next.get(t.name)!) continue;
      try {
        await t.run();
      } catch (e) {
        log.error(`${t.name} failed; will retry on the next tick`, { error: (e as Error).message });
      }
      next.set(t.name, Date.now() + t.everySec * 1000);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}
