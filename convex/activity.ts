import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { getMember, requireMember } from "./lib/auth";
import { MAX_EXPORT_PAGE_SIZE, MAX_RANGE_DAYS } from "./lib/constants";

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

const DAY_MS = 24 * 60 * 60 * 1000;
// MAX_RANGE_DAYS calendar days, inclusive, plus an hour of slack for a DST shift inside the range.
const MAX_EXPORT_RANGE_MS = MAX_RANGE_DAYS * DAY_MS + 60 * 60 * 1000;
const EXPORT_RANGE_ROW_CAP = 5000;

// Activity rows for [fromMs, toMs], newest first, optionally narrowed to a project and/or actor.
// Every combination is served by an index whose last field is `_creationTime`.
function exportQuery(
  ctx: QueryCtx,
  orgId: string,
  { fromMs, toMs, projectId, actorId }: { fromMs: number; toMs: number; projectId?: Id<"projects">; actorId?: string },
) {
  const activity = ctx.db.query("activity");
  const q = projectId
    ? actorId
      ? activity.withIndex("by_project_actor", (q) =>
          q.eq("projectId", projectId).eq("actorId", actorId).gte("_creationTime", fromMs).lte("_creationTime", toMs),
        )
      : activity.withIndex("by_project", (q) =>
          q.eq("projectId", projectId).gte("_creationTime", fromMs).lte("_creationTime", toMs),
        )
    : actorId
      ? activity.withIndex("by_org_actor", (q) =>
          q.eq("orgId", orgId).eq("actorId", actorId).gte("_creationTime", fromMs).lte("_creationTime", toMs),
        )
      : activity.withIndex("by_org", (q) =>
          q.eq("orgId", orgId).gte("_creationTime", fromMs).lte("_creationTime", toMs),
        );
  return q.order("desc");
}

async function projectInOrg(ctx: QueryCtx, orgId: string, projectId: Id<"projects"> | undefined) {
  if (!projectId) return true;
  const project = await ctx.db.get(projectId);
  return !!project && project.orgId === orgId;
}

// Paginated full activity export. The client calls this repeatedly, passing `continueCursor`
// back as `paginationOpts.cursor`, until `isDone`. `numItems` is clamped to 1,000.
// The range may span at most 366 days.
export const exportPage = query({
  args: {
    fromMs: v.number(),
    toMs: v.number(),
    projectId: v.optional(v.id("projects")),
    actorId: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { paginationOpts, ...range }) => {
    const member = await requireMember(ctx);
    if (!Number.isFinite(range.fromMs) || !Number.isFinite(range.toMs)) throw new Error("Invalid date range.");
    if (range.fromMs > range.toMs) throw new Error("Invalid date range: the start must be before the end.");
    if (range.toMs - range.fromMs > MAX_EXPORT_RANGE_MS) {
      throw new Error(`Date range is too long: export at most ${MAX_RANGE_DAYS} days at a time.`);
    }
    if (!(await projectInOrg(ctx, member.orgId, range.projectId))) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    return await exportQuery(ctx, member.orgId, range).paginate({
      ...paginationOpts,
      numItems: Math.max(1, Math.min(paginationOpts.numItems, MAX_EXPORT_PAGE_SIZE)),
    });
  },
});

// Deprecated: use `exportPage`. Kept for existing callers. Returns every row in the range, or
// throws if there are more than 5,000 instead of silently dropping the rest.
export const exportRange = query({
  args: { fromMs: v.number(), toMs: v.number(), projectId: v.optional(v.id("projects")) },
  handler: async (ctx, { fromMs, toMs, projectId }) => {
    const member = await requireMember(ctx);
    if (!(await projectInOrg(ctx, member.orgId, projectId))) return [];
    const rows = await exportQuery(ctx, member.orgId, { fromMs, toMs, projectId }).take(EXPORT_RANGE_ROW_CAP + 1);
    if (rows.length > EXPORT_RANGE_ROW_CAP) {
      throw new Error(
        "This range has more than 5,000 activity rows. Narrow the date range or filters and try again.",
      );
    }
    return rows;
  },
});
