"use client";
import { CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import { useNetwork } from "@/state/network";
import { useWallet } from "@/state/wallet";
import { Hex } from "../ui/Hex";
import { hashscan } from "@/config/networks";

/** Status of the transaction the user is signing, bottom right; stays until dismissed after it ends. */
export function TxPanel() {
  const { tx, clearTx } = useWallet();
  const { state } = useNetwork();
  if (tx.phase === "idle") return null;
  const busy = tx.phase === "checking" || tx.phase === "signing" || tx.phase === "pending";
  const text =
    tx.phase === "checking" ? "Checking the call against the chain" : tx.phase === "signing" ? "Confirm in your wallet" : tx.phase === "pending" ? "Waiting for the transaction to be mined" : tx.phase === "done" ? "Done" : tx.phase === "error" ? tx.message : "";
  return (
    <div role="status" aria-live="polite" className="fixed right-4 bottom-4 z-50 w-[22rem] max-w-[calc(100vw-2rem)] rounded-md border border-neutral-200 bg-white p-4 shadow-card">
      <div className="flex items-start gap-2.5">
        {busy ? <Loader2 aria-hidden className="mt-0.5 size-4 animate-spin text-accent-600" /> : tx.phase === "done" ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 text-success-700" /> : <XCircle aria-hidden className="mt-0.5 size-4 text-error-700" />}
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-semibold text-neutral-900">
            {tx.label}
            {busy && tx.steps > 1 && <span className="num font-normal text-neutral-700"> (step {tx.step} of {tx.steps})</span>}
          </div>
          <div className="mt-0.5 text-neutral-800">{text}</div>
          {tx.phase === "done" && (
            <ul className="mt-1.5 space-y-0.5">
              {tx.hashes.map((h) => (
                <li key={h}>
                  <Hex value={h} href={state.status === "ready" ? hashscan(state.net, "transaction", h) : null} />
                </li>
              ))}
            </ul>
          )}
        </div>
        {!busy && (
          <button type="button" onClick={clearTx} aria-label="Dismiss" className="rounded-sm p-0.5 text-neutral-700 hover:bg-neutral-100">
            <X className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
