import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent-600 text-white border-accent-600 hover:bg-accent-800 hover:border-accent-800",
  secondary: "bg-white text-neutral-900 border-neutral-300 hover:bg-neutral-50",
  danger: "bg-white text-error-700 border-error-100 hover:bg-error-50",
};

/** Rectangular button, 5 px radius; disabled buttons stay readable and show why in a title. */
export function Button({ variant = "secondary", children, className = "", ...rest }: { variant?: Variant; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-md border px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-100 disabled:text-neutral-700 ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
