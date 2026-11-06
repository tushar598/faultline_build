import { formatIst, formatUtc } from "@/lib/format";

/** IST in 12-hour form on screen, UTC on hover. */
export function Timestamp({ unix, className = "" }: { unix: number | bigint; className?: string }) {
  const d = new Date(Number(unix) * 1000);
  return (
    <time dateTime={Number.isNaN(d.getTime()) ? undefined : d.toISOString()} title={formatUtc(unix)} className={`num ${className}`}>
      {formatIst(unix)}
    </time>
  );
}
