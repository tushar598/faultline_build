import { formatLocal, formatUtc } from "@/lib/format";

/** UTC on screen, the viewer's local time on hover. */
export function Timestamp({ unix, className = "" }: { unix: number | bigint; className?: string }) {
  const d = new Date(Number(unix) * 1000);
  return (
    <time dateTime={Number.isNaN(d.getTime()) ? undefined : d.toISOString()} title={`Local time: ${formatLocal(unix)}`} className={`num ${className}`}>
      {formatUtc(unix)}
    </time>
  );
}
