import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { log, type Member } from "./auth";
import { addDaysToKey } from "./timezone";

/**
 * Copies every open (todo/doing) item of a project's day to the next day and
 * marks the originals "didn't finish", so the history shows what slipped.
 *
 * Shared by the manual `todos.carryOver` mutation and the nightly cron (#22).
 * `actor.userId` is recorded as the activity actor and the copies' creator.
 * Idempotent: once carried, the originals are no longer open, so a second run
 * for the same day finds nothing to do. Returns the number of todos carried.
 */
export async function carryOverDay(
  ctx: MutationCtx,
  actor: Member,
  project: Doc<"projects">,
  date: string,
): Promise<number> {
  const to = addDaysToKey(date, 1);
  const open = (
    await ctx.db
      .query("todos")
      .withIndex("by_project_date", (q) => q.eq("projectId", project._id).eq("date", date))
      .collect()
  ).filter((t) => t.status === "todo" || t.status === "doing");

  for (const t of open) {
    await ctx.db.patch(t._id, { status: "not_done", completedAt: undefined });
    // Record the "didn't finish" on the original's own history (#33).
    await log(ctx, actor, project, {
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
      createdBy: actor.userId,
      order: t.order,
      carriedFrom: t._id,
    });
    await log(ctx, actor, project, {
      action: "carried_over", todoId: newId, todoTitle: t.title, from: date, to, date: to,
    });
  }
  return open.length;
}
