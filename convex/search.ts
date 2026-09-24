import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { requireMember } from "./lib/auth";

export const SEARCH_LIMITS = { query: 100, results: 20 } as const;

// Title search across every project and week of the caller's active team (#26).
// The search index is filtered by orgId, so other teams' todos are never read.
export const todos = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const text = args.query.trim().slice(0, SEARCH_LIMITS.query);
    if (!text) return [];
    // Over-fetch a little so hiding todos of projects being deleted rarely shortens the list.
    const hits = await ctx.db
      .query("todos")
      .withSearchIndex("search_title", (q) => q.search("title", text).eq("orgId", member.orgId))
      .take(SEARCH_LIMITS.results + 10);

    const projects = new Map<Id<"projects">, Doc<"projects"> | null>();
    for (const id of new Set(hits.map((t) => t.projectId))) projects.set(id, await ctx.db.get(id));

    return hits
      .flatMap((t) => {
        const p = projects.get(t.projectId);
        if (!p || p.orgId !== member.orgId || p.deleting) return [];
        return [{
          _id: t._id,
          title: t.title,
          date: t.date,
          status: t.status,
          assigneeId: t.assigneeId,
          projectId: t.projectId,
          projectName: p.name,
          projectColor: p.color,
          projectArchived: p.archived,
        }];
      })
      .slice(0, SEARCH_LIMITS.results);
  },
});
