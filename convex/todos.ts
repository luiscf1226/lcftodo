import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
  accessibleProjectIds, canReadProject, getMember, inScope, log, requireMember, requireTodo, requireWritableProject,
} from "./lib/auth";
import { carryOverDay } from "./lib/carryOver";
import { assignee, checkDate, checkRange, todoNotes, todoTitle } from "./lib/validate";
import { status } from "./schema";

const byOrder = (a: Doc<"todos">, b: Doc<"todos">) => a.order - b.order;

export const listForProject = query({
  args: { projectId: v.id("projects"), from: v.string(), to: v.string() },
  handler: async (ctx, { projectId, from, to }) => {
    const member = await getMember(ctx);
    if (!member) return [];
    const project = await ctx.db.get(projectId);
    if (!(await canReadProject(ctx, member, project))) return [];
    checkRange(from, to);
    const todos = await ctx.db
      .query("todos")
      .withIndex("by_project_date", (q) =>
        q.eq("projectId", projectId).gte("date", from).lte("date", to),
      )
      .collect();
    return todos.sort(byOrder);
  },
});

// All todos in the team for a date range, joined with their project.
// The range is capped (see checkRange) so the query stays bounded (#15).
export const listForTeam = query({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    const member = await getMember(ctx);
    if (!member) return [];
    checkRange(from, to);
    const [todos, projects, scope] = await Promise.all([
      ctx.db
        .query("todos")
        .withIndex("by_org_date", (q) =>
          q.eq("orgId", member.orgId).gte("date", from).lte("date", to),
        )
        .collect(),
      ctx.db
        .query("projects")
        .withIndex("by_org", (q) => q.eq("orgId", member.orgId))
        .collect(),
      accessibleProjectIds(ctx, member),
    ]);
    // Only projects the caller may read (#46); a restricted member never sees other projects' rows.
    const byId = new Map(projects.filter((p) => !p.deleting && inScope(scope, p._id)).map((p) => [p._id, p]));
    return todos
      .filter((t) => byId.has(t.projectId))
      .sort((a, b) => a.date.localeCompare(b.date) || byOrder(a, b))
      .map((t) => {
        const p = byId.get(t.projectId);
        return {
          ...t,
          projectName: p?.name ?? "—",
          projectColor: p?.color ?? "#94a3b8",
          // Archived projects are read-only (#18); the UI disables editing for these.
          projectArchived: p?.archived ?? false,
        };
      });
  },
});

// A single todo of the caller's team, or null. Used to resolve `carriedFrom` links (#33).
export const get = query({
  args: { todoId: v.id("todos") },
  handler: async (ctx, { todoId }) => {
    const member = await getMember(ctx);
    if (!member) return null;
    const todo = await ctx.db.get(todoId);
    if (!todo || todo.orgId !== member.orgId) return null;
    const project = await ctx.db.get(todo.projectId);
    return (await canReadProject(ctx, member, project)) ? todo : null;
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    date: v.string(),
    notes: v.optional(v.string()),
    assigneeId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const project = await requireWritableProject(ctx, member, args.projectId);
    checkDate(args.date);
    const title = todoTitle(args.title);
    const notes = todoNotes(args.notes);
    const assigneeId = await assignee(ctx, project, args.assigneeId);
    const todoId = await ctx.db.insert("todos", {
      orgId: member.orgId,
      projectId: project._id,
      title,
      notes,
      date: args.date,
      status: "todo",
      assigneeId,
      createdBy: member.userId,
      order: Date.now(),
    });
    await log(ctx, member, project, { action: "created", todoId, todoTitle: title, date: args.date });
    return todoId;
  },
});

export const update = mutation({
  args: {
    todoId: v.id("todos"),
    title: v.string(),
    notes: v.optional(v.string()),
    date: v.string(),
    assigneeId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const todo = await requireTodo(ctx, member, args.todoId);
    const project = await requireWritableProject(ctx, member, todo.projectId);
    checkDate(args.date);
    const title = todoTitle(args.title);
    const notes = todoNotes(args.notes);
    // Preserve a historical assignee when editing other fields, even if their team membership
    // or project access has since been removed (#46); only a new assignee is validated.
    const assigneeId =
      args.assigneeId && args.assigneeId === todo.assigneeId ? todo.assigneeId : await assignee(ctx, project, args.assigneeId);
    await ctx.db.patch(todo._id, { title, notes, date: args.date, assigneeId });

    if (todo.date !== args.date) {
      await log(ctx, member, project, {
        action: "moved", todoId: todo._id, todoTitle: title, from: todo.date, to: args.date, date: args.date,
      });
    }
    if (todo.title !== title || todo.notes !== notes || todo.assigneeId !== assigneeId) {
      await log(ctx, member, project, {
        action: "updated",
        todoId: todo._id,
        todoTitle: title,
        from: todo.title !== title ? todo.title : undefined,
        to: todo.title !== title ? title : undefined,
        date: args.date,
      });
    }
  },
});

export const setStatus = mutation({
  args: { todoId: v.id("todos"), status },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const todo = await requireTodo(ctx, member, args.todoId);
    const project = await requireWritableProject(ctx, member, todo.projectId);
    if (todo.status === args.status) return;
    await ctx.db.patch(todo._id, {
      status: args.status,
      completedAt: args.status === "done" ? Date.now() : undefined,
    });
    await log(ctx, member, project, {
      action: "status", todoId: todo._id, todoTitle: todo.title, from: todo.status, to: args.status, date: todo.date,
    });
  },
});

export const remove = mutation({
  args: { todoId: v.id("todos") },
  handler: async (ctx, { todoId }) => {
    const member = await requireMember(ctx);
    const todo = await requireTodo(ctx, member, todoId);
    const project = await requireWritableProject(ctx, member, todo.projectId);
    await ctx.db.delete(todo._id);
    await log(ctx, member, project, {
      action: "deleted", todoId: todo._id, todoTitle: todo.title, from: todo.status, date: todo.date,
    });
  },
});

// Copies every open (todo/doing) item of a project's day to the next day and
// marks the originals "didn't finish", so the history shows what slipped.
// The nightly cron shares this logic via carryOverDay (#22).
export const carryOver = mutation({
  args: { projectId: v.id("projects"), date: v.string() },
  handler: async (ctx, { projectId, date }) => {
    const member = await requireMember(ctx);
    const project = await requireWritableProject(ctx, member, projectId);
    checkDate(date);
    return await carryOverDay(ctx, member, project, date);
  },
});
