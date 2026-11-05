"use client";
// The USGS record behind an event, fetched once per id through /api/usgs/[id]. The version shown is the one whose
// dataHash equals the chain's (so the map can never show a record the oracle did not attest), else the first one.
import { useEffect, useState } from "react";
import { dataHash } from "@/lib/shared";
import type { UsgsRecord } from "@/lib/types";

type Result = { status: "idle" | "loading" } | { status: "error"; error: string } | { status: "ready"; record: UsgsRecord; matchesChain: boolean; all: UsgsRecord[] };

const cache = new Map<string, Promise<UsgsRecord[]>>();

function load(id: string): Promise<UsgsRecord[]> {
  let p = cache.get(id);
  if (!p) {
    p = fetch(`/api/usgs/${encodeURIComponent(id)}`).then(async (res) => {
      const body = (await res.json()) as { records?: UsgsRecord[]; error?: string };
      if (!res.ok || !body.records) throw new Error(body.error ?? `USGS record: HTTP ${res.status}`);
      return body.records;
    });
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

export function useUsgs(id: string | null, chainDataHash: string | null): Result {
  const key = id ? `${id}:${chainDataHash ?? ""}` : null;
  const [res, setRes] = useState<{ key: string; result: Result } | null>(null);
  useEffect(() => {
    if (!id || !key) return;
    let live = true;
    load(id).then(
      (all) => {
        if (!live) return;
        const match = chainDataHash ? all.find((r) => dataHash(r.feature) === chainDataHash) : undefined;
        setRes({ key, result: { status: "ready", record: match ?? all[0]!, matchesChain: match !== undefined, all } });
      },
      (e: unknown) => live && setRes({ key, result: { status: "error", error: e instanceof Error ? e.message : String(e) } }),
    );
    return () => {
      live = false;
    };
  }, [id, key, chainDataHash]);
  if (!key) return { status: "idle" };
  return res?.key === key ? res.result : { status: "loading" };
}
