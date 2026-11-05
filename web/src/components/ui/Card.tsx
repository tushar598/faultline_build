import type { ReactNode } from "react";

/** White panel with a thin border, the ATS container style. */
export function Card({ title, subtitle, action, children, className = "", id }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`rounded-md border border-neutral-200 bg-white shadow-card ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-3.5">
          <div>
            {title && <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-neutral-700">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}
