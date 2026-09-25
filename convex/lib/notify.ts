// Shared notification plumbing (#25): team-local clock, digest content, and the
// assignment hook called by todo mutations.
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { userCanAccessProject, type Member } from "./auth";
import { addDaysToKey, dateKeyInZone, isValidTimeZone } from "./timezone";

/** Team-local hour at which the daily digest goes out, and how long a late cron may still send it. */
export const DIGEST_HOUR = 7;
export const DIGEST_WINDOW_HOURS = 3;
/** How far back the digest looks for overdue work. */
export const OVERDUE_LOOKBACK_DAYS = 14;
/** Max items listed per digest section; the rest is summarized as "+N more". */
export const DIGEST_SECTION_LIMIT = 25;
/** Digest attempts per user per day before giving up. */
export const MAX_DIGEST_ATTEMPTS = 3;

/** The team's IANA time zone (#21), or UTC when the team hasn't set one. */
export async function teamTimeZone(ctx: QueryCtx, orgId: string): Promise<string> {
  const settings = await ctx.db
    .query("teamSettings")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .unique();
  const zone = settings?.timeZone;
  return zone && isValidTimeZone(zone) ? zone : "UTC";
}

/** Calendar day ("YYYY-MM-DD") and hour (0-23) of `instant` in `timeZone`. */
export function localClock(instant: number, timeZone: string): { date: string; hour: number } {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit" })
    .formatToParts(new Date(instant))
    .find((p) => p.type === "hour")?.value;
  return { date: dateKeyInZone(instant, timeZone), hour: Number(hour) % 24 };
}

export const addDays = addDaysToKey;

export async function emailPrefs(ctx: QueryCtx, userId: string) {
  const row = await ctx.db
    .query("notificationPrefs")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  // Missing row = default: everything on.
  return { row, emailDigest: row?.emailDigest ?? true, emailAssigned: row?.emailAssigned ?? true };
}

export async function activeMembership(ctx: QueryCtx, orgId: string, userId: string) {
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", userId))
    .unique();
  return membership?.active ? membership : null;
}

export async function slackSettingsFor(ctx: QueryCtx, orgId: string) {
  return await ctx.db
    .query("teamSlack")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .unique();
}

/** Projects whose todos may appear in `userId`'s digest: live projects they can access (#46). */
async function digestProjects(ctx: QueryCtx, orgId: string, userId: string): Promise<Doc<"projects">[]> {
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const live = projects.filter((p) => !p.archived && !p.deleting);
  const allowed = await Promise.all(live.map((p) => userCanAccessProject(ctx, p, userId)));
  return live.filter((_, i) => allowed[i]);
}

export type DigestItem = { title: string; project: string; date: string; status: Doc<"todos">["status"] };
export type Digest = { today: DigestItem[]; overdue: DigestItem[]; didntFinish: DigestItem[] };

const isOpen = (t: Doc<"todos">) => t.status === "todo" || t.status === "doing";

/**
 * A member's digest for team-local day `date`: their open todos for today,
 * open todos from earlier days (overdue), and yesterday's "didn't finish" items
 * that were not carried over (a carried copy already shows up under today).
 * "Their" todos = assigned to them, or unassigned and created by them.
 */
export async function buildDigest(ctx: QueryCtx, orgId: string, userId: string, date: string): Promise<Digest> {
  const from = addDays(date, -OVERDUE_LOOKBACK_DAYS);
  const yesterday = addDays(date, -1);
  const [projects, todos] = await Promise.all([
    digestProjects(ctx, orgId, userId),
    ctx.db
      .query("todos")
      .withIndex("by_org_date", (q) => q.eq("orgId", orgId).gte("date", from).lte("date", date))
      .collect(),
  ]);
  const projectName = new Map<Id<"projects">, string>(projects.map((p) => [p._id, p.name]));
  const carried = new Set(todos.map((t) => t.carriedFrom).filter((id) => id !== undefined));
  const mine = todos.filter(
    (t) =>
      t.projectId &&
      projectName.has(t.projectId) &&
      (t.assigneeId === userId || (!t.assigneeId && t.createdBy === userId)),
  );
  const item = (t: Doc<"todos">): DigestItem => ({
    title: t.title,
    project: (t.projectId && projectName.get(t.projectId)) || "",
    date: t.date,
    status: t.status,
  });
  const byDateThenOrder = (a: Doc<"todos">, b: Doc<"todos">) => a.date.localeCompare(b.date) || a.order - b.order;
  mine.sort(byDateThenOrder);
  return {
    today: mine.filter((t) => t.date === date && isOpen(t)).map(item),
    overdue: mine.filter((t) => t.date < date && isOpen(t)).map(item),
    didntFinish: mine.filter((t) => t.date === yesterday && t.status === "not_done" && !carried.has(t._id)).map(item),
  };
}

export const isEmptyDigest = (d: Digest) => d.today.length + d.overdue.length + d.didntFinish.length === 0;

/**
 * Called by todo mutations after a todo gets a new assignee. Records an in-app
 * notification and schedules email/Slack delivery. Self-assignment is silent.
 */
export async function notifyAssigned(
  ctx: MutationCtx,
  member: Member,
  project: Doc<"projects">,
  todo: { todoId: Id<"todos">; title: string; date: string },
  assigneeId: string,
) {
  if (assigneeId === member.userId) return;
  const notificationId = await ctx.db.insert("notifications", {
    orgId: member.orgId,
    userId: assigneeId,
    kind: "assigned",
    todoId: todo.todoId,
    todoTitle: todo.title,
    projectName: project.name,
    date: todo.date,
    actorId: member.userId,
    read: false,
  });
  await ctx.scheduler.runAfter(0, internal.notifications.deliverAssignment, { notificationId });
}
