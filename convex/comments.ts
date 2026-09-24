import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import {
  canReadProject,
  getMember,
  log,
  requireMember,
  requireTodo,
  requireWritableProject,
  type Member,
} from "./lib/auth";
import { commentBody } from "./lib/validate";

// Upper bound on a single thread read; threads are short in practice.
const MAX_THREAD = 500;

// A todo's comment thread, oldest first, with per-comment permissions for the caller.
// Realtime: Convex re-runs this query whenever a comment in the thread changes.
export const list = query({
  args: { todoId: v.id("todos") },
  handler: async (ctx, { todoId }) => {
    const member = await getMember(ctx);
    if (!member) return [];
    const todo = await ctx.db.get(todoId);
    if (!todo || todo.orgId !== member.orgId) return [];
    const project = await ctx.db.get(todo.projectId);
    // Includes the project access check (#46).
    if (!project || !(await canReadProject(ctx, member, project))) return [];
    const writable = !project.archived;
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_todo", (q) => q.eq("todoId", todoId))
      .take(MAX_THREAD);
    return comments.map((c) => ({
      ...c,
      canEdit: writable && c.authorId === member.userId,
      canDelete: writable && (c.authorId === member.userId || member.isAdmin),
    }));
  },
});

export const add = mutation({
  args: { todoId: v.id("todos"), body: v.string() },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const todo = await requireTodo(ctx, member, args.todoId);
    const project = await requireWritableProject(ctx, member, todo.projectId);
    const body = commentBody(args.body);
    const commentId = await ctx.db.insert("comments", {
      orgId: member.orgId,
      projectId: todo.projectId,
      todoId: todo._id,
      authorId: member.userId,
      body,
    });
    await ctx.db.patch(todo._id, { commentCount: (todo.commentCount ?? 0) + 1 });
    await log(ctx, member, project, { action: "commented", todoId: todo._id, todoTitle: todo.title, date: todo.date });
    return commentId;
  },
});

// Loads a comment of the caller's team whose project is still writable (archived = read-only).
async function requireComment(ctx: MutationCtx, member: Member, commentId: Id<"comments">) {
  const comment = await ctx.db.get(commentId);
  if (!comment || comment.orgId !== member.orgId) throw new Error("Comment not found.");
  // A comment in a project the caller can't access reads as missing (#46).
  if (!(await canReadProject(ctx, member, await ctx.db.get(comment.projectId)))) throw new Error("Comment not found.");
  await requireWritableProject(ctx, member, comment.projectId);
  return comment;
}

// Only the author may edit a comment.
export const edit = mutation({
  args: { commentId: v.id("comments"), body: v.string() },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const comment = await requireComment(ctx, member, args.commentId);
    if (comment.authorId !== member.userId) throw new Error("You can only edit your own comments.");
    const body = commentBody(args.body);
    if (body === comment.body) return;
    await ctx.db.patch(comment._id, { body, editedAt: Date.now() });
  },
});

// The author, or a team admin, may delete a comment.
export const remove = mutation({
  args: { commentId: v.id("comments") },
  handler: async (ctx, { commentId }) => {
    const member = await requireMember(ctx);
    const comment = await requireComment(ctx, member, commentId);
    if (comment.authorId !== member.userId && !member.isAdmin) {
      throw new Error("Only the author or a team admin can delete this comment.");
    }
    await ctx.db.delete(comment._id);
    const todo = await ctx.db.get(comment.todoId);
    if (todo) await ctx.db.patch(todo._id, { commentCount: Math.max(0, (todo.commentCount ?? 1) - 1) });
  },
});
