import type { QueryCtx } from "../_generated/server";

// Shared server-side limits. Source of truth for both Convex and the UI
// (the UI should import these instead of hard-coding its own limits).
export const LIMITS = {
  todoTitle: 300,
  todoNotes: 5000,
  projectName: 80,
  projectDescription: 500,
} as const;

// Project palette. Mirrors PROJECT_COLORS in src/lib/status.ts; the UI should
// import this list so the two can't drift.
export const PROJECT_COLORS = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#64748b",
] as const;

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
 * Validates an optional assignee; empty becomes undefined.
 * TODO(#30): check against the team membership table once it exists — for now
 * we only reject ids that aren't present in `users`.
 */
export async function assignee(ctx: QueryCtx, assigneeId: string | undefined): Promise<string | undefined> {
  if (!assigneeId) return undefined;
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", assigneeId))
    .unique();
  if (!user) throw new Error("Assignee is not a member of this team.");
  return assigneeId;
}
