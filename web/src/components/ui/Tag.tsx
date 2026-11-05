import type { ReactNode } from "react";

export type Tone = "neutral" | "accent" | "success" | "warning" | "error" | "info";

const TONES: Record<Tone, string> = {
  neutral: "bg-neutral-100 text-neutral-800 border-neutral-200",
  accent: "bg-accent-50 text-accent-800 border-accent-100",
  success: "bg-success-50 text-success-800 border-success-100",
  warning: "bg-warning-50 text-warning-800 border-warning-100",
  error: "bg-error-50 text-error-800 border-error-100",
  info: "bg-info-50 text-info-800 border-info-100",
};

/** Small status label with a 4 px radius. */
export function Tag({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}
