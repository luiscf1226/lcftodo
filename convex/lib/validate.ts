import type { QueryCtx } from "../_generated/server";
// Limits and the palette live in ./constants so the UI can share them (#29, #37).
import { LIMITS, MAX_RANGE_DAYS, PROJECT_COLORS } from "./constants";

const fmt = (n: number) => n.toLocaleString("en-US");

function checkLength(value: string, max: number, label: string) {
  if (value.length > max) throw new Error(`${label} must be at most ${fmt(max)} characters.`);
}

/** Trims and validates a required text field; returns the trimmed value. */
export function requiredText(value: string, max: number, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  checkLength(trimmed, max, label);
  return trimmed;
}

/** Trims and validates an optional text field; empty becomes undefined. */
export function optionalText(value: string | undefined, max: number, label: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  checkLength(trimmed, max, label);
  return trimmed;
}

export const todoTitle = (s: string) => requiredText(s, LIMITS.todoTitle, "Title");
export const todoNotes = (s: string | undefined) => optionalText(s, LIMITS.todoNotes, "Notes");
export const projectName = (s: string) => requiredText(s, LIMITS.projectName, "Project name");
export const projectDescription = (s: string | undefined) =>
  optionalText(s, LIMITS.projectDescription, "Description");

/** Returns the canonical (lower-case) palette color or throws. */
export function projectColor(color: string): string {
  const c = color.trim().toLowerCase();
  if (!(PROJECT_COLORS as readonly string[]).includes(c)) throw new Error("Invalid project color.");
  return c;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True if `date` is a real calendar day in "YYYY-MM-DD" form. */
export function isCalendarDate(date: string): boolean {
  const m = DATE.exec(date);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function checkDate(date: string) {
  if (!isCalendarDate(date)) throw new Error("Invalid date.");
}

/**
 * Validates an inclusive "YYYY-MM-DD" range for team-wide queries (#15):
 * both ends must be real days, from ≤ to, and at most MAX_RANGE_DAYS long.
 */
export function checkRange(from: string, to: string) {
  checkDate(from);
  checkDate(to);
  if (from > to) throw new Error("Invalid range: the start date is after the end date.");
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new Error(`Date range too large: pick at most ${MAX_RANGE_DAYS} days.`);
  }
}

/**
 * Validates an optional assignee; empty becomes undefined.
 * Only active members of the current team may receive work.
 */
export async function assignee(ctx: QueryCtx, orgId: string, assigneeId: string | undefined): Promise<string | undefined> {
  if (!assigneeId) return undefined;
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", assigneeId))
    .unique();
  if (!membership?.active) throw new Error("Assignee is not an active member of this team.");
  return assigneeId;
}
