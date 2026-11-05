"use client";
// The user's own wallet (EIP-1193, e.g. MetaMask). Every write is signed there; the dashboard never sees a key.
// Before a transaction is sent, the same call runs as a staticCall so a revert is shown in plain words and nothing
// doomed reaches the chain.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { BrowserProvider, Contract, getAddress, type InterfaceAbi, type JsonRpcSigner } from "ethers";
import type { NetworkConfig } from "@/config/networks";
import { plainError } from "@/lib/errors";
import { gasLimitFor } from "@/lib/gas";
import { browserStore, isSignedOut, revokeWallet, setSignedOut } from "@/lib/walletSession";
import { useNetwork } from "./network";

type Eip1193 = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, fn: (...args: unknown[]) => void): void;
  removeListener?(event: string, fn: (...args: unknown[]) => void): void;
};

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

export type TxStep = { label: string; address: string; abi: InterfaceAbi; method: string; args: unknown[] };
export type TxState =
  | { phase: "idle" }
  | { phase: "checking" | "signing" | "pending"; label: string; step: number; steps: number }
  | { phase: "done"; label: string; hashes: string[] }
  | { phase: "error"; label: string; message: string };

type Ctx = {
  available: boolean;
  address: string | null;
  chainId: number | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  switchTo: (net: NetworkConfig) => Promise<void>;
  tx: TxState;
  /** Runs the steps in order (e.g. approve then invest); stops at the first failure. Returns true when all mined. */
  run: (label: string, steps: TxStep[], onMined?: () => void) => Promise<boolean>;
  clearTx: () => void;
};

const WalletContext = createContext<Ctx | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { state: netState } = useNetwork();
  const available = useSyncExternalStore(
    () => () => undefined,
    () => window.ethereum !== undefined,
    () => false,
  );
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [tx, setTx] = useState<TxState>({ phase: "idle" });
  // Read by the wallet's event handlers, so a sign-out holds until the user signs in again.
  const signedOut = useRef(false);

  useEffect(() => {
    signedOut.current = isSignedOut(browserStore());
    const eth = window.ethereum;
    if (!eth) return;
    const onAccounts = (...a: unknown[]) => {
      const list = a[0] as string[] | undefined;
      setAddress(!signedOut.current && list && list[0] ? getAddress(list[0]) : null);
    };
    const onChain = (...a: unknown[]) => setChainId(Number(a[0] as string));
    eth.request({ method: "eth_accounts" }).then((list) => onAccounts(list), () => undefined);
    eth.request({ method: "eth_chainId" }).then((c) => onChain(c), () => undefined);
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const connect = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) return;
    try {
      const list = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      signedOut.current = false;
      setSignedOut(browserStore(), false);
      setAddress(list[0] ? getAddress(list[0]) : null);
      setChainId(Number(await eth.request({ method: "eth_chainId" })));
    } catch (e) {
      setTx({ phase: "error", label: "Sign in", message: plainError(e) });
    }
  }, []);

  const disconnect = useCallback(async () => {
    signedOut.current = true;
    setSignedOut(browserStore(), true);
    setAddress(null);
    setTx({ phase: "idle" });
    const eth = window.ethereum;
    if (eth) await revokeWallet(eth);
  }, []);

  const switchTo = useCallback(async (net: NetworkConfig) => {
    const eth = window.ethereum;
    if (!eth) return;
    const hex = `0x${net.chainId.toString(16)}`;
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (e) {
      if ((e as { code?: number }).code !== 4902) {
        setTx({ phase: "error", label: "Switch network", message: plainError(e) });
        return;
      }
      try {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: hex, chainName: net.label, rpcUrls: [net.rpcUrl], nativeCurrency: net.nativeCurrency, blockExplorerUrls: net.explorer ? [net.explorer.baseUrl] : undefined }],
        });
      } catch (e2) {
        setTx({ phase: "error", label: "Add network", message: plainError(e2) });
      }
    }
  }, []);

  const run = useCallback(
    async (label: string, steps: TxStep[], onMined?: () => void) => {
      const eth = window.ethereum;
      if (!eth || netState.status !== "ready") return false;
      const hashes: string[] = [];
      try {
        const browser = new BrowserProvider(eth);
        const signer: JsonRpcSigner = await browser.getSigner();
        const want = netState.net.chainId;
        for (const [i, s] of steps.entries()) {
          // SEC-11: the wallet may have switched chains since the page rendered; never send to the same address elsewhere.
          const have = Number(await eth.request({ method: "eth_chainId" }));
          if (have !== want) throw new Error(`The wallet is on chain ${have}, not ${want}. Switch the wallet to this dashboard's network.`);
          const c = new Contract(s.address, s.abi, signer);
          setTx({ phase: "checking", label: s.label, step: i + 1, steps: steps.length });
          const fn = c.getFunction(s.method);
          await fn.staticCall(...s.args);
          // The wallet's own limit equals the estimate, which can run out of gas on Hedera (src/lib/gas.ts).
          const gasLimit = gasLimitFor(await fn.estimateGas(...s.args));
          setTx({ phase: "signing", label: s.label, step: i + 1, steps: steps.length });
          const sent = await fn(...s.args, { gasLimit });
          setTx({ phase: "pending", label: s.label, step: i + 1, steps: steps.length });
          const receipt = await sent.wait();
          if (!receipt || receipt.status !== 1) throw new Error(`${s.label}: the transaction failed on chain.`);
          hashes.push(receipt.hash);
          onMined?.();
        }
        setTx({ phase: "done", label, hashes });
        return true;
      } catch (e) {
        setTx({ phase: "error", label, message: plainError(e) });
        onMined?.();
        return false;
      }
    },
    [netState],
  );

  const clearTx = useCallback(() => setTx({ phase: "idle" }), []);
  const value = useMemo(() => ({ available, address, chainId, connect, disconnect, switchTo, tx, run, clearTx }), [available, address, chainId, connect, disconnect, switchTo, tx, run, clearTx]);
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): Ctx {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet outside WalletProvider");
  return ctx;
}
