"use client";
import { useSyncExternalStore } from "react";
import { DEPLOYMENTS_CHANGED, loadDeployments, selectBond } from "@/lib/issuer/deployments";
import { browserStore } from "@/lib/walletSession";
import { useNetwork } from "@/state/network";

function subscribe(fn: () => void): () => void {
  window.addEventListener("storage", fn);
  window.addEventListener(DEPLOYMENTS_CHANGED, fn);
  return () => {
    window.removeEventListener("storage", fn);
    window.removeEventListener(DEPLOYMENTS_CHANGED, fn);
  };
}
// A string snapshot keeps useSyncExternalStore stable between renders.
const snapshot = () => JSON.stringify(loadDeployments(browserStore()).map((d) => [d.id, d.label, d.chainId]));

/** Which bond every view reads: the network's built-in bond or one launched from the issuer page (this browser only).
 *  Hidden until this browser has a deployment for the current network. */
export function BondSwitch() {
  const { state } = useNetwork();
  const list = JSON.parse(useSyncExternalStore(subscribe, snapshot, () => "[]")) as [string, string, number][];
  if (state.status !== "ready") return null;
  const chainId = state.net.chainId;
  const mine = list.filter(([, , c]) => c === chainId);
  if (mine.length === 0) return null;
  return (
    <label className="flex items-center gap-2 text-xs text-neutral-700">
      <span className="font-medium">Bond</span>
      <select
        aria-label="Bond shown in every view"
        value={state.deployment?.id ?? ""}
        onChange={(e) => selectBond(browserStore(), chainId, e.target.value || null)}
        className="max-w-56 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900"
      >
        <option value="">{chainId === 296 ? "Built-in: testnet full demo" : "Built-in: last local deploy"}</option>
        {mine.map(([id, label]) => (
          <option key={id} value={id}>
            My deployment: {label}
          </option>
        ))}
      </select>
    </label>
  );
}
