"use client";
import type { ReactNode } from "react";
import type { DashboardData } from "@/state/data";
import { useData } from "@/state/data";
import { useNetwork } from "@/state/network";
import { Note, Skeleton } from "../ui/Notes";
import { Button } from "../ui/Button";

/** Loading and error states shared by every view; renders the view once the first poll has data. */
export function DataGate({ children }: { children: (d: DashboardData) => ReactNode }) {
  const { state, reload } = useNetwork();
  const { data, error } = useData();
  if (state.status === "error")
    return (
      <div className="space-y-3">
        <Note tone="error" title="Cannot load this network">
          {state.error}
        </Note>
        <Button onClick={reload}>Try again</Button>
      </div>
    );
  if (!data && error)
    return (
      <Note tone="error" title="Cannot read the bond from the chain">
        {error}
      </Note>
    );
  if (!data)
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading bond data">
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  return (
    <>
      {error && (
        <div className="mb-4">
          <Note tone="warning" title="The last read failed; showing the previous data">
            {error}
          </Note>
        </div>
      )}
      {children(data)}
    </>
  );
}
