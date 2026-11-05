"use client";

/** USD amount field (6 decimals); the parent parses with parseUsd and shows the guard reason. */
export function AmountInput({ id, label, value, onChange, unit = "USD", disabled = false }: { id: string; label: string; value: string; onChange: (v: string) => void; unit?: string; disabled?: boolean }) {
  return (
    <div className="mt-2.5">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-neutral-800">
        {label}
      </label>
      <div className="flex max-w-xs items-center rounded-md border border-neutral-300 bg-white focus-within:border-accent-500">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="num w-full rounded-md bg-transparent px-2.5 py-1.5 text-sm text-neutral-900 outline-none disabled:text-neutral-700"
          placeholder="0.00"
        />
        <span className="pr-2.5 text-xs font-medium text-neutral-700">{unit}</span>
      </div>
    </div>
  );
}
