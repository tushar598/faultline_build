// The issuer form shows every date in IST (UTC+05:30, no daylight saving) in the browser's datetime-local field; the chain's
// clock itself has no time zone. The UTC helpers stay for tests and conversions.

/** Unix seconds → "YYYY-MM-DDTHH:MM:SS" in UTC, the value format of <input type="datetime-local" step="1">. */
export function toUtcInput(sec: number): string {
  if (!Number.isFinite(sec)) return "";
  return new Date(sec * 1000).toISOString().slice(0, 19);
}

/** "YYYY-MM-DDTHH:MM[:SS]" read as UTC → unix seconds; NaN for anything else. */
export function fromUtcInput(v: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v.trim());
  if (!m) return NaN;
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number) as [number, number, number, number, number];
  const s = m[6] ? Number(m[6]) : 0;
  if (h > 23 || mi > 59 || s > 59) return NaN;
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  const back = new Date(ms);
  // Date.UTC rolls over (Feb 30 → Mar 2); refuse such inputs instead.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return NaN;
  return ms / 1000;
}

const IST_OFFSET_SEC = 5 * 3600 + 30 * 60;

/** Unix seconds → "YYYY-MM-DDTHH:MM:SS" in IST, for <input type="datetime-local" step="1">. */
export const toIstInput = (sec: number): string => (Number.isFinite(sec) ? toUtcInput(sec + IST_OFFSET_SEC) : "");

/** "YYYY-MM-DDTHH:MM[:SS]" read as IST → unix seconds; NaN for anything else. */
export const fromIstInput = (v: string): number => fromUtcInput(v) - IST_OFFSET_SEC;
