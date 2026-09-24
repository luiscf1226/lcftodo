import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { isRestricted, log, userCanAccessProject, type Member } from "./auth";
import { matchesRule } from "./recurrence";
import { addDaysToKey } from "./timezone";

/** True if the recurring series is active and has an occurrence day on `date` (#23). */
async function seriesRecursOn(ctx: MutationCtx, recurrenceId: Id<"recurrences">, date: string) {
  const rec = await ctx.db.get(recurrenceId);
  if (!rec || date < rec.startDate || (rec.stoppedFrom && date >= rec.stoppedFrom)) return false;
  return matchesRule(rec.rule, date) && !rec.skipDates?.includes(date);
}

/**
 * Copies every open (todo/doing) item of a project's day to the next day and
 * marks the originals "didn't finish", so the history shows what slipped.
 *
 * Shared by the manual `todos.carryOver` mutation and the nightly cron (#22).
 * `actor.userId` is recorded as the activity actor and the copies' creator.
 * Idempotent: once carried, the originals are no longer open, so a second run
 * for the same day finds nothing to do. Returns the number of todos carried
 * (marked "didn't finish"; recurring ones may be replaced by tomorrow's occurrence instead of copied).
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

  // The original keeps its (historical) assignee, but new work is only carried to people who
  // can still access the project; other copies are left unassigned for an admin to reassign (#46).
  const restricted = await isRestricted(ctx, project.orgId);
  const eligible = new Map<string, boolean>();
  const carriedAssignee = async (assigneeId: string | undefined) => {
    if (!assigneeId || !restricted) return assigneeId;
    if (!eligible.has(assigneeId)) eligible.set(assigneeId, await userCanAccessProject(ctx, project, assigneeId));
    return eligible.get(assigneeId) ? assigneeId : undefined;
  };

  for (const t of open) {
    await ctx.db.patch(t._id, { status: "not_done", completedAt: undefined });
    // Record the "didn't finish" on the original's own history (#33).
    await log(ctx, actor, project, {
      action: "status", todoId: t._id, todoTitle: t.title, from: t.status, to: "not_done", date,
    });
    // A recurring todo whose series already has an occurrence tomorrow isn't copied (#23):
    // tomorrow's occurrence takes its place, so a missed daily standup doesn't pile up.
    if (t.recurrenceId && (await seriesRecursOn(ctx, t.recurrenceId, to))) continue;
    const newId = await ctx.db.insert("todos", {
      orgId: t.orgId,
      projectId: t.projectId,
      title: t.title,
      notes: t.notes,
      date: to,
      status: t.status,
      assigneeId: await carriedAssignee(t.assigneeId),
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
