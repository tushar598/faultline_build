"use client";
import type { NetworkId } from "@/config/networks";
import { useNetwork } from "@/state/network";

/** Local node or Hedera testnet (read only). */
export function NetworkSwitch() {
  const { state, select } = useNetwork();
  return (
    <label className="block text-xs text-neutral-700">
      <span className="mb-1 block font-medium">Network</span>
      <select
        value={state.id}
        onChange={(e) => select(e.target.value as NetworkId)}
        className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900"
      >
        <option value="local">Local Hardhat node (31337)</option>
        <option value="testnet">Hedera testnet (296), read only</option>
      </select>
    </label>
  );
}
