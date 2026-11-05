// Minimal structured logger: one line per event, ISO time, level, message, optional JSON fields. English only; never
// pass keys or other secrets to it.
export type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(process.env.ORACLE_LOG_LEVEL as Level) ?? "info"] ?? ORDER.info;

function out(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < threshold) return;
  const extra = fields ? " " + JSON.stringify(fields, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) : "";
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}${extra}`;
  (level === "error" || level === "warn" ? console.error : console.log)(line);
}

export const log = {
  debug: (m: string, f?: Record<string, unknown>) => out("debug", m, f),
  info: (m: string, f?: Record<string, unknown>) => out("info", m, f),
  warn: (m: string, f?: Record<string, unknown>) => out("warn", m, f),
  error: (m: string, f?: Record<string, unknown>) => out("error", m, f),
};
