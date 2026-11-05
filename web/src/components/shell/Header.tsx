"use client";
import { bondTitle } from "@/lib/format";
import { phaseAt, PHASE_LABEL } from "@/lib/phase";
import { chainNowAt, useData, useNow } from "@/state/data";
import { useNetwork } from "@/state/network";
import { Tag } from "../ui/Tag";
import { BondSwitch } from "./BondSwitch";
import { NetworkSwitch } from "./NetworkSwitch";
import { WalletButton } from "./WalletButton";

/** Top bar: bond name, phase, REPLAY badge (D10), what the data is read from, and the wallet. */
export function Header() {
  const { data, error } = useData();
  const { state } = useNetwork();
  const now = useNow();
  const s = data?.snapshot;
  const mode = data?.terms?.matchesChain ? data.terms.terms.mode : (data?.hcs.find((h) => h.message?.kind === "faultline.attestation")?.message as { mode?: string } | undefined)?.mode;
  return (
    <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-50 px-6 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <h1 className="truncate text-base font-semibold text-neutral-900">{bondTitle(s?.symbols)}</h1>
        {s && <Tag tone="accent">{PHASE_LABEL[phaseAt(s, chainNowAt(s, now))]}</Tag>}
        {s?.trigger.paused && <Tag tone="warning">Trigger paused</Tag>}
        {s && s.trigger.pendingCount > 0 && <Tag tone="error">{s.trigger.pendingCount} pending event{s.trigger.pendingCount > 1 ? "s" : ""}</Tag>}
        {mode === "replay" && (
          <Tag tone="warning" title="Replay terms (D10): a historical USGS record replayed into this bond's risk period. Not a live earthquake.">
            REPLAY
          </Tag>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <BondSwitch />
        <span className="num text-xs text-neutral-700">
          {state.status === "ready" ? state.net.label : state.status === "loading" ? "Connecting" : "Network error"}
          {s && ` · block ${s.blockNumber.toLocaleString("en-US")}`}
          {error && data && " · last read failed"}
        </span>
        <WalletButton />
      </div>
      <div className="w-full md:hidden">
        <NetworkSwitch />
      </div>
    </header>
  );
}
