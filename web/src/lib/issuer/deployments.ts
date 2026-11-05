// "My deployments": bonds launched from the issuer page, kept in this browser's localStorage, and which bond each network
// shows. The built-in bond of each network (the testnet full demo, the last local deploy) stays the default. Public data
// only (addresses, ids, terms). Every storage access is guarded. Unit-tested in test/issuer.deployments.test.ts.
import { getAddress, isAddress } from "ethers";
import type { NetworkConfig } from "@/config/networks";
import type { Terms } from "@/lib/shared";
import type { SessionStore } from "@/lib/walletSession";

export type Deployment = {
  /** `${chainId}:${trigger lowercase}`. */
  id: string;
  label: string;
  chainId: number;
  trigger: string;
  pool: string;
  bond: string;
  stablecoin: string;
  topicId: string | null;
  termsHash: string;
  terms: Terms;
  schedule: { issuanceStart: number; issuanceEnd: number; riskStart: number; maturity: number; grace: number; challengeWindow: number };
  fromBlock: number;
  createdAt: string;
};

const LIST_KEY = "faultline.deployments";
const SELECTED_KEY = (chainId: number) => `faultline.bond.${chainId}`;
/** Fired on window when the list or a selection changes, so every view re-reads. */
export const DEPLOYMENTS_CHANGED = "faultline:deployments";

export const deploymentId = (chainId: number, trigger: string) => `${chainId}:${trigger.toLowerCase()}`;

function isDeployment(x: unknown): x is Deployment {
  const d = x as Deployment;
  return (
    !!d &&
    typeof d.id === "string" &&
    typeof d.label === "string" &&
    Number.isSafeInteger(d.chainId) &&
    [d.trigger, d.pool, d.bond, d.stablecoin].every((a) => typeof a === "string" && isAddress(a)) &&
    d.id === deploymentId(d.chainId, d.trigger) &&
    typeof d.termsHash === "string" &&
    /^0x[0-9a-f]{64}$/i.test(d.termsHash) &&
    typeof d.terms === "object" &&
    d.terms !== null &&
    Number.isSafeInteger(d.fromBlock)
  );
}

/** Every stored deployment that parses; anything malformed is dropped, never thrown. */
export function loadDeployments(store: SessionStore | null): Deployment[] {
  try {
    const raw = store?.getItem(LIST_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list.filter(isDeployment) : [];
  } catch {
    return [];
  }
}

function notify(): void {
  try {
    window.dispatchEvent(new Event(DEPLOYMENTS_CHANGED));
  } catch {
    // Not in a browser (tests): nothing listens.
  }
}

/** Adds or replaces (same chain and trigger) a deployment. False when storage is blocked. */
export function saveDeployment(store: SessionStore | null, d: Deployment): boolean {
  if (!isDeployment(d)) throw new Error("not a valid deployment entry");
  try {
    const list = loadDeployments(store).filter((x) => x.id !== d.id);
    store?.setItem(LIST_KEY, JSON.stringify([...list, d]));
    notify();
    return Boolean(store);
  } catch {
    return false;
  }
}

export function removeDeployment(store: SessionStore | null, id: string): void {
  try {
    const left = loadDeployments(store).filter((x) => x.id !== id);
    store?.setItem(LIST_KEY, JSON.stringify(left));
    const chainId = Number(id.split(":")[0]);
    if (selectedBond(store, chainId) === id) selectBond(store, chainId, null);
    notify();
  } catch {
    // Storage blocked: nothing was stored either.
  }
}

/** The selected deployment id for a chain, or null for the built-in bond. */
export function selectedBond(store: SessionStore | null, chainId: number): string | null {
  try {
    return store?.getItem(SELECTED_KEY(chainId)) ?? null;
  } catch {
    return null;
  }
}

export function selectBond(store: SessionStore | null, chainId: number, id: string | null): void {
  try {
    if (id) store?.setItem(SELECTED_KEY(chainId), id);
    else store?.removeItem(SELECTED_KEY(chainId));
    notify();
  } catch {
    // The choice lasts for this page only.
  }
}

/** The deployment the network should show: the selected one if it still exists on this chain, else null (built-in). */
export function activeDeployment(store: SessionStore | null, chainId: number): Deployment | null {
  const id = selectedBond(store, chainId);
  if (!id) return null;
  return loadDeployments(store).find((d) => d.id === id && d.chainId === chainId) ?? null;
}

/** The config entry shown at the end of the wizard, ready to paste into src/config/networks.ts or an oracle config. */
export function configEntry(d: Deployment): string {
  return JSON.stringify(
    {
      label: d.label,
      chainId: d.chainId,
      trigger: getAddress(d.trigger),
      pool: getAddress(d.pool),
      bond: getAddress(d.bond),
      stablecoin: getAddress(d.stablecoin),
      topicId: d.topicId,
      termsHash: d.termsHash,
      terms: d.terms,
      schedule: d.schedule,
      fromBlock: d.fromBlock,
    },
    null,
    2,
  );
}

/** The network with an issuer-page deployment in place of its built-in bond (same chain only). */
export function withDeployment(net: NetworkConfig, d: Deployment | null): NetworkConfig {
  if (!d || d.chainId !== net.chainId) return net;
  const hcs: NetworkConfig["hcs"] = net.hcs.mode === "mirror" && d.topicId ? { mode: "mirror", topicId: d.topicId, mirrorUrl: net.hcs.mirrorUrl } : { mode: "mock", topicId: null };
  const logs: NetworkConfig["logs"] = net.logs.mode === "rpc" ? { mode: "rpc", fromBlock: d.fromBlock } : net.logs;
  return { ...net, trigger: d.trigger, terms: d.terms, hcs, logs };
}
