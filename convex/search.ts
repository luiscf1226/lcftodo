import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { accessibleProjectIds, inScope, requireMember } from "./lib/auth";
import { NO_PROJECT_COLOR, NO_PROJECT_NAME } from "./lib/constants";

export const SEARCH_LIMITS = { query: 100, results: 20 } as const;

// Title search across every project and week of the caller's active team (#26).
// The search index is filtered by orgId, so other teams' todos are never read.
export const todos = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    // Restricted members only find todos of projects they can access (#46), plus their own personal ones.
    const scope = await accessibleProjectIds(ctx, member);
    const text = args.query.trim().slice(0, SEARCH_LIMITS.query);
    if (!text) return [];
    // Over-fetch so hiding todos of deleting (or, for restricted members, inaccessible) projects,
    // and other people's personal todos, rarely shortens the list.
    const hits = await ctx.db
      .query("todos")
      .withSearchIndex("search_title", (q) => q.search("title", text).eq("orgId", member.orgId))
      .take(scope === "all" ? SEARCH_LIMITS.results + 10 : SEARCH_LIMITS.results * 5);

    const projects = new Map<Id<"projects">, Doc<"projects"> | null>();
    for (const id of new Set(hits.flatMap((t) => (t.projectId ? [t.projectId] : [])))) {
      projects.set(id, await ctx.db.get(id));
    }

    const result = (t: Doc<"todos">, project: { name: string; color: string; archived: boolean }) => ({
      _id: t._id,
      title: t.title,
      date: t.date,
      status: t.status,
      assigneeId: t.assigneeId,
      projectId: t.projectId,
      projectName: project.name,
      projectColor: project.color,
      projectArchived: project.archived,
    });
    const personal = { name: NO_PROJECT_NAME, color: NO_PROJECT_COLOR, archived: false };

    return hits
      .flatMap((t) => {
        // Personal todos (no project) are only ever found by their creator.
        if (!t.projectId) return t.createdBy === member.userId ? [result(t, personal)] : [];
        const p = projects.get(t.projectId);
        if (!p || p.orgId !== member.orgId || p.deleting || !inScope(scope, p._id)) return [];
        return [result(t, p)];
      })
      .slice(0, SEARCH_LIMITS.results);
  },
});
