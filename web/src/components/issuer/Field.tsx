"use client";
import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";

/** Labelled text field with an inline error; the parent validates. */
export function Field({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  unit,
  disabled = false,
  type = "text",
  mono = false,
  className = "",
}: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: ReactNode;
  unit?: string;
  disabled?: boolean;
  type?: "text" | "datetime-local";
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-neutral-800">
        {label}
      </label>
      <div className={`flex items-center rounded-md border bg-white focus-within:border-accent-500 ${error ? "border-error-500" : "border-neutral-300"}`}>
        <input
          id={id}
          type={type}
          step={type === "datetime-local" ? 1 : undefined}
          autoComplete="off"
          spellCheck={false}
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full min-w-0 rounded-md bg-transparent px-2.5 py-1.5 text-sm text-neutral-900 outline-none disabled:text-neutral-700 ${mono ? "font-mono text-xs" : "num"}`}
        />
        {unit && <span className="pr-2.5 text-xs font-medium whitespace-nowrap text-neutral-700">{unit}</span>}
      </div>
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-error-700">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-1 text-xs text-neutral-700">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/** Monospace block with a copy button (commands, JSON). */
export function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="relative">
      <pre aria-label={label} className="max-h-80 overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-3 pr-20 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-neutral-900">
        {code}
      </pre>
      <button type="button" onClick={copy} className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-sm border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-800 hover:bg-neutral-100">
        {copied ? <Check aria-hidden className="size-3" /> : <Copy aria-hidden className="size-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
