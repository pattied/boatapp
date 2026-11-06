// Calendar dates are plain "YYYY-MM-DD" strings in the business time zone.
export const TZ = "America/Los_Angeles";

export const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function todayLA(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: TZ });
}

const toUtc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));

export function addDays(d: string, n: number): string {
  return new Date(toUtc(d) + n * 86400000).toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(a) - toUtc(b)) / 86400000);
}

// 0 = Sunday ... 6 = Saturday
export const weekday = (d: string) => new Date(toUtc(d)).getUTCDay();

export function startOfWeek(d: string): string {
  const wd = weekday(d);
  return addDays(d, wd === 0 ? -6 : 1 - wd); // weeks start Monday
}

export function fmtDay(d: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }) {
  return new Date(toUtc(d) + 12 * 3600000).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}

export function fmtTime(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
}

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: TZ,
  });
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
