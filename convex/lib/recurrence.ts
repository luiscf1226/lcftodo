// Pure recurrence helpers (#23), shared by Convex functions and the UI.
// Keep this file free of server-only imports.
import type { RecurrenceRule } from "./constants";

/** Day of the week of a "YYYY-MM-DD" key, 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** True if `date` is a day the rule produces an occurrence on. */
export function matchesRule(rule: RecurrenceRule, date: string): boolean {
  const day = weekdayOf(date);
  switch (rule.kind) {
    case "daily":
      return true;
    case "weekdays":
      return day >= 1 && day <= 5;
    case "weekly":
      return (rule.weekdays ?? []).includes(day);
  }
}

/** Every "YYYY-MM-DD" day from `from` to `to`, inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

/** The "YYYY-MM-DD" key `n` days after `date`. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Monday-first order for display, matching the week board.
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const weekdayName = (day: number) => WEEKDAY_NAMES[day];

/** Human label, e.g. "Every day", "Every weekday", "Weekly on Mon, Thu". */
export function describeRule(rule: RecurrenceRule): string {
  switch (rule.kind) {
    case "daily":
      return "Every day";
    case "weekdays":
      return "Every weekday";
    case "weekly": {
      const days = WEEKDAY_ORDER.filter((d) => rule.weekdays?.includes(d)).map(weekdayName);
      return `Weekly on ${days.join(", ")}`;
    }
  }
}
