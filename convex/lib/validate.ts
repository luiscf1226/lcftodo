import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { userCanAccessProject } from "./auth";
// Limits and the palette live in ./constants so the UI can share them (#29, #37).
import { LIMITS, MAX_RANGE_DAYS, PROJECT_COLORS, type RecurrenceRule } from "./constants";

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
export const projectDescription = (s: string | undefined) => optionalText(s, LIMITS.projectDescription, "Description");

export const commentBody = (s: string) => requiredText(s, LIMITS.comment, "Comment");

/** Validates a recurrence rule (#23); weekly rules get sorted, de-duplicated weekdays. */
export function recurrenceRule(rule: RecurrenceRule): RecurrenceRule {
  if (rule.kind !== "weekly") return { kind: rule.kind };
  const weekdays = [...new Set(rule.weekdays ?? [])].sort((a, b) => a - b);
  if (weekdays.length === 0) throw new Error("Pick at least one day of the week.");
  if (weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error("Invalid day of the week.");
  return { kind: "weekly", weekdays };
}

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
 * Only active members of the project's team who can access the project may receive work (#46).
 */
export async function assignee(
  ctx: QueryCtx,
  project: Doc<"projects">,
  assigneeId: string | undefined,
): Promise<string | undefined> {
  if (!assigneeId) return undefined;
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_org_user", (q) => q.eq("orgId", project.orgId).eq("userId", assigneeId))
    .unique();
  if (!membership?.active) throw new Error("Assignee is not an active member of this team.");
  if (!(await userCanAccessProject(ctx, project, assigneeId))) {
    throw new Error("Assignee doesn't have access to this project.");
  }
  return assigneeId;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed, lower-cased email; throws if it isn't plausibly an address (#46). */
export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL.test(email)) throw new Error("Enter a valid email address.");
  return email;
}
