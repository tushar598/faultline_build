"use client";
import { Clock } from "lucide-react";
import { useNetwork } from "@/state/network";

/** Local network only: the Hardhat chain is time-travelled, so block times can sit months ahead of the HCS times. */
export function SimulatedTimeNote({ className = "" }: { className?: string }) {
  const { state } = useNetwork();
  if (state.status !== "ready" || state.net.id !== "local") return null;
  return (
    <p className={`flex items-center gap-1.5 text-xs text-neutral-700 ${className}`}>
      <Clock aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
      Local chain time is simulated (time travel); HCS times are real.
    </p>
  );
}
