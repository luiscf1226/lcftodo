import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireMember } from "./lib/auth";
import { MAX_EXPORT_PAGE_SIZE, TEAM_EXPORT_TABLES } from "./lib/constants";

const table = v.union(...TEAM_EXPORT_TABLES.map((name) => v.literal(name)));

/**
 * Admin-only full team export, all time (#36). The client calls this once per table, passing
 * `continueCursor` back as `paginationOpts.cursor` until `isDone`. `numItems` is clamped to 1,000.
 * Every table is read through an index keyed on the caller's `orgId`, so another team's rows are
 * never read, let alone returned.
 */
export const teamExportPage = query({
  args: { table, paginationOpts: paginationOptsValidator },
  handler: async (ctx, { table, paginationOpts }) => {
    const member = await requireMember(ctx);
    if (!member.isAdmin) throw new Error("Only team admins can export all team data.");
    const orgId = member.orgId;
    const opts = { ...paginationOpts, numItems: Math.max(1, Math.min(paginationOpts.numItems, MAX_EXPORT_PAGE_SIZE)) };
    switch (table) {
      case "teamSettings":
        return await ctx.db
          .query("teamSettings")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .paginate(opts);
      case "projects":
        return await ctx.db
          .query("projects")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .paginate(opts);
      case "todos":
        return await ctx.db
          .query("todos")
          .withIndex("by_org_date", (q) => q.eq("orgId", orgId))
          .paginate(opts);
      case "recurrences":
        return await ctx.db
          .query("recurrences")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .paginate(opts);
      case "comments":
        return await ctx.db
          .query("comments")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .paginate(opts);
      case "activity":
        return await ctx.db
          .query("activity")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .paginate(opts);
      case "memberships":
        return await ctx.db
          .query("memberships")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .paginate(opts);
      case "projectMemberships":
        return await ctx.db
          .query("projectMemberships")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .paginate(opts);
      case "projectInvitations":
        return await ctx.db
          .query("projectInvitations")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .paginate(opts);
      default: {
        // Compile-time check that every TEAM_EXPORT_TABLES entry has a case above.
        const unhandled: never = table;
        throw new Error(`Unknown table: ${String(unhandled)}`);
      }
    }
  },
});
