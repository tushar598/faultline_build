import type { ReactNode } from "react";

/** Label over a value with its unit. Values are tabular so columns of numbers line up. */
export function Stat({ label, value, unit, hint, emphasis = false }: { label: ReactNode; value: ReactNode; unit?: string; hint?: ReactNode; emphasis?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-neutral-700">{label}</div>
      <div className={`num mt-1 truncate text-neutral-900 ${emphasis ? "text-2xl font-semibold" : "text-base font-semibold"}`}>
        {value}
        {unit && <span className="ml-1 text-xs font-medium text-neutral-700">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 text-xs text-neutral-700">{hint}</div>}
    </div>
  );
}
