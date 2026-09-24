import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { buildDigest } from "./lib/notify";
import { isSlackWebhookUrl } from "./lib/slack";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "./lib/unsubscribe";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const alice = { subject: "user_alice", name: "Alice", org_id: "org_a", org_role: "org:admin" };
const bob = { subject: "user_bob", name: "Bob", org_id: "org_a", org_role: "org:member" };
const eve = { subject: "user_eve", name: "Eve", org_id: "org_b", org_role: "org:admin" };

// Test-only HMAC key and a fake Slack webhook; neither is a real credential.
const HMAC_KEY = "fixture-hmac-key-0123456789";
const OTHER_KEY = "fixture-other-key-0123456789";
const SLACK_URL = "https://hooks.slack.com/services/T000/B000/XXXX";
const TODAY = "2026-09-23";

type Sent = { url: string; body: Record<string, unknown>; headers: Record<string, string> };
let sent: Sent[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T07:30:00Z`));
  vi.stubEnv("RESEND_API_KEY", "re_fixture");
  vi.stubEnv("NOTIFICATIONS_SIGNING_SECRET", HMAC_KEY);
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      sent.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? "{}")),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const emails = () => sent.filter((s) => s.url === "https://api.resend.com/emails");
const emailsTo = (address: string) => emails().filter((s) => (s.body.to as string[]).includes(address));
const slackPosts = () => sent.filter((s) => s.url.startsWith("https://hooks.slack.com/"));

type T = ReturnType<typeof convexTest>;

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (const [who, role] of [
      [alice, "org:admin"],
      [bob, "org:member"],
      [eve, "org:admin"],
    ] as const) {
      await ctx.db.insert("memberships", { orgId: who.org_id, userId: who.subject, role, active: true, updatedAt: 0 });
      await ctx.db.insert("users", {
        clerkId: who.subject,
        name: who.name,
        email: `${who.name.toLowerCase()}@example.com`,
      });
    }
  });
  const a = t.withIdentity(alice);
  const b = t.withIdentity(bob);
  const e = t.withIdentity(eve);
  const projectId = await a.mutation(api.projects.create, { name: "Launch", color: "#6366f1" });
  const eveProject = await e.mutation(api.projects.create, { name: "Other team", color: "#6366f1" });
  return { t, a, b, e, projectId, eveProject };
}

type TodoFields = {
  orgId: string;
  projectId: Id<"projects">;
  title: string;
  date: string;
  createdBy: string;
  assigneeId?: string;
  status?: "todo" | "doing" | "done" | "not_done";
  carriedFrom?: Id<"todos">;
};

async function insertTodo(t: T, fields: TodoFields) {
  return await t.run((ctx) => ctx.db.insert("todos", { status: "todo", order: 0, ...fields }));
}

const runScheduled = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);

async function dispatchAt(t: T, isoTime: string) {
  vi.setSystemTime(new Date(isoTime));
  await t.mutation(internal.notifications.dispatchDaily, {});
  await runScheduled(t);
}

describe("daily digest", () => {
  test("contains only the member's own todos from their team", async () => {
    const { t, projectId, eveProject } = await setup();
    const archived = await t.run((ctx) =>
      ctx.db.insert("projects", {
        orgId: "org_a",
        name: "Old",
        color: "#6366f1",
        archived: true,
        createdBy: alice.subject,
      }),
    );
    const org = { orgId: "org_a", projectId };
    await insertTodo(t, {
      ...org,
      title: "Alice today",
      date: TODAY,
      createdBy: bob.subject,
      assigneeId: alice.subject,
    });
    await insertTodo(t, { ...org, title: "Alice own unassigned", date: TODAY, createdBy: alice.subject });
    await insertTodo(t, { ...org, title: "Alice done", date: TODAY, createdBy: alice.subject, status: "done" });
    await insertTodo(t, { ...org, title: "Bob today", date: TODAY, createdBy: alice.subject, assigneeId: bob.subject });
    await insertTodo(t, {
      ...org,
      title: "Alice overdue",
      date: "2026-09-20",
      createdBy: alice.subject,
      status: "doing",
    });
    await insertTodo(t, {
      ...org,
      title: "Alice slipped",
      date: "2026-09-22",
      createdBy: alice.subject,
      status: "not_done",
    });
    const carried = await insertTodo(t, {
      ...org,
      title: "Alice carried",
      date: "2026-09-22",
      createdBy: alice.subject,
      status: "not_done",
    });
    await insertTodo(t, {
      ...org,
      title: "Alice carried",
      date: TODAY,
      createdBy: alice.subject,
      carriedFrom: carried,
    });
    await insertTodo(t, {
      orgId: "org_a",
      projectId: archived,
      title: "Archived work",
      date: TODAY,
      createdBy: alice.subject,
    });
    await insertTodo(t, {
      orgId: "org_b",
      projectId: eveProject,
      title: "Eve today",
      date: TODAY,
      createdBy: eve.subject,
    });

    const digest = await t.run((ctx) => buildDigest(ctx, "org_a", alice.subject, TODAY));
    expect(digest.today.map((i) => i.title)).toEqual(["Alice today", "Alice own unassigned", "Alice carried"]);
    expect(digest.overdue.map((i) => i.title)).toEqual(["Alice overdue"]);
    expect(digest.didntFinish.map((i) => i.title)).toEqual(["Alice slipped"]);

    await dispatchAt(t, `${TODAY}T07:30:00Z`);

    expect(emailsTo("alice@example.com")).toHaveLength(1);
    const [toAlice] = emailsTo("alice@example.com");
    expect(toAlice.body.text).toContain("Alice today");
    expect(toAlice.body.text).not.toContain("Bob today");
    expect(toAlice.body.text).not.toContain("Eve today");
    expect(toAlice.body.text).not.toContain("Archived work");
    expect(toAlice.body.text).toContain("https://example.convex.site/notifications/unsubscribe?token=");
    expect(toAlice.headers["Idempotency-Key"]).toBe(`digest/org_a/${alice.subject}/${TODAY}`);
    expect(toAlice.body.headers).toMatchObject({ "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });

    const toBob = emailsTo("bob@example.com")[0].body.text as string;
    expect(toBob).toContain("Bob today");
    expect(toBob).not.toContain("Alice");
    const toEve = emailsTo("eve@example.com")[0].body.text as string;
    expect(toEve).toContain("Eve today");
    expect(toEve).not.toMatch(/Alice|Bob/);
    expect(emails()).toHaveLength(3);
  });

  test("is sent once per member per day and only in the local morning", async () => {
    const { t, projectId } = await setup();
    await insertTodo(t, { orgId: "org_a", projectId, title: "Ship", date: TODAY, createdBy: alice.subject });

    await dispatchAt(t, `${TODAY}T05:07:00Z`);
    expect(emails()).toHaveLength(0);

    for (const time of ["07:07", "08:07", "09:07", "12:07"]) await dispatchAt(t, `${TODAY}T${time}:00Z`);
    expect(emailsTo("alice@example.com")).toHaveLength(1);
    const rows = await t.run((ctx) => ctx.db.query("digestSends").collect());
    expect(rows.filter((r) => r.userId === alice.subject)).toMatchObject([
      { date: TODAY, status: "sent", attempts: 1 },
    ]);

    // The next day gets its own digest (the todo is now overdue).
    await dispatchAt(t, "2026-09-24T07:07:00Z");
    expect(emailsTo("alice@example.com")).toHaveLength(2);
  });

  test("follows the team's time zone", async () => {
    const { t, projectId } = await setup();
    await t.run((ctx) =>
      ctx.db.insert("teamSettings", {
        orgId: "org_a",
        timeZone: "America/New_York",
        autoCarryOver: false,
        updatedBy: alice.subject,
        updatedAt: 0,
      }),
    );
    // 2026-09-24 07:xx in New York is 11:xx UTC (EDT, UTC-4).
    await insertTodo(t, {
      orgId: "org_a",
      projectId,
      title: "NY morning",
      date: "2026-09-24",
      createdBy: alice.subject,
    });

    await dispatchAt(t, "2026-09-24T07:30:00Z"); // 03:30 in New York
    expect(emailsTo("alice@example.com")).toHaveLength(0);
    await dispatchAt(t, "2026-09-24T11:30:00Z"); // 07:30 in New York
    expect(emailsTo("alice@example.com")).toHaveLength(1);
    expect(emailsTo("alice@example.com")[0].body.subject).toContain("2026-09-24");
  });

  test("retries a failed send on later runs, up to the attempt limit", async () => {
    const { t, projectId } = await setup();
    await insertTodo(t, { orgId: "org_a", projectId, title: "Ship", date: TODAY, createdBy: alice.subject });
    const failing = vi.fn(async () => new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", failing);
    for (let i = 0; i < 5; i++) await dispatchAt(t, `${TODAY}T08:0${i}:00Z`);
    expect(failing).toHaveBeenCalledTimes(3);
    const row = await t.run((ctx) =>
      ctx.db
        .query("digestSends")
        .withIndex("by_org_user_date", (q) => q.eq("orgId", "org_a").eq("userId", alice.subject).eq("date", TODAY))
        .unique(),
    );
    expect(row).toMatchObject({ status: "failed", attempts: 3 });
  });

  test("respects opt-out and skips removed members", async () => {
    const { t, a, b, projectId } = await setup();
    await insertTodo(t, { orgId: "org_a", projectId, title: "A", date: TODAY, createdBy: alice.subject });
    await insertTodo(t, { orgId: "org_a", projectId, title: "B", date: TODAY, createdBy: bob.subject });
    await a.mutation(api.notifications.updateMyPrefs, { emailDigest: false });
    expect(await a.query(api.notifications.myPrefs, {})).toMatchObject({
      emailDigest: false,
      emailAssigned: true,
      hasEmail: true,
    });
    await t.run(async (ctx) => {
      const m = await ctx.db
        .query("memberships")
        .withIndex("by_org_user", (q) => q.eq("orgId", "org_a").eq("userId", bob.subject))
        .unique();
      await ctx.db.patch(m!._id, { active: false });
    });
    await dispatchAt(t, `${TODAY}T07:30:00Z`);
    expect(emails()).toHaveLength(0);
    expect(await b.query(api.notifications.myPrefs, {})).toMatchObject({ emailDigest: true });
  });

  test("without RESEND_API_KEY sending is a logged no-op", async () => {
    const { t, projectId } = await setup();
    vi.stubEnv("RESEND_API_KEY", "");
    await insertTodo(t, { orgId: "org_a", projectId, title: "Ship", date: TODAY, createdBy: alice.subject });
    await dispatchAt(t, `${TODAY}T07:30:00Z`);
    expect(sent).toHaveLength(0);
    const rows = await t.run((ctx) => ctx.db.query("digestSends").collect());
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === "skipped")).toBe(true);
  });

  test("posts one Slack summary per team per day when enabled", async () => {
    const { t, a, projectId } = await setup();
    await a.mutation(api.notifications.updateSlack, {
      webhookUrl: SLACK_URL,
      postAssignments: false,
      postDigest: true,
    });
    await insertTodo(t, { orgId: "org_a", projectId, title: "Ship", date: TODAY, createdBy: alice.subject });
    await dispatchAt(t, `${TODAY}T07:07:00Z`);
    await dispatchAt(t, `${TODAY}T08:07:00Z`);
    expect(slackPosts()).toHaveLength(1);
    expect(slackPosts()[0].body.text).toContain(`Daily summary for ${TODAY}`);
    expect(slackPosts()[0].body.text).toContain("Today: 1 todos (1 open, 0 done)");
  });
});

describe("unsubscribe links", () => {
  test("a signed token unsubscribes without login; tampered tokens are rejected", async () => {
    const { t, a } = await setup();
    const token = (await signUnsubscribeToken(alice.subject, "digest", HMAC_KEY))!;
    expect(await verifyUnsubscribeToken(token, HMAC_KEY)).toEqual({ userId: alice.subject, kind: "digest" });
    expect(await verifyUnsubscribeToken(token, OTHER_KEY)).toBeNull();
    const forged = (await signUnsubscribeToken(bob.subject, "digest", OTHER_KEY))!;
    expect(await verifyUnsubscribeToken(`${forged.split(".")[0]}.${token.split(".")[1]}`, HMAC_KEY)).toBeNull();

    const url = `/notifications/unsubscribe?token=${encodeURIComponent(token)}`;
    const confirm = await t.fetch(url, { method: "GET" });
    expect(confirm.status).toBe(200);
    // Opening the link alone (e.g. a mail scanner) changes nothing.
    expect(await a.query(api.notifications.myPrefs, {})).toMatchObject({ emailDigest: true });

    const done = await t.fetch(url, { method: "POST", body: "List-Unsubscribe=One-Click" });
    expect(done.status).toBe(200);
    expect(await a.query(api.notifications.myPrefs, {})).toMatchObject({ emailDigest: false, emailAssigned: true });

    const bad = await t.fetch(`/notifications/unsubscribe?token=${encodeURIComponent(`${token}x`)}`, {
      method: "POST",
    });
    expect(bad.status).toBe(400);
  });

  test("no links are issued without a signing key", async () => {
    vi.stubEnv("NOTIFICATIONS_SIGNING_SECRET", "");
    expect(await signUnsubscribeToken(alice.subject, "digest")).toBeNull();
  });
});

describe("assignment notifications", () => {
  test("assigning someone else notifies them in-app and by email; self-assignment is silent", async () => {
    const { t, a, b, projectId } = await setup();
    await a.mutation(api.todos.create, { projectId, title: "Mine", date: TODAY, assigneeId: alice.subject });
    const todoId = await a.mutation(api.todos.create, {
      projectId,
      title: "Review <copy>",
      date: TODAY,
      assigneeId: bob.subject,
    });
    await runScheduled(t);

    expect(await a.query(api.notifications.unreadCount, {})).toBe(0);
    expect(await b.query(api.notifications.unreadCount, {})).toBe(1);
    const [n] = await b.query(api.notifications.list, {});
    expect(n).toMatchObject({ todoId, todoTitle: "Review <copy>", actorId: alice.subject, read: false });
    expect(emails()).toHaveLength(1);
    const [mail] = emailsTo("bob@example.com");
    expect(mail.body.subject).toBe("Alice assigned you: Review <copy>");
    expect(mail.body.html).toContain("Review &lt;copy&gt;");
    expect(mail.headers["Idempotency-Key"]).toBe(`assigned/${n._id}`);

    // Editing other fields doesn't re-notify; reassigning does.
    await a.mutation(api.todos.update, { todoId, title: "Review copy", date: TODAY, assigneeId: bob.subject });
    await b.mutation(api.notifications.markAllRead, {});
    await b.mutation(api.todos.update, { todoId, title: "Review copy", date: TODAY, assigneeId: alice.subject });
    await runScheduled(t);
    expect(await b.query(api.notifications.unreadCount, {})).toBe(0);
    expect(await a.query(api.notifications.unreadCount, {})).toBe(1);
    expect(emailsTo("alice@example.com")).toHaveLength(1);

    // Notifications are private to their recipient.
    await expect(a.mutation(api.notifications.markRead, { notificationId: n._id })).rejects.toThrow(/not found/);
  });

  test("assignment email respects opt-out but still shows in-app; Slack gets the event", async () => {
    const { t, a, b, e, projectId } = await setup();
    await b.mutation(api.notifications.updateMyPrefs, { emailAssigned: false });
    await a.mutation(api.notifications.updateSlack, {
      webhookUrl: SLACK_URL,
      postAssignments: true,
      postDigest: false,
    });
    await a.mutation(api.todos.create, { projectId, title: "Deploy", date: TODAY, assigneeId: bob.subject });
    await runScheduled(t);
    expect(emails()).toHaveLength(0);
    expect(await b.query(api.notifications.unreadCount, {})).toBe(1);
    expect(slackPosts()).toHaveLength(1);
    expect(slackPosts()[0].body.text).toBe(`Alice assigned *Deploy* to Bob in Launch (due ${TODAY}).`);
    // Other teams see nothing.
    expect(await e.query(api.notifications.list, {})).toEqual([]);
  });
});

describe("Slack settings", () => {
  test("only https://hooks.slack.com/services URLs are accepted", () => {
    expect(isSlackWebhookUrl(SLACK_URL)).toBe(true);
    for (const bad of [
      "http://hooks.slack.com/services/T/B/X",
      "https://hooks.slack.com.evil.com/services/T/B/X",
      "https://evil.com/hooks.slack.com/services/T/B/X",
      "https://user:pw@hooks.slack.com/services/T/B/X",
      "https://hooks.slack.com:8443/services/T/B/X",
      "https://hooks.slack.com/other/T/B/X",
      "https://hooks.slack.com/services/",
      "not a url",
      "",
    ]) {
      expect(isSlackWebhookUrl(bad), bad).toBe(false);
    }
  });

  test("admin-only, validated, and the URL is never returned", async () => {
    const { a, b, e } = await setup();
    await expect(
      b.mutation(api.notifications.updateSlack, { webhookUrl: SLACK_URL, postAssignments: true, postDigest: true }),
    ).rejects.toThrow(/admins/);
    await expect(
      a.mutation(api.notifications.updateSlack, {
        webhookUrl: "https://example.com/hook",
        postAssignments: true,
        postDigest: true,
      }),
    ).rejects.toThrow(/hooks\.slack\.com/);

    await a.mutation(api.notifications.updateSlack, {
      webhookUrl: SLACK_URL,
      postAssignments: true,
      postDigest: false,
    });
    const settings = await b.query(api.notifications.slackSettings, {});
    expect(settings).toEqual({ configured: true, postAssignments: true, postDigest: false, canEdit: false });
    expect(JSON.stringify(settings)).not.toContain("hooks.slack.com");
    expect(await e.query(api.notifications.slackSettings, {})).toMatchObject({ configured: false });

    // Omitting the URL keeps it; an empty string removes it.
    await a.mutation(api.notifications.updateSlack, { postAssignments: false, postDigest: false });
    expect(await a.query(api.notifications.slackSettings, {})).toMatchObject({ configured: true, canEdit: true });
    await a.mutation(api.notifications.updateSlack, { webhookUrl: "", postAssignments: false, postDigest: false });
    expect(await a.query(api.notifications.slackSettings, {})).toMatchObject({ configured: false });
  });
});
