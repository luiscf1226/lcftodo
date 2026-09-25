// Notifications (#25): daily email digest, assignment emails, in-app bell,
// per-user opt-out and an optional per-team Slack webhook.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { getMember, requireMember } from "./lib/auth";
import { appUrl, sendEmail } from "./lib/email";
import {
  activeMembership,
  addDays,
  buildDigest,
  DIGEST_HOUR,
  DIGEST_WINDOW_HOURS,
  emailPrefs,
  isEmptyDigest,
  localClock,
  MAX_DIGEST_ATTEMPTS,
  OVERDUE_LOOKBACK_DAYS,
  slackSettingsFor,
  teamTimeZone,
  type Digest,
} from "./lib/notify";
import {
  renderAssignmentEmail,
  renderDigestEmail,
  slackAssignmentText,
  slackSummaryText,
} from "./lib/notificationTemplates";
import { isSlackWebhookUrl, postToSlack } from "./lib/slack";
import { unsubscribeUrl } from "./lib/unsubscribe";

const LIST_LIMIT = 30;
const UNREAD_CAP = 99;
const DISPATCH_PAGE_SIZE = 200;

const emailKind = v.union(v.literal("digest"), v.literal("assigned"));

async function findUser(ctx: QueryCtx, clerkId: string) {
  return await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
    .unique();
}

const inDigestWindow = (hour: number) => hour >= DIGEST_HOUR && hour < DIGEST_HOUR + DIGEST_WINDOW_HOURS;

/** Email headers for RFC 8058 one-click unsubscribe, when a link is available. */
function unsubscribeHeaders(url: string | null): Record<string, string> | undefined {
  return url ? { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined;
}

// ---------------------------------------------------------------------------
// Personal email preferences
// ---------------------------------------------------------------------------

export const myPrefs = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const prefs = await emailPrefs(ctx, identity.subject);
    const user = await findUser(ctx, identity.subject);
    return { emailDigest: prefs.emailDigest, emailAssigned: prefs.emailAssigned, hasEmail: Boolean(user?.email) };
  },
});

async function setPrefs(ctx: MutationCtx, userId: string, change: { emailDigest?: boolean; emailAssigned?: boolean }) {
  const { row, emailDigest, emailAssigned } = await emailPrefs(ctx, userId);
  const next = { emailDigest: change.emailDigest ?? emailDigest, emailAssigned: change.emailAssigned ?? emailAssigned };
  if (row) await ctx.db.patch(row._id, { ...next, updatedAt: Date.now() });
  else await ctx.db.insert("notificationPrefs", { userId, ...next, updatedAt: Date.now() });
}

export const updateMyPrefs = mutation({
  args: { emailDigest: v.optional(v.boolean()), emailAssigned: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in.");
    await setPrefs(ctx, identity.subject, args);
  },
});

/** Used by the login-free unsubscribe endpoint after the signed token is verified. */
export const unsubscribe = internalMutation({
  args: { userId: v.string(), kind: emailKind },
  handler: async (ctx, { userId, kind }) => {
    await setPrefs(ctx, userId, kind === "digest" ? { emailDigest: false } : { emailAssigned: false });
  },
});

// ---------------------------------------------------------------------------
// In-app notifications (bell)
// ---------------------------------------------------------------------------

export const list = query({
  args: {},
  handler: async (ctx) => {
    const member = await getMember(ctx);
    if (!member) return [];
    return await ctx.db
      .query("notifications")
      .withIndex("by_org_user", (q) => q.eq("orgId", member.orgId).eq("userId", member.userId))
      .order("desc")
      .take(LIST_LIMIT);
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const member = await getMember(ctx);
    if (!member) return 0;
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_org_user_read", (q) => q.eq("orgId", member.orgId).eq("userId", member.userId).eq("read", false))
      .take(UNREAD_CAP + 1);
    return unread.length;
  },
});

export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const member = await requireMember(ctx);
    const n = await ctx.db.get(notificationId);
    if (!n || n.orgId !== member.orgId || n.userId !== member.userId) throw new Error("Notification not found.");
    if (!n.read) await ctx.db.patch(n._id, { read: true });
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const member = await requireMember(ctx);
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_org_user_read", (q) => q.eq("orgId", member.orgId).eq("userId", member.userId).eq("read", false))
      .take(500);
    for (const n of unread) await ctx.db.patch(n._id, { read: true });
  },
});

// ---------------------------------------------------------------------------
// Team Slack webhook (admin-only)
// ---------------------------------------------------------------------------

/** Never includes the webhook URL itself. */
export const slackSettings = query({
  args: {},
  handler: async (ctx) => {
    const member = await getMember(ctx);
    if (!member) return null;
    const row = await slackSettingsFor(ctx, member.orgId);
    return {
      configured: Boolean(row?.webhookUrl),
      postAssignments: row?.postAssignments ?? true,
      postDigest: row?.postDigest ?? true,
      canEdit: member.isAdmin,
    };
  },
});

export const updateSlack = mutation({
  args: {
    // Omitted = keep the current URL; "" = remove it.
    webhookUrl: v.optional(v.string()),
    postAssignments: v.boolean(),
    postDigest: v.boolean(),
  },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    if (!member.isAdmin) throw new Error("Only team admins can change the Slack integration.");
    const existing = await slackSettingsFor(ctx, member.orgId);
    let webhookUrl = existing?.webhookUrl;
    if (args.webhookUrl !== undefined) {
      const url = args.webhookUrl.trim();
      if (url && !isSlackWebhookUrl(url)) {
        throw new Error("Enter a Slack incoming webhook URL (https://hooks.slack.com/services/...).");
      }
      webhookUrl = url || undefined;
    }
    const fields = {
      webhookUrl,
      postAssignments: args.postAssignments,
      postDigest: args.postDigest,
      updatedBy: member.userId,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("teamSlack", { orgId: member.orgId, ...fields });
  },
});

// ---------------------------------------------------------------------------
// Daily digest (cron)
// ---------------------------------------------------------------------------

async function dispatchSlackSummaries(ctx: MutationCtx, now: number) {
  const teams = await ctx.db
    .query("teamSlack")
    .withIndex("by_postDigest", (q) => q.eq("postDigest", true))
    .collect();
  for (const team of teams) {
    if (!team.webhookUrl) continue;
    const { date, hour } = localClock(now, await teamTimeZone(ctx, team.orgId));
    if (!inDigestWindow(hour) || (team.lastDigestDate && team.lastDigestDate >= date)) continue;
    await ctx.db.patch(team._id, { lastDigestDate: date });
    await ctx.scheduler.runAfter(0, internal.notifications.postTeamSummary, { orgId: team.orgId, date });
  }
}

/**
 * Hourly cron entry point. Walks active memberships a page at a time; for each
 * member whose team-local time is in the morning window and who hasn't had
 * today's digest, claims a `digestSends` row and schedules the email.
 * The claimed row makes this idempotent per member per team-local day.
 */
export const dispatchDaily = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const now = Date.now();
    if (!cursor) await dispatchSlackSummaries(ctx, now);

    const page = await ctx.db.query("memberships").paginate({ numItems: DISPATCH_PAGE_SIZE, cursor: cursor ?? null });
    const zones = new Map<string, string>();
    let scheduled = 0;
    for (const membership of page.page) {
      if (!membership.active) continue;
      const { orgId, userId } = membership;
      let zone = zones.get(orgId);
      if (!zone) zones.set(orgId, (zone = await teamTimeZone(ctx, orgId)));
      const { date, hour } = localClock(now, zone);
      if (!inDigestWindow(hour)) continue;

      const existing = await ctx.db
        .query("digestSends")
        .withIndex("by_org_user_date", (q) => q.eq("orgId", orgId).eq("userId", userId).eq("date", date))
        .unique();
      if (existing && (existing.status !== "failed" || existing.attempts >= MAX_DIGEST_ATTEMPTS)) continue;
      if (!(await emailPrefs(ctx, userId)).emailDigest) continue;

      let sendId: Id<"digestSends">;
      if (existing) {
        sendId = existing._id;
        await ctx.db.patch(sendId, { status: "pending", attempts: existing.attempts + 1, updatedAt: now });
      } else {
        sendId = await ctx.db.insert("digestSends", {
          orgId,
          userId,
          date,
          status: "pending",
          attempts: 1,
          updatedAt: now,
        });
      }
      await ctx.scheduler.runAfter(0, internal.notifications.sendDigest, { sendId });
      scheduled++;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.notifications.dispatchDaily, { cursor: page.continueCursor });
    }
    return scheduled;
  },
});

type DigestData = { orgId: string; userId: string; date: string; to: string; name: string; digest: Digest };

/** Everything the digest email needs, or null if it should not be sent. */
export const digestData = internalQuery({
  args: { sendId: v.id("digestSends") },
  handler: async (ctx, { sendId }): Promise<DigestData | null> => {
    const send = await ctx.db.get(sendId);
    if (!send || send.status !== "pending") return null;
    const { orgId, userId, date } = send;
    // Emails only go to current members of the team, and only if they want them.
    if (!(await activeMembership(ctx, orgId, userId))) return null;
    if (!(await emailPrefs(ctx, userId)).emailDigest) return null;
    const user = await findUser(ctx, userId);
    if (!user?.email) return null;
    const digest = await buildDigest(ctx, orgId, userId, date);
    return { orgId, userId, date, to: user.email, name: user.name, digest };
  },
});

export const finishDigest = internalMutation({
  args: { sendId: v.id("digestSends"), status: v.union(v.literal("sent"), v.literal("skipped"), v.literal("failed")) },
  handler: async (ctx, { sendId, status }) => {
    await ctx.db.patch(sendId, { status, updatedAt: Date.now() });
  },
});

export const sendDigest = internalAction({
  args: { sendId: v.id("digestSends") },
  handler: async (ctx, { sendId }): Promise<"sent" | "skipped" | "failed"> => {
    const data = await ctx.runQuery(internal.notifications.digestData, { sendId });
    let status: "sent" | "skipped" | "failed" = "skipped";
    if (data && !isEmptyDigest(data.digest)) {
      const unsubscribe = await unsubscribeUrl(data.userId, "digest");
      const email = renderDigestEmail(data.name, data.date, data.digest, { app: appUrl("/app"), unsubscribe });
      const result = await sendEmail(
        {
          to: data.to,
          ...email,
          idempotencyKey: `digest/${data.orgId}/${data.userId}/${data.date}`,
          headers: unsubscribeHeaders(unsubscribe),
        },
        `digest for ${data.userId}`,
      );
      status = result === "sent" ? "sent" : result === "failed" ? "failed" : "skipped";
    }
    await ctx.runMutation(internal.notifications.finishDigest, { sendId, status });
    return status;
  },
});

type SummaryData = { webhookUrl: string; text: string };

export const teamSummaryData = internalQuery({
  args: { orgId: v.string(), date: v.string() },
  handler: async (ctx, { orgId, date }): Promise<SummaryData | null> => {
    const slack = await slackSettingsFor(ctx, orgId);
    if (!slack?.webhookUrl || !slack.postDigest) return null;
    const yesterday = addDays(date, -1);
    const [projects, todos] = await Promise.all([
      ctx.db
        .query("projects")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect(),
      ctx.db
        .query("todos")
        .withIndex("by_org_date", (q) =>
          q.eq("orgId", orgId).gte("date", addDays(date, -OVERDUE_LOOKBACK_DAYS)).lte("date", date),
        )
        .collect(),
    ]);
    const live = new Set(projects.filter((p) => !p.archived && !p.deleting).map((p) => p._id));
    const visible = todos.filter((t) => t.projectId && live.has(t.projectId));
    const carried = new Set(visible.map((t) => t.carriedFrom).filter((id) => id !== undefined));
    const open = (s: string) => s === "todo" || s === "doing";
    const today = visible.filter((t) => t.date === date);
    return {
      webhookUrl: slack.webhookUrl,
      text: slackSummaryText(date, {
        today: today.length,
        open: today.filter((t) => open(t.status)).length,
        done: today.filter((t) => t.status === "done").length,
        overdue: visible.filter((t) => t.date < date && open(t.status)).length,
        didntFinish: visible.filter((t) => t.date === yesterday && t.status === "not_done" && !carried.has(t._id))
          .length,
      }),
    };
  },
});

export const postTeamSummary = internalAction({
  args: { orgId: v.string(), date: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const data = await ctx.runQuery(internal.notifications.teamSummaryData, args);
    if (!data) return false;
    return await postToSlack(data.webhookUrl, data.text, `daily summary for ${args.orgId}`);
  },
});

// ---------------------------------------------------------------------------
// Assignment notifications
// ---------------------------------------------------------------------------

type TodoDetails = { title: string; project: string; date: string };
type AssignmentData = {
  userId: string;
  email: { to: string; actor: string; todo: TodoDetails } | null;
  slack: SummaryData | null;
};

export const assignmentData = internalQuery({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }): Promise<AssignmentData | null> => {
    const n = await ctx.db.get(notificationId);
    if (!n) return null;
    // Skip if the todo was deleted or reassigned before delivery ran.
    const todo = await ctx.db.get(n.todoId);
    if (!todo || todo.assigneeId !== n.userId) return null;
    const [actor, assignee] = await Promise.all([findUser(ctx, n.actorId), findUser(ctx, n.userId)]);
    const actorName = actor?.name ?? "A teammate";
    const details: TodoDetails = { title: todo.title, project: n.projectName, date: todo.date };

    let email: AssignmentData["email"] = null;
    if (
      (await activeMembership(ctx, n.orgId, n.userId)) &&
      (await emailPrefs(ctx, n.userId)).emailAssigned &&
      assignee?.email
    ) {
      email = { to: assignee.email, actor: actorName, todo: details };
    }
    const slack = await slackSettingsFor(ctx, n.orgId);
    return {
      userId: n.userId,
      email,
      slack:
        slack?.webhookUrl && slack.postAssignments
          ? {
              webhookUrl: slack.webhookUrl,
              text: slackAssignmentText(actorName, assignee?.name ?? "un compañero", details),
            }
          : null,
    };
  },
});

export const deliverAssignment = internalAction({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }): Promise<{ email: string; slack: boolean }> => {
    const data = await ctx.runQuery(internal.notifications.assignmentData, { notificationId });
    if (!data) return { email: "skipped", slack: false };
    let email = "skipped";
    if (data.email) {
      const unsubscribe = await unsubscribeUrl(data.userId, "assigned");
      const rendered = renderAssignmentEmail(data.email.actor, data.email.todo, { app: appUrl("/app"), unsubscribe });
      email = await sendEmail(
        {
          to: data.email.to,
          ...rendered,
          idempotencyKey: `assigned/${notificationId}`,
          headers: unsubscribeHeaders(unsubscribe),
        },
        `assignment for ${data.userId}`,
      );
    }
    const slack = data.slack ? await postToSlack(data.slack.webhookUrl, data.slack.text, "assignment") : false;
    return { email, slack };
  },
});
