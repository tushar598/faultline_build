import { ExternalLink } from "lucide-react";
import { shortHex } from "@/lib/format";

/** A hash or address in mono, shortened, full value on hover; links out when an explorer exists. */
export function Hex({ value, href, full = false }: { value: string; href?: string | null; full?: boolean }) {
  const text = <span className="font-mono text-xs break-all">{full ? value : shortHex(value)}</span>;
  if (!href) return <span title={value}>{text}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" title={value} className="inline-flex items-center gap-1 text-accent-600 hover:underline">
      {text}
      <ExternalLink aria-hidden className="size-3" strokeWidth={1.75} />
    </a>
  );
}
