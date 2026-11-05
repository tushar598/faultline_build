"use client";
// One poll loop for the whole dashboard: chain snapshot, event history, event records, holders, the HCS log and the
// connected account. Static facts are read once per trigger. A failed poll keeps the last good data and shows the error.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { readAccount, readEventRecords, readHolders, readSnapshot, readStatic, type HolderRow, type StaticFacts } from "@/lib/chain";
import { eventIdsOf, holdersOf, readLogs } from "@/lib/events";
import { readHcs } from "@/lib/hcs";
import { termsHash } from "@/lib/shared";
import type { AccountSnapshot, BondSnapshot, ChainEventRecord, HcsEntry, LogEntry, VerifiedTerms } from "@/lib/types";
import { useNetwork } from "./network";
export { useNow } from "./clock";
import { useWallet } from "./wallet";

export type DashboardData = {
  snapshot: BondSnapshot;
  account: AccountSnapshot | null;
  logs: LogEntry[];
  events: ChainEventRecord[];
  holders: HolderRow[];
  hcs: HcsEntry[];
  hcsError: string | null;
  terms: VerifiedTerms | null;
};

type Ctx = { data: DashboardData | null; loading: boolean; error: string | null; refresh: () => void };
const DataContext = createContext<Ctx | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const { state: net } = useNetwork();
  const { address } = useWallet();
  // Data and errors are tagged with the deployment they came from, so a network switch never shows stale numbers.
  const [result, setResult] = useState<{ key: string; data: DashboardData | null; error: string | null } | null>(null);
  const [tick, setTick] = useState(0);
  const facts = useRef<{ key: string; facts: StaticFacts } | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const key = net.status === "ready" ? `${net.net.chainId}:${net.net.trigger}` : null;
  const missingTrigger = net.status === "ready" && !net.net.trigger;

  useEffect(() => {
    if (net.status !== "ready" || !net.net.trigger) return;
    const { net: cfg, provider } = net;
    const k = `${cfg.chainId}:${cfg.trigger}`;
    const ctrl = new AbortController();
    const poll = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        if (facts.current?.key !== k) facts.current = { key: k, facts: await readStatic(provider, cfg.trigger!) };
        const snapshot = await readSnapshot(provider, facts.current.facts);
        const logs = await readLogs(cfg, provider, snapshot.addresses, ctrl.signal);
        const [events, holders, account] = await Promise.all([
          readEventRecords(provider, snapshot.addresses.trigger, eventIdsOf(logs)),
          readHolders(provider, snapshot, holdersOf(logs)),
          address ? readAccount(provider, snapshot, address) : Promise.resolve(null),
        ]);
        let hcs: HcsEntry[] = [];
        let hcsError: string | null = null;
        try {
          hcs = await readHcs(cfg, { chainId: snapshot.chainId, trigger: snapshot.addresses.trigger, oracle: snapshot.addresses.oracle }, ctrl.signal);
        } catch (e) {
          hcsError = e instanceof Error ? e.message : String(e);
        }
        const terms = cfg.terms ? { terms: cfg.terms, matchesChain: termsHash(cfg.terms) === snapshot.terms.termsHash } : null;
        if (!ctrl.signal.aborted) setResult({ key: k, data: { snapshot, account, logs, events, holders, hcs, hcsError, terms }, error: null });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        if (!ctrl.signal.aborted) setResult((r) => ({ key: k, data: r?.key === k ? r.data : null, error }));
      } finally {
        busy.current = false;
      }
    };
    void poll();
    const id = window.setInterval(poll, cfg.pollMs);
    return () => {
      ctrl.abort();
      window.clearInterval(id);
    };
  }, [net, address, tick]);

  const current = result?.key === key ? result : null;
  const data = current?.data ?? null;
  const error = missingTrigger ? "No trigger address is configured for this network." : (current?.error ?? null);
  const value = useMemo(() => ({ data, loading: !data && !error, error, refresh }), [data, error, refresh]);
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): Ctx {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData outside DataProvider");
  return ctx;
}

/** Chain time now, interpolated from the last snapshot with the wall clock. */
export function chainNowAt(s: BondSnapshot, nowMs: number): number {
  return s.chainTime + Math.max(0, Math.floor((nowMs - s.readAt) / 1000));
}
