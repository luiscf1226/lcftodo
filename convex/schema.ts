import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { ACTIONS, INVITATION_STATUSES, RECURRENCE_KINDS, STATUSES } from "./lib/constants";

// Validators are derived from the shared constants so a new status or action
// is added in one place (#37).
const literals = <T extends string>(values: readonly T[]) => v.union(...values.map((value) => v.literal(value)));

export const status = literals(STATUSES);
export const action = literals(ACTIONS);
export const invitationStatus = literals(INVITATION_STATUSES);
export const recurrenceRule = v.object({
  kind: literals(RECURRENCE_KINDS),
  // Only for "weekly": the chosen days, 0 = Sunday … 6 = Saturday.
  weekdays: v.optional(v.array(v.number())),
});

export default defineSchema({
  memberships: defineTable({
    orgId: v.string(),
    userId: v.string(),
    role: v.string(),
    active: v.boolean(),
    // Clerk's immutable membership id and timestamps (ms); a re-invite gets a new id.
    membershipId: v.optional(v.string()),
    membershipCreatedAt: v.optional(v.number()),
    lastEventAt: v.optional(v.number()),
    updatedAt: v.number(),
    backfillRunId: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_user", ["orgId", "userId"])
    .index("by_user", ["userId"]),

  // Clerk deletions are terminal for a membership or user id, so retried older events are ignored.
  tombstones: defineTable({
    kind: v.union(v.literal("membership"), v.literal("user")),
    clerkId: v.string(),
  }).index("by_kind_clerkId", ["kind", "clerkId"]),

  membershipSync: defineTable({
    orgId: v.string(),
    ready: v.boolean(),
    backfilledAt: v.number(),
  }).index("by_org", ["orgId"]),

  // Per-team settings (#21, #22). One row per org, created on the first admin save.
  teamSettings: defineTable({
    orgId: v.string(),
    // IANA zone, e.g. "Europe/Madrid". Missing = each browser uses its own zone.
    timeZone: v.optional(v.string()),
    autoCarryOver: v.boolean(),
    // Team-local day ("YYYY-MM-DD") the nightly carry-over last ran for; keeps the cron idempotent.
    lastAutoCarryDate: v.optional(v.string()),
    // Project access policy (#46). Missing/false = open: every member sees every project
    // (the default, and the state of every team that existed before #46). Once an admin
    // restricts it, non-admin members only see projects they have a `projectMemberships` row for.
    restrictedProjectAccess: v.optional(v.boolean()),
    updatedBy: v.string(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_autoCarryOver", ["autoCarryOver"]),

  users: defineTable({
    clerkId: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    // Clerk's `updated_at` (ms) of the last applied profile webhook.
    clerkUpdatedAt: v.optional(v.number()),
    // When the user checked off the first-run tutorial. Missing = not completed yet.
    onboardingCompletedAt: v.optional(v.number()),
  })
    .index("by_clerkId", ["clerkId"])
    .index("by_email", ["email"]),

  // Explicit project access grants (#46). Only enforced while the team is restricted.
  projectMemberships: defineTable({
    orgId: v.string(),
    projectId: v.id("projects"),
    userId: v.string(),
    grantedBy: v.string(),
    grantedAt: v.number(),
  })
    .index("by_project_user", ["projectId", "userId"])
    .index("by_org_user", ["orgId", "userId"])
    .index("by_org", ["orgId"]),

  // Project grants attached to a Clerk organization invitation (#46). Applied exactly once,
  // when Clerk reports the invitation accepted (or the invitee's membership is created).
  projectInvitations: defineTable({
    orgId: v.string(),
    // Clerk's organization invitation id; replaced when the invitation is resent.
    invitationId: v.string(),
    // Normalized (trimmed, lower-case) email.
    email: v.string(),
    role: v.string(),
    projectIds: v.array(v.id("projects")),
    status: invitationStatus,
    invitedBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.optional(v.number()),
    // Set once the grants were applied; guarantees exactly-once application.
    appliedAt: v.optional(v.number()),
    acceptedUserId: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_invitation", ["invitationId"])
    .index("by_org_email", ["orgId", "email"]),

  projects: defineTable({
    orgId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    color: v.string(),
    archived: v.boolean(),
    createdBy: v.string(),
    // Set by projects.remove; the project is hidden and its todos are being deleted in batches.
    deleting: v.optional(v.boolean()),
  }).index("by_org", ["orgId"]),

  todos: defineTable({
    orgId: v.string(),
    projectId: v.id("projects"),
    title: v.string(),
    notes: v.optional(v.string()),
    // Local calendar day, "YYYY-MM-DD".
    date: v.string(),
    status,
    assigneeId: v.optional(v.string()),
    createdBy: v.string(),
    order: v.number(),
    completedAt: v.optional(v.number()),
    carriedFrom: v.optional(v.id("todos")),
    // Denormalized count of `comments` rows, shown on the card (#24). Missing = 0.
    commentCount: v.optional(v.number()),
    // Recurring occurrences (#23): the series and the day it was generated for. `recurrenceDate`
    // stays put when the occurrence is moved, so generation never re-creates it.
    recurrenceId: v.optional(v.id("recurrences")),
    recurrenceDate: v.optional(v.string()),
    // Set when this one occurrence was edited on its own; series edits then leave it alone.
    recurrenceDetached: v.optional(v.boolean()),
  })
    .index("by_project_date", ["projectId", "date"])
    .index("by_recurrence", ["recurrenceId", "recurrenceDate"])
    .index("by_org_date", ["orgId", "date"])
    // Full-text search on titles, always scoped to one team (#26).
    .searchIndex("search_title", { searchField: "title", filterFields: ["orgId"] }),

  activity: defineTable({
    orgId: v.string(),
    projectId: v.id("projects"),
    projectName: v.string(),
    todoId: v.optional(v.id("todos")),
    todoTitle: v.optional(v.string()),
    actorId: v.string(),
    action,
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    date: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_actor", ["orgId", "actorId"])
    .index("by_project", ["projectId"])
    .index("by_project_actor", ["projectId", "actorId"])
    .index("by_todo", ["todoId"]),

  // Comments on a todo (#24). Deleted with their todo.
  comments: defineTable({
    orgId: v.string(),
    projectId: v.id("projects"),
    todoId: v.id("todos"),
    authorId: v.string(),
    body: v.string(),
    editedAt: v.optional(v.number()),
  })
    .index("by_todo", ["todoId"])
    .index("by_project", ["projectId"]),

  // Recurring todo series (#23). Occurrences are ordinary todos with `recurrenceId`.
  recurrences: defineTable({
    orgId: v.string(),
    projectId: v.id("projects"),
    title: v.string(),
    notes: v.optional(v.string()),
    assigneeId: v.optional(v.string()),
    rule: recurrenceRule,
    // First day occurrences are generated for. Moved forward when the rule changes, so a new
    // rule never back-fills days before the edit.
    startDate: v.string(),
    // Set by `stop`: no occurrences on or after this day.
    stoppedFrom: v.optional(v.string()),
    // Days whose occurrence was deleted on its own; generation skips them.
    skipDates: v.optional(v.array(v.string())),
    createdBy: v.string(),
  })
    .index("by_org", ["orgId"])
    .index("by_project", ["projectId"]),
});
