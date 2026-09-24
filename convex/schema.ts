import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const status = v.union(
  v.literal("todo"),
  v.literal("doing"),
  v.literal("done"),
  v.literal("not_done"),
);

export const action = v.union(
  v.literal("created"),
  v.literal("updated"),
  v.literal("status"),
  v.literal("moved"),
  v.literal("carried_over"),
  v.literal("deleted"),
  v.literal("project_created"),
  v.literal("project_updated"),
  v.literal("project_archived"),
  v.literal("project_restored"),
  v.literal("project_deleted"),
);

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    // When the user checked off the first-run tutorial. Missing = not completed yet.
    onboardingCompletedAt: v.optional(v.number()),
  }).index("by_clerkId", ["clerkId"]),

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
  })
    .index("by_project_date", ["projectId", "date"])
    .index("by_org_date", ["orgId", "date"]),

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
});
