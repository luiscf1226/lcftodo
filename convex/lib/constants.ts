// Single source of truth for values shared by the Convex schema, server-side
// validation and the UI (#37, #29). Keep this file free of server-only imports
// so the Next.js app can import it directly.

export const STATUSES = ["todo", "doing", "done", "not_done"] as const;
export type Status = (typeof STATUSES)[number];

export const ACTIONS = [
  "created",
  "updated",
  "status",
  "moved",
  "carried_over",
  "deleted",
  "project_created",
  "project_updated",
  "project_archived",
  "project_restored",
  "project_deleted",
  "commented",
] as const;
export type Action = (typeof ACTIONS)[number];

/** A zeroed counter for every status. */
export const emptyStatusCounts = (): Record<Status, number> =>
  Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;

// Text limits enforced by mutations and mirrored by the UI's maxLength.
export const LIMITS = {
  todoTitle: 300,
  todoNotes: 5000,
  projectName: 80,
  projectDescription: 500,
  comment: 2000,
} as const;

// Recurring todos (#23). Weekdays use JavaScript's numbering: 0 = Sunday … 6 = Saturday.
export const RECURRENCE_KINDS = ["daily", "weekdays", "weekly"] as const;
export type RecurrenceKind = (typeof RECURRENCE_KINDS)[number];
export type RecurrenceRule = { kind: RecurrenceKind; weekdays?: number[] };

// Longest range one `recurrences.ensureOccurrences` call may fill (a week view needs 7).
export const MAX_GENERATE_DAYS = 31;

// Project palette. `color` is rendered into inline styles, so only these are accepted.
export const PROJECT_COLORS = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#64748b",
] as const;

// Longest inclusive day range a team-wide query or export may span (#15).
export const MAX_RANGE_DAYS = 366;

// Rows per `activity.exportPage` call; larger requests are clamped to this.
export const MAX_EXPORT_PAGE_SIZE = 1000;

// Actor id recorded for changes made by scheduled jobs (e.g. nightly carry-over, #22).
// The UI renders it as "System".
export const SYSTEM_ACTOR_ID = "system";
export const SYSTEM_ACTOR_NAME = "System";

// Clerk organization invitation states mirrored in `projectInvitations` (#46).
export const INVITATION_STATUSES = ["pending", "accepted", "revoked", "expired"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

// Roles an admin may pick when inviting someone (#46). Anything else is rejected server-side.
export const INVITE_ROLES = ["org:member", "org:admin"] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

// Most projects a single invitation may grant.
export const MAX_INVITE_PROJECTS = 50;
