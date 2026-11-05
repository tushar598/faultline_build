// Issuer page step e: "my deployments" and the bond each network shows.
import { describe, expect, it } from "vitest";
import { activeDeployment, configEntry, deploymentId, loadDeployments, removeDeployment, saveDeployment, selectBond, selectedBond, withDeployment, type Deployment } from "@/lib/issuer/deployments";
import { kutchTerms, termsHash } from "@/lib/shared";
import { LOCAL_BASE, TESTNET } from "@/config/networks";

const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const terms = kutchTerms("live", 0);
const dep = (chainId: number, trigger: string, over: Partial<Deployment> = {}): Deployment => ({
  id: deploymentId(chainId, trigger), label: "FLKB", chainId, trigger, pool: A(2), bond: A(3), stablecoin: A(4), topicId: chainId === 296 ? "0.0.123" : null,
  termsHash: termsHash(terms), terms, schedule: { issuanceStart: 1, issuanceEnd: 2, riskStart: 2, maturity: 3, grace: 4, challengeWindow: 5 }, fromBlock: 42, createdAt: "2026-11-03T00:00:00.000Z", ...over,
});
function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe("my deployments", () => {
  it("save, replace by id, select per chain, remove clears the selection", () => {
    const s = memStore();
    const d = dep(31337, A(0xa1));
    saveDeployment(s, d);
    saveDeployment(s, { ...d, label: "renamed" });
    saveDeployment(s, dep(296, A(0xa2)));
    expect(loadDeployments(s).map((x) => x.label)).toEqual(["renamed", "FLKB"]);
    selectBond(s, 31337, d.id);
    expect(activeDeployment(s, 31337)?.label).toBe("renamed");
    expect(activeDeployment(s, 296)).toBeNull();
    removeDeployment(s, d.id);
    expect(selectedBond(s, 31337)).toBeNull();
    expect(loadDeployments(s)).toHaveLength(1);
  });

  it("a selection pointing at a missing or foreign-chain deployment falls back to the built-in bond", () => {
    const s = memStore();
    saveDeployment(s, dep(296, A(0xa2)));
    selectBond(s, 31337, deploymentId(296, A(0xa2)));
    expect(activeDeployment(s, 31337)).toBeNull();
  });

  it("malformed entries are dropped, invalid entries refused, blocked storage tolerated", () => {
    const s = memStore();
    s.setItem("faultline.deployments", JSON.stringify([dep(31337, A(1)), { id: "x" }, null]));
    expect(loadDeployments(s)).toHaveLength(1);
    expect(() => saveDeployment(s, { ...dep(31337, A(1)), trigger: "0x12" })).toThrow();
    const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(loadDeployments(bad)).toEqual([]);
    expect(saveDeployment(bad, dep(31337, A(1)))).toBe(false);
    expect(selectedBond(bad, 31337)).toBeNull();
  });

  it("the network config switches trigger, terms, topic and the log start; the built-in stays when nothing is selected", () => {
    const local = withDeployment({ ...LOCAL_BASE, trigger: A(9) }, dep(31337, A(0xa1)));
    expect(local.trigger).toBe(A(0xa1));
    expect(local.logs).toEqual({ mode: "rpc", fromBlock: 42 });
    expect(local.hcs).toEqual({ mode: "mock", topicId: null });
    const tn = withDeployment(TESTNET, dep(296, A(0xa2)));
    expect(tn.hcs).toMatchObject({ mode: "mirror", topicId: "0.0.123" });
    expect(tn.logs).toEqual(TESTNET.logs);
    expect(withDeployment(TESTNET, null)).toBe(TESTNET);
    expect(withDeployment(TESTNET, dep(31337, A(1)))).toBe(TESTNET);
  });

  it("the config entry carries the addresses checksummed, the termsHash, the terms, the schedule and the topic", () => {
    const e = JSON.parse(configEntry(dep(296, A(0xa2))));
    expect(e).toMatchObject({ chainId: 296, topicId: "0.0.123", termsHash: termsHash(terms), fromBlock: 42 });
    expect(e.terms).toEqual(terms);
  });
});
