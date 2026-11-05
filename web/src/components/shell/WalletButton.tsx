"use client";
import { LogOut, Wallet } from "lucide-react";
import { shortHex } from "@/lib/format";
import { useNetwork } from "@/state/network";
import { useWallet } from "@/state/wallet";
import { Button } from "../ui/Button";
import { Tag } from "../ui/Tag";

export function WalletButton() {
  const { available, address, chainId, connect, disconnect, switchTo, tx } = useWallet();
  const { state } = useNetwork();
  if (!available) return <Tag tone="neutral" title="Install MetaMask or another EIP-1193 wallet to sign transactions">No wallet found</Tag>;
  if (!address)
    return (
      <Button variant="primary" onClick={() => void connect()}>
        <Wallet aria-hidden className="size-4" strokeWidth={1.75} />
        Sign in with wallet
      </Button>
    );
  const wrong = state.status === "ready" && chainId !== state.net.chainId;
  const busy = tx.phase === "checking" || tx.phase === "signing" || tx.phase === "pending";
  return (
    <div className="flex items-center gap-2">
      {wrong && state.status === "ready" && (
        <Button variant="secondary" onClick={() => void switchTo(state.net)}>
          Switch to chain {state.net.chainId}
        </Button>
      )}
      <span title={address} className="inline-flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-1.5 font-mono text-xs text-neutral-900">
        <span aria-hidden className={`size-2 rounded-full ${wrong ? "bg-warning-500" : "bg-success-500"}`} />
        {shortHex(address)}
        <span className="text-neutral-700">chain {chainId ?? "?"}</span>
      </span>
      <Button variant="secondary" disabled={busy} title={busy ? "A transaction is in progress" : undefined} onClick={() => void disconnect()}>
        <LogOut aria-hidden className="size-4" strokeWidth={1.75} />
        Sign out
      </Button>
    </div>
  );
}
