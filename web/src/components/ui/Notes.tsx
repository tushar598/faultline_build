import { AlertTriangle, Info, OctagonAlert } from "lucide-react";
import type { ReactNode } from "react";

/** Empty state: what is missing and, when known, how to get it. Never an invented value. */
export function EmptyState({ title = "No data yet", children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-4 py-6 text-center">
      <p className="text-sm font-medium text-neutral-800">{title}</p>
      {children && <p className="mt-1 text-xs text-neutral-700">{children}</p>}
    </div>
  );
}

const TONES = {
  info: { box: "border-info-100 bg-info-50 text-info-800", Icon: Info },
  warning: { box: "border-warning-100 bg-warning-50 text-warning-800", Icon: AlertTriangle },
  error: { box: "border-error-100 bg-error-50 text-error-800", Icon: OctagonAlert },
} as const;

export function Note({ tone = "info", title, children }: { tone?: keyof typeof TONES; title?: ReactNode; children?: ReactNode }) {
  const { box, Icon } = TONES[tone];
  return (
    <div role={tone === "error" ? "alert" : "note"} className={`flex gap-2.5 rounded-md border px-3.5 py-3 text-sm ${box}`}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "mt-0.5" : ""}>{children}</div>}
      </div>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-sm bg-neutral-100 ${className}`} />;
}
