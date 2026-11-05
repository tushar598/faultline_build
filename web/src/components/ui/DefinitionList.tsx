import type { ReactNode } from "react";

/** Two-column term / value list, dense like the ATS detail panels. */
export function DefinitionList({ items }: { items: { term: ReactNode; value: ReactNode; key?: string }[] }) {
  return (
    <dl className="divide-y divide-neutral-100">
      {items.map((it, i) => (
        <div key={it.key ?? i} className="grid grid-cols-[minmax(8rem,40%)_1fr] gap-3 py-2 text-sm">
          <dt className="text-neutral-700">{it.term}</dt>
          <dd className="num min-w-0 text-neutral-900">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
