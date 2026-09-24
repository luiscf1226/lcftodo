import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Deletes a todo together with its comments (#24). */
export async function deleteTodo(ctx: MutationCtx, todo: Doc<"todos">) {
  const comments = await ctx.db
    .query("comments")
    .withIndex("by_todo", (q) => q.eq("todoId", todo._id))
    .collect();
  for (const c of comments) await ctx.db.delete(c._id);
  await ctx.db.delete(todo._id);
}
