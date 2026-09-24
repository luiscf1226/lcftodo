import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { getMember, log, requireMember, requireTodo, requireWritableProject } from "./lib/auth";
import { assignee, checkDate, todoNotes, todoTitle } from "./lib/validate";
import { status } from "./schema";

function nextDay(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const byOrder = (a: Doc<"todos">, b: Doc<"todos">) => a.order - b.order;

export const listForProject = query({
  args: { projectId: v.id("projects"), from: v.string(), to: v.string() },
  handler: async (ctx, { projectId, from, to }) => {
    const member = await getMember(ctx);
    if (!member) return [];
    const project = await ctx.db.get(projectId);
    if (!project || project.orgId !== member.orgId) return [];
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
export const listForTeam = query({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    const member = await getMember(ctx);
    if (!member) return [];
    const [todos, projects] = await Promise.all([
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
    ]);
    const byId = new Map(projects.map((p) => [p._id, p]));
    return todos
      .sort((a, b) => a.date.localeCompare(b.date) || byOrder(a, b))
      .map((t) => {
        const p = byId.get(t.projectId);
        return { ...t, projectName: p?.name ?? "—", projectColor: p?.color ?? "#94a3b8" };
      });
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
    const assigneeId = await assignee(ctx, args.assigneeId);
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
    const assigneeId = await assignee(ctx, args.assigneeId);
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
export const carryOver = mutation({
  args: { projectId: v.id("projects"), date: v.string() },
  handler: async (ctx, { projectId, date }) => {
    const member = await requireMember(ctx);
    const project = await requireWritableProject(ctx, member, projectId);
    checkDate(date);
    const to = nextDay(date);
    const open = (
      await ctx.db
        .query("todos")
        .withIndex("by_project_date", (q) => q.eq("projectId", projectId).eq("date", date))
        .collect()
    ).filter((t) => t.status === "todo" || t.status === "doing");

    for (const t of open) {
      await ctx.db.patch(t._id, { status: "not_done", completedAt: undefined });
      // Record the "didn't finish" on the original's own history (#33).
      await log(ctx, member, project, {
        action: "status", todoId: t._id, todoTitle: t.title, from: t.status, to: "not_done", date,
      });
      const newId = await ctx.db.insert("todos", {
        orgId: t.orgId,
        projectId: t.projectId,
        title: t.title,
        notes: t.notes,
        date: to,
        status: t.status,
        assigneeId: t.assigneeId,
        createdBy: member.userId,
        order: t.order,
        carriedFrom: t._id,
      });
      await log(ctx, member, project, {
        action: "carried_over", todoId: newId, todoTitle: t.title, from: date, to, date: to,
      });
    }
    return open.length;
  },
});
