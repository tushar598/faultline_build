"use client";
// Which network the dashboard reads, and its read-only provider. The local entry is completed from
// /api/local/config (addresses of the last local deploy); the testnet entry is static. A bond launched from the issuer
// page ("my deployments", src/lib/issuer/deployments.ts) can replace the built-in bond of its network.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { JsonRpcProvider } from "ethers";
import { LOCAL_BASE, TESTNET, type NetworkConfig, type NetworkId } from "@/config/networks";
import { makeProvider } from "@/lib/chain";
import { DEPLOYMENTS_CHANGED, activeDeployment, selectedBond, withDeployment, type Deployment } from "@/lib/issuer/deployments";
import { browserStore } from "@/lib/walletSession";
import type { Terms } from "@/lib/shared";

type NetworkState =
  | { status: "loading"; id: NetworkId }
  | { status: "error"; id: NetworkId; error: string }
  | { status: "ready"; id: NetworkId; net: NetworkConfig; provider: JsonRpcProvider; deployment: Deployment | null };

type Ctx = { state: NetworkState; select: (id: NetworkId) => void; reload: () => void };

const NetworkContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "faultline.network";

// The chosen network lives in localStorage (a per-viewer convenience), read as an external store.
const CHANGE = "faultline:network";
/** Network before the viewer picks one: local, unless the build sets NEXT_PUBLIC_DEFAULT_NETWORK=testnet (a hosted
 *  dashboard has no local node; web/vercel.json sets it). */
const DEFAULT_ID: NetworkId = process.env.NEXT_PUBLIC_DEFAULT_NETWORK === "testnet" ? "testnet" : "local";
function storedId(): NetworkId {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "testnet" || v === "local" ? v : DEFAULT_ID;
  } catch {
    return DEFAULT_ID;
  }
}
function subscribeStored(fn: () => void): () => void {
  window.addEventListener("storage", fn);
  window.addEventListener(CHANGE, fn);
  window.addEventListener(DEPLOYMENTS_CHANGED, fn);
  return () => {
    window.removeEventListener("storage", fn);
    window.removeEventListener(CHANGE, fn);
    window.removeEventListener(DEPLOYMENTS_CHANGED, fn);
  };
}

const chainOf = (id: NetworkId) => (id === "testnet" ? TESTNET.chainId : LOCAL_BASE.chainId);
/** The selected issuer-page deployment id of the stored network ("" for the built-in bond), as an external store. */
function storedBond(): string {
  return selectedBond(browserStore(), chainOf(storedId())) ?? "";
}


type LocalConfig = { rpcUrl: string; chainId: number; trigger: string; topicId: string | null; fromBlock: number; terms: Terms | null };

const PROBE_ROUNDS = 3;
const PROBE_TIMEOUT_MS = 10_000;

/** The first RPC (rpcUrl, then rpcFallbacks) that answers eth_chainId with the network's chain id within 10 s. Up to
 *  three rounds over the list, 2 s apart: on a slow or changing network (2026-11-06: 0.5–3 s per call and
 *  ERR_NETWORK_CHANGED) a single round left the whole page on "Cannot load this network". */
async function healthyRpc(net: NetworkConfig, signal: AbortSignal): Promise<string> {
  const candidates = [...new Set([net.rpcUrl, ...(net.rpcFallbacks ?? [])])];
  for (let round = 1; round <= PROBE_ROUNDS; round++) {
    for (const url of candidates) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]),
        });
        const body = (await res.json()) as { result?: string };
        if (res.ok && body.result && BigInt(body.result) === BigInt(net.chainId)) return url;
      } catch {
        if (signal.aborted) throw new Error("aborted");
      }
    }
    if (round < PROBE_ROUNDS) await new Promise((r) => setTimeout(r, 2_000));
    if (signal.aborted) throw new Error("aborted");
  }
  throw new Error(`No RPC answered for chain ${net.chainId} after ${PROBE_ROUNDS} tries (${candidates.join(", ")}). Check your internet connection, then press Try again.`);
}

async function resolve(id: NetworkId, signal: AbortSignal): Promise<NetworkConfig> {
  if (id === "testnet") return { ...TESTNET, rpcUrl: await healthyRpc(TESTNET, signal) };
  const res = await fetch("/api/local/config", { signal, cache: "no-store" });
  const body = (await res.json()) as LocalConfig | { error: string };
  if (!res.ok || "error" in body) throw new Error("error" in body ? body.error : `Local config: HTTP ${res.status}`);
  return { ...LOCAL_BASE, rpcUrl: body.rpcUrl, trigger: body.trigger, hcs: { mode: "mock", topicId: body.topicId }, logs: { mode: "rpc", fromBlock: body.fromBlock }, terms: body.terms };
}

export function NetworkProvider({ children }: { children: ReactNode }) {
  // null on the server: nothing is resolved before the browser knows the viewer's choice.
  const stored = useSyncExternalStore(subscribeStored, storedId, () => null);
  const bond = useSyncExternalStore(subscribeStored, storedBond, () => "");
  const [override, setOverride] = useState<NetworkId | null>(null);
  const id = override ?? stored;
  const [nonce, setNonce] = useState(0);
  const [resolved, setResolved] = useState<{ key: string; state: NetworkState } | null>(null);
  const key = id ? `${id}:${nonce}:${bond}` : null;

  useEffect(() => {
    if (!id || !key) return;
    const ctrl = new AbortController();
    const deployment = activeDeployment(browserStore(), chainOf(id));
    // A selected local deployment does not need the built-in one: its own addresses are enough.
    resolve(id, ctrl.signal)
      .catch((e: unknown) => {
        if (id === "local" && deployment && !ctrl.signal.aborted) return LOCAL_BASE;
        throw e;
      })
      .then(
        (base) => {
          const net = withDeployment(base, deployment);
          if (!ctrl.signal.aborted) setResolved({ key, state: { status: "ready", id, net, provider: makeProvider(net), deployment } });
        },
        (e: unknown) => !ctrl.signal.aborted && setResolved({ key, state: { status: "error", id, error: e instanceof Error ? e.message : String(e) } }),
      );
    return () => ctrl.abort();
  }, [id, key]);

  // Memoised: the data poll restarts whenever this object changes identity.
  const state = useMemo<NetworkState>(() => (resolved && resolved.key === key ? resolved.state : { status: "loading", id: id ?? "local" }), [resolved, key, id]);

  const select = useCallback((next: NetworkId) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
      window.dispatchEvent(new Event(CHANGE));
    } catch {
      /* storage blocked: the choice lasts for this tab only */
    }
    setOverride(next);
  }, []);
  const reload = useCallback(() => setNonce((x) => x + 1), []);
  const value = useMemo(() => ({ state, select, reload }), [state, select, reload]);
  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): Ctx {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error("useNetwork outside NetworkProvider");
  return ctx;
}
