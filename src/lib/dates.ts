import { addDays, format, isValid, parseISO, startOfWeek } from "date-fns";

// Dates are stored as local calendar days ("YYYY-MM-DD"), weeks start Monday.
export const toKey = (d: Date) => format(d, "yyyy-MM-dd");
export const fromKey = (key: string) => parseISO(key);
export const todayKey = () => toKey(new Date());

export function weekStart(key?: string | null) {
  const date = key ? fromKey(key) : new Date();
  return toKey(startOfWeek(isValid(date) ? date : new Date(), { weekStartsOn: 1 }));
}

export function weekDays(startKey: string) {
  const start = fromKey(startKey);
  return Array.from({ length: 7 }, (_, i) => toKey(addDays(start, i)));
}

export const shiftDays = (key: string, n: number) => toKey(addDays(fromKey(key), n));

export const fmt = (key: string, pattern: string) => format(fromKey(key), pattern);

export function weekLabel(startKey: string) {
  const end = shiftDays(startKey, 6);
  const sameMonth = startKey.slice(0, 7) === end.slice(0, 7);
  return `${fmt(startKey, "MMM d")} – ${fmt(end, sameMonth ? "d, yyyy" : "MMM d, yyyy")}`;
}
