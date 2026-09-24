import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { getMember, requireMember, requireWritableProject, type Member } from "./lib/auth";
import { deleteTodo } from "./lib/cascade";
import { MAX_GENERATE_DAYS } from "./lib/constants";
import { addDays, daysBetween, matchesRule } from "./lib/recurrence";
import { assignee, checkDate, checkRange, recurrenceRule, todoNotes, todoTitle } from "./lib/validate";
import { recurrenceRule as ruleValidator } from "./schema";

// Recurring todos (#23).
//
// A series lives in `recurrences`; each occurrence is an ordinary todo carrying `recurrenceId` and
// `recurrenceDate` (the day it was generated for). Occurrences are generated on demand by
// `ensureOccurrences`, which every board calls for the range it shows. Generation is idempotent:
// a day is filled only if no todo exists for (recurrenceId, recurrenceDate), and Convex mutations
// are serializable, so concurrent callers (two tabs, two teammates) can never insert twice.

/** An occurrence nobody has touched yet: still "to do" and not edited on its own. */
const isUnstarted = (t: Doc<"todos">) => t.status === "todo" && !t.recurrenceDetached;

async function requireRecurrence(ctx: MutationCtx, member: Member, recurrenceId: Id<"recurrences">) {
  const rec = await ctx.db.get(recurrenceId);
  if (!rec || rec.orgId !== member.orgId) throw new Error("Recurring todo not found.");
  const project = await requireWritableProject(ctx, member, rec.projectId);
  return { rec, project };
}

/** Occurrences of a series on or after `from`. */
function occurrencesFrom(ctx: MutationCtx, recurrenceId: Id<"recurrences">, from: string) {
  return ctx.db
    .query("todos")
    .withIndex("by_recurrence", (q) => q.eq("recurrenceId", recurrenceId).gte("recurrenceDate", from))
    .collect();
}

/** Inserts the missing occurrences of `rec` for `days`. Returns how many were created. */
async function generate(ctx: MutationCtx, rec: Doc<"recurrences">, days: string[]) {
  const skip = new Set(rec.skipDates ?? []);
  let assigneeId = rec.assigneeId;
  if (assigneeId) {
    // Someone who has left the team no longer receives new occurrences.
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_org_user", (q) => q.eq("orgId", rec.orgId).eq("userId", assigneeId!))
      .unique();
    if (membership && !membership.active) assigneeId = undefined;
  }
  let created = 0;
  for (const day of days) {
    if (day < rec.startDate || (rec.stoppedFrom && day >= rec.stoppedFrom)) continue;
    if (skip.has(day) || !matchesRule(rec.rule, day)) continue;
    const existing = await ctx.db
      .query("todos")
      .withIndex("by_recurrence", (q) => q.eq("recurrenceId", rec._id).eq("recurrenceDate", day))
      .first();
    if (existing) continue;
    await ctx.db.insert("todos", {
      orgId: rec.orgId,
      projectId: rec.projectId,
      title: rec.title,
      notes: rec.notes,
      date: day,
      status: "todo",
      assigneeId,
      createdBy: rec.createdBy,
      order: rec._creationTime,
      recurrenceId: rec._id,
      recurrenceDate: day,
    });
    created++;
  }
  return created;
}

function checkGenerateRange(from: string, to: string) {
  checkRange(from, to);
  if (daysBetween(from, to).length > MAX_GENERATE_DAYS) {
    throw new Error(`Pick at most ${MAX_GENERATE_DAYS} days.`);
  }
}

// Fills in the occurrences of every active series for [from, to] (a whole team, or one project).
// Called by the week board and the Today page for the range they display.
export const ensureOccurrences = mutation({
  args: { from: v.string(), to: v.string(), projectId: v.optional(v.id("projects")) },
  handler: async (ctx, { from, to, projectId }) => {
    const member = await getMember(ctx);
    if (!member) return 0;
    checkGenerateRange(from, to);
    const series = projectId
      ? await ctx.db.query("recurrences").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect()
      : await ctx.db.query("recurrences").withIndex("by_org", (q) => q.eq("orgId", member.orgId)).collect();
    const days = daysBetween(from, to);
    const projects = new Map<Id<"projects">, Doc<"projects"> | null>();
    let created = 0;
    for (const rec of series) {
      if (rec.orgId !== member.orgId || (rec.stoppedFrom && rec.stoppedFrom <= from)) continue;
      if (!projects.has(rec.projectId)) projects.set(rec.projectId, await ctx.db.get(rec.projectId));
      const project = projects.get(rec.projectId);
      // Archived projects are read-only (#18); projects being deleted are frozen (#16).
      if (!project || project.archived || project.deleting) continue;
      created += await generate(ctx, rec, days);
    }
    return created;
  },
});

// Active series (not stopped) of the team, or of one project. The boards watch this so a new or
// edited series is generated right away.
export const list = query({
  args: { projectId: v.optional(v.id("projects")) },
  handler: async (ctx, { projectId }) => {
    const member = await getMember(ctx);
    if (!member) return [];
    const series = projectId
      ? await ctx.db.query("recurrences").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect()
      : await ctx.db.query("recurrences").withIndex("by_org", (q) => q.eq("orgId", member.orgId)).collect();
    return series.filter((r) => r.orgId === member.orgId && !r.stoppedFrom);
  },
});

export const get = query({
  args: { recurrenceId: v.id("recurrences") },
  handler: async (ctx, { recurrenceId }) => {
    const member = await getMember(ctx);
    if (!member) return null;
    const rec = await ctx.db.get(recurrenceId);
    return rec && rec.orgId === member.orgId ? rec : null;
  },
});

const seriesFields = {
  title: v.string(),
  notes: v.optional(v.string()),
  assigneeId: v.optional(v.string()),
  rule: ruleValidator,
};

// Creates a series starting on `startDate` and generates its first week of occurrences.
export const create = mutation({
  args: { projectId: v.id("projects"), startDate: v.string(), ...seriesFields },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const project = await requireWritableProject(ctx, member, args.projectId);
    checkDate(args.startDate);
    const recurrenceId = await ctx.db.insert("recurrences", {
      orgId: member.orgId,
      projectId: project._id,
      title: todoTitle(args.title),
      notes: todoNotes(args.notes),
      assigneeId: await assignee(ctx, member.orgId, args.assigneeId),
      rule: recurrenceRule(args.rule),
      startDate: args.startDate,
      createdBy: member.userId,
    });
    const rec = (await ctx.db.get(recurrenceId))!;
    await generate(ctx, rec, daysBetween(args.startDate, addDays(args.startDate, 6)));
    return recurrenceId;
  },
});

// Edits the whole series from `from` on: future un-started occurrences take the new title, notes
// and assignee; those on days the new rule no longer covers are removed. Occurrences that were
// started, finished or edited on their own are left as they are. A rule change never back-fills
// days before `from`.
export const update = mutation({
  args: { recurrenceId: v.id("recurrences"), from: v.string(), ...seriesFields },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const { rec } = await requireRecurrence(ctx, member, args.recurrenceId);
    if (rec.stoppedFrom) throw new Error("This recurring todo has been stopped.");
    checkDate(args.from);
    const title = todoTitle(args.title);
    const notes = todoNotes(args.notes);
    const assigneeId =
      args.assigneeId && args.assigneeId === rec.assigneeId ? rec.assigneeId : await assignee(ctx, member.orgId, args.assigneeId);
    const rule = recurrenceRule(args.rule);
    const ruleChanged = JSON.stringify(rule) !== JSON.stringify(rec.rule);
    const startDate = ruleChanged && args.from > rec.startDate ? args.from : rec.startDate;
    await ctx.db.patch(rec._id, { title, notes, assigneeId, rule, startDate });

    for (const t of await occurrencesFrom(ctx, rec._id, args.from)) {
      if (!isUnstarted(t)) continue;
      if (!matchesRule(rule, t.recurrenceDate!)) await deleteTodo(ctx, t);
      else await ctx.db.patch(t._id, { title, notes, assigneeId });
    }
  },
});

// Stops a series: nothing is generated on or after `from`, and un-started occurrences from that
// day on are removed. Past, started and individually edited occurrences stay.
export const stop = mutation({
  args: { recurrenceId: v.id("recurrences"), from: v.string() },
  handler: async (ctx, { recurrenceId, from }) => {
    const member = await requireMember(ctx);
    const { rec } = await requireRecurrence(ctx, member, recurrenceId);
    checkDate(from);
    if (rec.stoppedFrom && rec.stoppedFrom <= from) return;
    await ctx.db.patch(rec._id, { stoppedFrom: from });
    for (const t of await occurrencesFrom(ctx, rec._id, from)) {
      if (isUnstarted(t)) await deleteTodo(ctx, t);
    }
  },
});
