import { addDays, format, isValid, parseISO, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";
import { dateKeyInZone, startOfDayInZone } from "../../convex/lib/timezone";

// Dates are stored as calendar days ("YYYY-MM-DD") in the team's time zone
// (#21; the browser's zone when the team hasn't set one), weeks start Monday.
export const toKey = (d: Date) => format(d, "yyyy-MM-dd");
export const fromKey = (key: string) => parseISO(key);

/** Today's day key in `timeZone`, or in the browser's zone when not given. */
export const todayKey = (timeZone?: string | null) =>
  timeZone ? dateKeyInZone(Date.now(), timeZone) : toKey(new Date());

/** The browser's IANA zone, used as the default when an admin sets the team zone. */
export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The instant (ms) day `key` starts in `timeZone` (or the browser's zone). */
export const dayStartMs = (key: string, timeZone?: string | null) =>
  timeZone ? startOfDayInZone(key, timeZone) : fromKey(key).getTime();

export function weekStart(key?: string | null) {
  const date = key ? fromKey(key) : new Date();
  return toKey(startOfWeek(isValid(date) ? date : new Date(), { weekStartsOn: 1 }));
}

export function weekDays(startKey: string) {
  const start = fromKey(startKey);
  return Array.from({ length: 7 }, (_, i) => toKey(addDays(start, i)));
}

export const shiftDays = (key: string, n: number) => toKey(addDays(fromKey(key), n));

const SPANISH_PATTERNS: Record<string, string> = {
  "EEEE, MMMM d": "EEEE d 'de' MMMM",
  "EEEE, MMMM d, yyyy": "EEEE d 'de' MMMM 'de' yyyy",
  "EEEE, MMM d": "EEEE d MMM",
  "EEE, MMM d": "EEE d MMM",
  "EEE, MMM d, yyyy": "EEE d MMM yyyy",
  "MMM d": "d MMM",
};

export const fmt = (key: string, pattern: string) =>
  format(fromKey(key), SPANISH_PATTERNS[pattern] ?? pattern, { locale: es });

export function weekLabel(startKey: string) {
  const end = shiftDays(startKey, 6);
  return `${fmt(startKey, "d MMM")} – ${fmt(end, "d MMM yyyy")}`;
}
