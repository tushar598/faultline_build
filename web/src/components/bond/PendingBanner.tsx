"use client";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { formatBps, formatClock } from "@/lib/format";
import { remainingAt } from "@/lib/guards";
import type { DashboardData } from "@/state/data";
import { useNow } from "@/state/data";

/** Shown on every view while an event is in its challenge window: units can still trade, and a buyer inherits the loss. */
export function PendingBanner({ d }: { d: DashboardData }) {
  const now = useNow();
  const pending = d.events.filter((e) => e.status === "Pending");
  if (pending.length === 0) return null;
  const s = d.snapshot;
  const next = Math.min(...pending.map((e) => remainingAt(e, s, now)));
  const total = pending.reduce((x, e) => x + e.lossBps, 0);
  return (
    <div role="alert" className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-error-100 bg-error-50 px-4 py-3 text-sm text-error-800">
      <AlertTriangle aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
      <span className="font-semibold">
        {pending.length} pending event{pending.length > 1 ? "s" : ""}: {formatBps(total)} of loss would apply if executed
      </span>
      <span className="num">
        {s.trigger.paused ? "Clock stopped while the trigger is paused" : `Next window ends in ${formatClock(next)}`}
      </span>
      <Link href="/trustee" className="ml-auto font-medium underline">
        Open trustee view
      </Link>
    </div>
  );
}
