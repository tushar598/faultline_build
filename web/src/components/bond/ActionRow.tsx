import type { ReactNode } from "react";
import type { Guard } from "@/lib/guards";
import { Button } from "../ui/Button";

/** A write action with its button and, when disabled, the reason in plain words right under it. */
export function ActionRow({ title, description, guard, busy, onRun, label, variant = "primary", children }: { title: string; description: ReactNode; guard: Guard; busy: boolean; onRun: () => void; label: string; variant?: "primary" | "secondary" | "danger"; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 sm:max-w-[60%]">
        <div className="text-sm font-semibold text-neutral-900">{title}</div>
        <div className="mt-0.5 text-xs text-neutral-700">{description}</div>
        {children}
      </div>
      <div className="flex flex-col items-start gap-1.5 sm:items-end">
        <Button variant={variant} disabled={!guard.ok || busy} onClick={onRun} title={guard.ok ? undefined : guard.reason}>
          {label}
        </Button>
        {!guard.ok && <p className="max-w-xs text-xs text-neutral-700 sm:text-right">{guard.reason}</p>}
      </div>
    </div>
  );
}
