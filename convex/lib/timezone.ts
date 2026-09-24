// IANA time zone helpers shared by Convex functions and the Next.js app (#21).
// Keep this file free of server-only imports so the UI can import it directly.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** True for a time zone name the runtime's Intl data recognizes, e.g. "Europe/Madrid". */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 64) return false;
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function zonedParts(instant: number, timeZone: string): ZonedParts {
  const out: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(instant))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    // Some engines render midnight as "24" even with h23.
    hour: out.hour % 24,
    minute: out.minute,
    second: out.second,
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** The calendar day ("YYYY-MM-DD") of `instant` in `timeZone`. */
export function dateKeyInZone(instant: number, timeZone: string): string {
  const { year, month, day } = zonedParts(instant, timeZone);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Milliseconds `timeZone` is ahead of UTC at `instant`. */
function offsetMs(instant: number, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant (ms) at which calendar day `dateKey` starts in `timeZone`.
 * When a DST jump skips local midnight, this is the first instant of that day.
 */
export function startOfDayInZone(dateKey: string, timeZone: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  const wallClock = Date.UTC(y, m - 1, d);
  let instant = wallClock - offsetMs(wallClock, timeZone);
  // Re-check with the offset in effect at the first guess (handles DST changes).
  const second = wallClock - offsetMs(instant, timeZone);
  if (second !== instant && dateKeyInZone(second, timeZone) === dateKey) instant = second;
  // If midnight was skipped, the guess may land on the previous day; step forward.
  while (dateKeyInZone(instant, timeZone) < dateKey) instant += 15 * 60 * 1000;
  return instant;
}

/** Adds `n` calendar days to a "YYYY-MM-DD" key (time zone independent). */
export function addDaysToKey(dateKey: string, n: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
