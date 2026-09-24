import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import {
  accessibleProjectIds,
  canReadProject,
  getMember,
  inScope,
  log,
  requireMember,
  requireProject,
} from "./lib/auth";
import { emptyStatusCounts, STATUSES, type Status } from "./lib/constants";
import { checkRange, projectColor, projectDescription, projectName } from "./lib/validate";

export const list = query({
  args: { includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, { includeArchived }) => {
    const member = await getMember(ctx);
    if (!member) return [];
    const [projects, scope] = await Promise.all([
      ctx.db
        .query("projects")
        .withIndex("by_org", (q) => q.eq("orgId", member.orgId))
        .collect(),
      accessibleProjectIds(ctx, member),
    ]);
    return projects
      .filter((p) => !p.deleting && (includeArchived || !p.archived) && inScope(scope, p._id))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

// Projects with todo counts by status for a date range (inclusive).
// One projects read + one `todos.by_org_date` range read, grouped in memory (no N+1).
export const listWithStats = query({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    const member = await getMember(ctx);
    if (!member) return [];
    checkRange(from, to);
    const [projects, todos, scope] = await Promise.all([
      ctx.db
        .query("projects")
        .withIndex("by_org", (q) => q.eq("orgId", member.orgId))
        .collect(),
      ctx.db
        .query("todos")
        .withIndex("by_org_date", (q) => q.eq("orgId", member.orgId).gte("date", from).lte("date", to))
        .collect(),
      accessibleProjectIds(ctx, member),
    ]);
    const countsByProject = new Map<Id<"projects">, Record<Status, number>>();
    for (const t of todos) {
      if (!inScope(scope, t.projectId)) continue;
      let counts = countsByProject.get(t.projectId);
      if (!counts) countsByProject.set(t.projectId, (counts = emptyStatusCounts()));
      counts[t.status]++;
    }
    return projects
      .filter((p) => !p.deleting && inScope(scope, p._id))
      .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name))
      .map((project) => {
        const counts = countsByProject.get(project._id) ?? emptyStatusCounts();
        const total = STATUSES.reduce((sum, s) => sum + counts[s], 0);
        return { ...project, counts, total };
      });
  },
});

export const get = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const member = await getMember(ctx);
    if (!member) return null;
    const project = await ctx.db.get(projectId);
    return (await canReadProject(ctx, member, project)) ? project : null;
  },
});

export const create = mutation({
  args: { name: v.string(), description: v.optional(v.string()), color: v.string() },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const name = projectName(args.name);
    const description = projectDescription(args.description);
    const color = projectColor(args.color);
    const projectId = await ctx.db.insert("projects", {
      orgId: member.orgId,
      name,
      description,
      color,
      archived: false,
      createdBy: member.userId,
    });
    // The creator keeps access to their own project if the team restricts access later (#46).
    if (!member.isAdmin) {
      await ctx.db.insert("projectMemberships", {
        orgId: member.orgId,
        projectId,
        userId: member.userId,
        grantedBy: member.userId,
        grantedAt: Date.now(),
      });
    }
    const project = (await ctx.db.get(projectId))!;
    await log(ctx, member, project, { action: "project_created" });
    return projectId;
  },
});

export const update = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    description: v.optional(v.string()),
    color: v.string(),
  },
  handler: async (ctx, { projectId, ...args }) => {
    const member = await requireMember(ctx);
    const project = await requireProject(ctx, member, projectId);
    if (project.deleting) throw new Error("This project is being deleted.");
    const name = projectName(args.name);
    const description = projectDescription(args.description);
    // A project created before the palette check keeps its color until it is changed.
    const color = args.color === project.color ? project.color : projectColor(args.color);
    await ctx.db.patch(projectId, { name, description, color });
    await log(
      ctx,
      member,
      { ...project, name },
      {
        action: "project_updated",
        from: project.name !== name ? project.name : undefined,
        to: project.name !== name ? name : undefined,
      },
    );
  },
});

// Admin only, like delete.
export const setArchived = mutation({
  args: { projectId: v.id("projects"), archived: v.boolean() },
  handler: async (ctx, { projectId, archived }) => {
    const member = await requireMember(ctx);
    if (!member.isAdmin) throw new Error("Only team admins can archive or restore projects.");
    const project = await requireProject(ctx, member, projectId);
    if (project.deleting) throw new Error("This project is being deleted.");
    await ctx.db.patch(projectId, { archived });
    await log(ctx, member, project, { action: archived ? "project_archived" : "project_restored" });
  },
});

// Admin only. Todos are removed; the activity log is kept so history survives.
// The project is marked `deleting` (hidden from every project query) and `project_deleted` is
// logged here, once. Todos are then deleted in batches by `deleteBatch` so large projects never
// exceed Convex's per-transaction limits; the project doc itself is deleted last.
export const remove = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const member = await requireMember(ctx);
    if (!member.isAdmin) throw new Error("Only team admins can delete projects.");
    const project = await requireProject(ctx, member, projectId);
    // Retrying an in-progress delete doesn't log twice, but it does re-schedule the batches so a
    // failed batch chain can't leave the project hidden forever. `deleteBatch` is idempotent.
    if (!project.deleting) {
      await ctx.db.patch(projectId, { deleting: true });
      await log(ctx, member, project, { action: "project_deleted" });
    }
    await ctx.scheduler.runAfter(0, internal.projects.deleteBatch, { projectId });
  },
});

const DELETE_BATCH_SIZE = 500;

export const deleteBatch = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project?.deleting) return;
    // Comments (#24) and recurring series (#23) go first, then todos, each in bounded batches.
    const [comments, series] = await Promise.all([
      ctx.db
        .query("comments")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(DELETE_BATCH_SIZE),
      ctx.db
        .query("recurrences")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(DELETE_BATCH_SIZE),
    ]);
    for (const row of [...comments, ...series]) await ctx.db.delete(row._id);
    if (comments.length === DELETE_BATCH_SIZE || series.length === DELETE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.projects.deleteBatch, { projectId });
      return;
    }
    const todos = await ctx.db
      .query("todos")
      .withIndex("by_project_date", (q) => q.eq("projectId", projectId))
      .take(DELETE_BATCH_SIZE);
    for (const t of todos) await ctx.db.delete(t._id);
    if (todos.length === DELETE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.projects.deleteBatch, { projectId });
    } else {
      // Access grants go with the project (#46). Pending invitations just skip missing ids.
      const grants = await ctx.db
        .query("projectMemberships")
        .withIndex("by_project_user", (q) => q.eq("projectId", projectId))
        .collect();
      for (const g of grants) await ctx.db.delete(g._id);
      await ctx.db.delete(projectId);
    }
  },
});
