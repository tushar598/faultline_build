// Display formatting. Every amount is a bigint in base units; nothing here rounds a value the user acts on.
// Units are always shown (USD, bps, HBAR); timestamps are India Standard Time in 12-hour form, with UTC on hover.

/** Base units of the stablecoin and the bond (both 6 decimals, 1 unit = 1 USD base unit). */
export const DECIMALS = 6;
const SCALE = 10n ** BigInt(DECIMALS);

/** 1234567n → "1.234567"; grouping with commas; `fraction` digits (default 6, always truncated, never rounded up). */
export function formatAmount(value: bigint, fraction = DECIMALS): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const whole = (v / SCALE).toLocaleString("en-US");
  const frac = (v % SCALE).toString().padStart(DECIMALS, "0").slice(0, fraction);
  return `${neg ? "-" : ""}${whole}${fraction > 0 ? `.${frac}` : ""}`;
}

/** "1,234.567890 USD". */
export const formatUsd = (value: bigint, fraction = DECIMALS) => `${formatAmount(value, fraction)} USD`;

/** Parses a user-typed USD amount ("1,000.5") into base units; null when it is not a valid non-negative amount. */
export function parseUsd(input: string): bigint | null {
  const s = input.replace(/,/g, "").trim();
  const m = /^(\d+)(?:\.(\d{0,6}))?$/.exec(s);
  if (!m) return null;
  return BigInt(m[1]!) * SCALE + BigInt((m[2] ?? "").padEnd(DECIMALS, "0"));
}

/** 7000 → "7,000 bps"; with `pct` → "7,000 bps (70.00%)". */
export function formatBps(bps: number | bigint, pct = false): string {
  const n = Number(bps);
  const base = `${n.toLocaleString("en-US")} bps`;
  return pct ? `${base} (${(n / 100).toFixed(2)}%)` : base;
}

/** Magnitude x100 → "M7.70". */
export const formatMagnitude = (magX100: number | bigint) => `M${(Number(magX100) / 100).toFixed(2)}`;

/** tinybar (8 decimals) → "1.23456789 HBAR". */
export function formatHbar(tinybar: bigint): string {
  const whole = tinybar / 100_000_000n;
  const frac = (tinybar % 100_000_000n).toString().padStart(8, "0");
  return `${whole.toLocaleString("en-US")}.${frac} HBAR`;
}

/** Seconds → "2d 3h 4m 5s" with zero units left out ("6h", "2d", "0s"). */
export function formatDuration(totalSec: number | bigint): string {
  let s = Math.max(0, Math.floor(Number(totalSec)));
  const parts: string[] = [];
  for (const [unit, size] of [["d", 86_400], ["h", 3_600], ["m", 60], ["s", 1]] as const) {
    const q = Math.floor(s / size);
    s -= q * size;
    if (q > 0) parts.push(`${q}${unit}`);
  }
  return parts.length ? parts.join(" ") : "0s";
}

/** Countdown clock "HH:MM:SS" (days folded into hours). */
export function formatClock(totalSec: number | bigint): string {
  const s = Math.max(0, Math.floor(Number(totalSec)));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** Unix seconds → "2026-10-27 09:15:02 UTC". */
export function formatUtc(unixSec: number | bigint): string {
  const d = new Date(Number(unixSec) * 1000);
  if (Number.isNaN(d.getTime())) return "Invalid time";
  return `${d.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/** The dashboard's display time zone: India Standard Time, UTC+05:30, no daylight saving. */
export const DISPLAY_TZ = "Asia/Kolkata";
export const DISPLAY_TZ_LABEL = "IST";
const IST = new Intl.DateTimeFormat("en-GB", { timeZone: DISPLAY_TZ, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });

/** Unix seconds → "06 Nov 2026, 04:25:10 PM IST". */
export function formatIst(unixSec: number | bigint): string {
  const d = new Date(Number(unixSec) * 1000);
  if (Number.isNaN(d.getTime())) return "Invalid time";
  const p = Object.fromEntries(IST.formatToParts(d).map((x) => [x.type, x.value])) as Record<string, string>;
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}:${p.second} ${String(p.dayPeriod ?? "").toUpperCase()} ${DISPLAY_TZ_LABEL}`;
}

/** Unix seconds → the viewer's local time with zone, for the hover title. */
export function formatLocal(unixSec: number | bigint): string {
  const d = new Date(Number(unixSec) * 1000);
  if (Number.isNaN(d.getTime())) return "Invalid time";
  return d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "long" });
}

/** HCS consensus timestamp "1793046713.785000000" → unix seconds. */
export const consensusSeconds = (ts: string) => Number(ts.split(".")[0]);

/** 0xAbCd…1234. */
export const shortHex = (hex: string, head = 6, tail = 4) => (hex.length <= head + tail + 2 ? hex : `${hex.slice(0, head)}…${hex.slice(-tail)}`);

/** Bond units (6 decimals; one unit is one USD of original notional): "5,000.000000 units". */
export const formatUnits = (value: bigint) => `${formatAmount(value)} units`;

/** Header title: the bond's own ERC-20 name() from the chain, else its symbol, else a neutral fallback. */
export function bondTitle(symbols: { bondName: string; bond: string } | undefined): string {
  return symbols?.bondName.trim() || symbols?.bond.trim() || "Faultline bond";
}
