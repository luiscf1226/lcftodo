import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { getMember, log, requireMember, requireProject } from "./lib/auth";

export const list = query({
  args: { includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, { includeArchived }) => {
    const member = await getMember(ctx);
    if (!member) return [];
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_org", (q) => q.eq("orgId", member.orgId))
      .collect();
    return projects
      .filter((p) => !p.deleting && (includeArchived || !p.archived))
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
    const [projects, todos] = await Promise.all([
      ctx.db
        .query("projects")
        .withIndex("by_org", (q) => q.eq("orgId", member.orgId))
        .collect(),
      ctx.db
        .query("todos")
        .withIndex("by_org_date", (q) => q.eq("orgId", member.orgId).gte("date", from).lte("date", to))
        .collect(),
    ]);
    type Counts = { todo: number; doing: number; done: number; not_done: number };
    const countsByProject = new Map<Id<"projects">, Counts>();
    for (const t of todos) {
      let counts = countsByProject.get(t.projectId);
      if (!counts) countsByProject.set(t.projectId, (counts = { todo: 0, doing: 0, done: 0, not_done: 0 }));
      counts[t.status]++;
    }
    return projects
      .filter((p) => !p.deleting)
      .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name))
      .map((project) => {
        const counts = countsByProject.get(project._id) ?? { todo: 0, doing: 0, done: 0, not_done: 0 };
        const total = counts.todo + counts.doing + counts.done + counts.not_done;
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
    if (!project || project.orgId !== member.orgId || project.deleting) return null;
    return project;
  },
});

const clean = (s: string | undefined) => s?.trim() || undefined;

export const create = mutation({
  args: { name: v.string(), description: v.optional(v.string()), color: v.string() },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const name = args.name.trim();
    if (!name) throw new Error("Project name is required.");
    const projectId = await ctx.db.insert("projects", {
      orgId: member.orgId,
      name,
      description: clean(args.description),
      color: args.color,
      archived: false,
      createdBy: member.userId,
    });
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
    const name = args.name.trim();
    if (!name) throw new Error("Project name is required.");
    await ctx.db.patch(projectId, { name, description: clean(args.description), color: args.color });
    await log(ctx, member, { ...project, name }, {
      action: "project_updated",
      from: project.name !== name ? project.name : undefined,
      to: project.name !== name ? name : undefined,
    });
  },
});

export const setArchived = mutation({
  args: { projectId: v.id("projects"), archived: v.boolean() },
  handler: async (ctx, { projectId, archived }) => {
    const member = await requireMember(ctx);
    const project = await requireProject(ctx, member, projectId);
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
    if (project.deleting) return; // Already in progress: don't log or schedule twice.
    await ctx.db.patch(projectId, { deleting: true });
    await log(ctx, member, project, { action: "project_deleted" });
    await ctx.scheduler.runAfter(0, internal.projects.deleteBatch, { projectId });
  },
});

const DELETE_BATCH_SIZE = 500;

export const deleteBatch = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project?.deleting) return;
    const todos = await ctx.db
      .query("todos")
      .withIndex("by_project_date", (q) => q.eq("projectId", projectId))
      .take(DELETE_BATCH_SIZE);
    for (const t of todos) await ctx.db.delete(t._id);
    if (todos.length === DELETE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.projects.deleteBatch, { projectId });
    } else {
      await ctx.db.delete(projectId);
    }
  },
});
