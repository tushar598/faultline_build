"use client";
import type { WalletState } from "@/lib/guards";
import { useNetwork } from "./network";
import { useWallet } from "./wallet";

/** Connection facts every guard needs, and whether a transaction is in flight. */
export function useWalletGuard(): { w: WalletState; busy: boolean } {
  const { address, chainId, tx } = useWallet();
  const { state } = useNetwork();
  const rightChain = state.status === "ready" && chainId === state.net.chainId;
  return { w: { connected: address !== null, rightChain }, busy: tx.phase === "checking" || tx.phase === "signing" || tx.phase === "pending" };
}
