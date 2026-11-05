import type { ReactNode } from "react";

export function PageHeading({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold text-neutral-900">{title}</h2>
        {children && <p className="mt-1 max-w-3xl text-sm text-neutral-700">{children}</p>}
      </div>
      {action}
    </div>
  );
}
