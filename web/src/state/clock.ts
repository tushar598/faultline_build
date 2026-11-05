"use client";
// A shared one-second wall clock as an external store: every countdown reads the same tick, and the prerendered
// shell sees 0 (no clock on the server; there is no chain data before the first poll anyway).
import { useSyncExternalStore } from "react";

let now = 0;
const listeners = new Set<() => void>();
let timer: number | null = null;

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (timer === null) {
    now = Date.now();
    timer = window.setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now, () => 0);
}
