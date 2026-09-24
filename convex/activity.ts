import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { getMember, requireMember } from "./lib/auth";

export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    projectId: v.optional(v.id("projects")),
    actorId: v.optional(v.string()),
  },
  handler: async (ctx, { paginationOpts, projectId, actorId }) => {
    const member = await requireMember(ctx);
    // Every filter combination is served by an index (no `.filter()`), so pages are never
    // sparse: a page scans only matching rows.
    let q;
    if (projectId) {
      const project = await ctx.db.get(projectId);
      if (!project || project.orgId !== member.orgId) {
        return { page: [], isDone: true, continueCursor: "" };
      }
      q = actorId
        ? ctx.db
            .query("activity")
            .withIndex("by_project_actor", (q) => q.eq("projectId", projectId).eq("actorId", actorId))
        : ctx.db.query("activity").withIndex("by_project", (q) => q.eq("projectId", projectId));
    } else {
      q = actorId
        ? ctx.db
            .query("activity")
            .withIndex("by_org_actor", (q) => q.eq("orgId", member.orgId).eq("actorId", actorId))
        : ctx.db.query("activity").withIndex("by_org", (q) => q.eq("orgId", member.orgId));
    }
    return await q.order("desc").paginate(paginationOpts);
  },
});

export const forTodo = query({
  args: { todoId: v.id("todos") },
  handler: async (ctx, { todoId }) => {
    const member = await getMember(ctx);
    if (!member) return [];
    const entries = await ctx.db
      .query("activity")
      .withIndex("by_todo", (q) => q.eq("todoId", todoId))
      .order("desc")
      .take(100);
    return entries.filter((e) => e.orgId === member.orgId);
  },
});

// Full activity log in a time range, for export. Capped to keep the query bounded.
export const exportRange = query({
  args: { fromMs: v.number(), toMs: v.number(), projectId: v.optional(v.id("projects")) },
  handler: async (ctx, { fromMs, toMs, projectId }) => {
    const member = await requireMember(ctx);
    const rows = await ctx.db
      .query("activity")
      .withIndex("by_org", (q) =>
        q.eq("orgId", member.orgId).gte("_creationTime", fromMs).lte("_creationTime", toMs),
      )
      .order("desc")
      .take(5000);
    return projectId ? rows.filter((r) => r.projectId === projectId) : rows;
  },
});
