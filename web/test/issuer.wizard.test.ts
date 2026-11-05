// Issuer page step c: the launch wizard state machine and its resumable storage.
import { describe, expect, it } from "vitest";
import { defaultScheduleDraft } from "@/lib/issuer/schedule";
import { defaultTermsDraft } from "@/lib/issuer/terms";
import {
  clearWizard, completeStep, createWizard, isFinished, isLocked, loadWizard, modeForChain, nextStep, parseWizard, planFor, recordOutputs, saveWizard, skipStep, stepStatus, trusteeSignerProblem, validateParties,
  type IssuerInputs, type Parties, type StepId,
} from "@/lib/issuer/wizard";

const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const parties = (over: Partial<Parties> = {}): Parties => ({
  admin: A(1), sponsor: A(2), oracle: A(3), trustee: A(4), stablecoin: A(5), investors: [A(6), A(7)], topicPayer: A(8), kycKeyHolder: A(9), bondName: "Faultline Kutch Bond", bondSymbol: "FLKB", ...over,
});
const inputs = (over: Partial<Parties> = {}): IssuerInputs => ({ terms: defaultTermsDraft(), schedule: defaultScheduleDraft(1_800_000_000, "local"), parties: parties(over) });

function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

/** Completes every step in the order nextStep proposes; returns the order. */
function runAll(chainId: number, inp = inputs()) {
  let w = createWizard(inp, chainId);
  const order: StepId[] = [];
  for (let s = nextStep(w); s; s = nextStep(w)) {
    order.push(s.id);
    w = completeStep(w, s.id, { txs: s.kind === "wallet" ? ["0xabc"] : undefined });
  }
  return { w, order };
}

describe("issuer wizard", () => {
  it("modes: 31337 local, 296 testnet, nothing else", () => {
    expect(modeForChain(31337)).toBe("local");
    expect(modeForChain(296)).toBe("testnet");
    expect(modeForChain(295)).toBeNull();
    expect(() => createWizard(inputs(), 295)).toThrow(/31337.*296/);
  });

  it("local: the HCS topic is skipped up front; the run order respects D5 (bond, pool, trigger, initialize) and ends with the audit", () => {
    const { w, order } = runAll(31337);
    expect(w.steps.topic?.status).toBe("skipped");
    expect(order).toEqual(["bond", "issuerRole", "bondKyc", "pool", "trigger", "initialize", "poolHtsKyc", "roles", "investorHtsKyc", "audit"]);
    expect(isFinished(w)).toBe(true);
  });

  it("testnet: the topic is an ops step and comes first; the audit waits for every other step", () => {
    const w = createWizard(inputs(), 296);
    expect(stepStatus(w, "topic")).toBe("ready");
    expect(planFor("testnet").find((s) => s.id === "topic")?.kind).toBe("ops");
    expect(planFor("testnet").find((s) => s.id === "poolHtsKyc")?.kind).toBe("ops");
    expect(planFor("testnet").find((s) => s.id === "investorHtsKyc")?.kind).toBe("ops");
    const { order } = runAll(296);
    expect(order[0]).toBe("topic");
    expect(order[order.length - 1]).toBe("audit");
  });

  it("backup trustee listed: an optional wallet step right after the trigger deploy, before initialize; empty: skipped up front", () => {
    const { order } = runAll(31337, inputs({ backupTrustee: A(12) }));
    expect(order).toEqual(["bond", "issuerRole", "bondKyc", "pool", "trigger", "backupTrustee", "initialize", "poolHtsKyc", "roles", "investorHtsKyc", "audit"]);
    expect(planFor("testnet").find((s) => s.id === "backupTrustee")).toMatchObject({ kind: "wallet", optional: true, requires: ["trigger"] });
    expect(createWizard(inputs(), 31337).steps.backupTrustee?.status).toBe("skipped");
    expect(createWizard(inputs({ backupTrustee: "" }), 296).steps.backupTrustee?.status).toBe("skipped");
  });

  it("only an optional step that is ready can be skipped; the audit still waits for it", () => {
    let w = createWizard(inputs({ backupTrustee: A(12) }), 31337);
    expect(() => skipStep(w, "backupTrustee", "x")).toThrow(/blocked/);
    w = completeStep(completeStep(w, "bond"), "pool");
    w = completeStep(w, "trigger");
    expect(stepStatus(w, "backupTrustee")).toBe("ready");
    expect(() => skipStep(w, "initialize", "x")).toThrow(/not optional/);
    const skipped = skipStep(w, "backupTrustee", "skipped on this page");
    expect(skipped.steps.backupTrustee).toMatchObject({ status: "skipped", note: "skipped on this page" });
    expect(() => skipStep(skipped, "backupTrustee", "again")).toThrow(/skipped/);
  });

  it("the backup-trustee grant must be signed by the trustee (D17), not the admin", () => {
    expect(trusteeSignerProblem(A(4), A(4))).toBeNull();
    expect(trusteeSignerProblem(A(4).toUpperCase().replace("0X", "0x"), A(4))).toBeNull();
    expect(trusteeSignerProblem(A(1), A(4))).toMatch(/Only the trustee .* can grant TRUSTEE_ROLE/);
  });

  it("no investor listed: both investor KYC steps are skipped", () => {
    const w = createWizard(inputs({ investors: [] }), 31337);
    expect(w.steps.bondKyc?.status).toBe("skipped");
    expect(w.steps.investorHtsKyc?.status).toBe("skipped");
  });

  it("a step that is not ready cannot be completed (the trigger before the pool, the audit early)", () => {
    const w = createWizard(inputs(), 31337);
    expect(stepStatus(w, "trigger")).toBe("blocked");
    expect(() => completeStep(w, "trigger")).toThrow(/blocked/);
    expect(() => completeStep(w, "audit")).toThrow(/blocked/);
    const done = completeStep(w, "bond", { out: { bond: A(10) } });
    expect(() => completeStep(done, "bond")).toThrow(/done/);
  });

  it("inputs lock once something was sent or a bond exists", () => {
    const w = createWizard(inputs(), 31337);
    expect(isLocked(w)).toBe(false);
    expect(isLocked(recordOutputs(w, { bond: A(10) }))).toBe(true);
    expect(isLocked(completeStep(w, "bond", { txs: ["0x1"] }))).toBe(true);
  });

  it("outputs merge, including the per-contract creation-code hashes", () => {
    let w = createWizard(inputs(), 31337);
    w = completeStep(w, "bond", { out: { bond: A(10), initcodeKeccak: { bond: "0xb" } } });
    w = completeStep(w, "pool", { out: { pool: A(11), initcodeKeccak: { pool: "0xp" } } });
    expect(w.out).toMatchObject({ bond: A(10), pool: A(11), initcodeKeccak: { bond: "0xb", pool: "0xp" } });
  });

  it("resumes from storage, per chain, and survives broken or foreign data without throwing", () => {
    const store = memStore();
    let w = createWizard(inputs(), 31337);
    w = completeStep(w, "bond", { out: { bond: A(10) }, txs: ["0x1"] });
    expect(saveWizard(store, w)).toBe(true);
    const back = loadWizard(store, 31337);
    expect(back).toEqual(w);
    expect(back && nextStep(back)?.id).toBe("issuerRole");
    expect(loadWizard(store, 296)).toBeNull();
    store.setItem("faultline.issuer.wizard.31337", "{not json");
    expect(loadWizard(store, 31337)).toBeNull();
    expect(parseWizard(JSON.stringify({ ...w, v: 2 }), 31337)).toBeNull();
    expect(parseWizard(JSON.stringify({ ...w, steps: { nope: { status: "done" } } }), 31337)).toBeNull();
    expect(parseWizard(JSON.stringify({ ...w, chainId: 296, mode: "local" }), 296)).toBeNull();
    clearWizard(store, 31337);
    expect(loadWizard(store, 31337)).toBeNull();
  });

  it("storage that throws is tolerated (blocked localStorage)", () => {
    const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(loadWizard(bad, 31337)).toBeNull();
    expect(saveWizard(bad, createWizard(inputs(), 31337))).toBe(false);
    expect(() => clearWizard(bad, 31337)).not.toThrow();
    expect(saveWizard(null, createWizard(inputs(), 31337))).toBe(false);
  });

  it("parties: the admin must be the wallet; addresses, duplicates, name and symbol are checked; testnet needs the ops accounts", () => {
    expect(validateParties(parties(), A(1), "local")).toEqual([]);
    expect(validateParties(parties({ admin: "" }), null, "local")).toEqual([]);
    expect(validateParties(parties({ admin: "" }), A(1), "local").join()).toMatch(/Admin/);
    expect(validateParties(parties(), A(2), "local").join()).toMatch(/connected wallet/);
    expect(validateParties(parties({ sponsor: "0x12" }), A(1), "local").join()).toMatch(/Sponsor/);
    expect(validateParties(parties({ investors: [A(6), A(6)] }), A(1), "local").join()).toMatch(/twice/);
    expect(validateParties(parties({ bondSymbol: "fl" }), A(1), "local").join()).toMatch(/symbol/);
    expect(validateParties(parties({ topicPayer: "" }), A(1), "local")).toEqual([]);
    expect(validateParties(parties({ topicPayer: "" }), A(1), "testnet").join()).toMatch(/Topic payer/);
    expect(validateParties(parties({ backupTrustee: A(12) }), A(1), "local")).toEqual([]);
    expect(validateParties(parties({ backupTrustee: "0x12" }), A(1), "local").join()).toMatch(/Backup trustee/);
    expect(validateParties(parties({ backupTrustee: A(4) }), A(1), "local").join()).toMatch(/differ from the trustee/);
  });
});
