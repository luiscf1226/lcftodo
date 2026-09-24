import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Webhook } from "svix";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Project access, invitations and their migration policy (#46).

const modules = import.meta.glob("./**/*.ts");

const alice = { subject: "user_alice", name: "Alice", email: "alice@example.com", org_id: "org_a", org_role: "org:admin" };
const bob = { subject: "user_bob", name: "Bob", email: "bob@example.com", org_id: "org_a", org_role: "org:member" };
const carol = { subject: "user_carol", name: "Carol", email: "carol@example.com", org_id: "org_a", org_role: "org:member" };
const dave = { subject: "user_dave", name: "Dave", org_id: "org_a", org_role: "org:member" };
const eve = { subject: "user_eve", name: "Eve", org_id: "org_b", org_role: "org:admin" };

const DAY = "2026-09-23";
const WEEK = { from: "2026-09-21", to: "2026-09-27" };

let seq = 0;
async function join(t: ReturnType<typeof convexTest>, userId: string, role = "org:member", identifier?: string, orgId = "org_a") {
  seq++;
  await t.mutation(internal.memberships.applyWebhook, {
    orgId, userId, membershipId: `mem_${userId}_${seq}`, role, active: true, createdAt: seq, updatedAt: seq, identifier,
  });
}

/** Team A: Alice (admin), Bob and Carol (members); projects Apollo and Borealis with a todo each. */
async function setup() {
  const t = convexTest(schema, modules);
  await join(t, alice.subject, "org:admin");
  await join(t, bob.subject);
  await join(t, carol.subject);
  await t.mutation(internal.memberships.completeBackfill, { orgId: "org_a", startedAt: 0 });
  const a = t.withIdentity(alice);
  const b = t.withIdentity(bob);
  const c = t.withIdentity(carol);
  const apollo = await a.mutation(api.projects.create, { name: "Apollo", color: "#6366f1" });
  const borealis = await a.mutation(api.projects.create, { name: "Borealis", color: "#0ea5e9" });
  const apolloTodo = await a.mutation(api.todos.create, { projectId: apollo, title: "Apollo work", date: DAY, assigneeId: bob.subject });
  const borealisTodo = await a.mutation(api.todos.create, { projectId: borealis, title: "Borealis work", date: DAY });
  return { t, a, b, c, apollo, borealis, apolloTodo, borealisTodo };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

async function restrict({ a, apollo, borealis }: Ctx) {
  await a.mutation(api.projectAccess.setRestricted, { enabled: true });
  await a.mutation(api.projectAccess.grant, { projectId: apollo, userId: bob.subject });
  await a.mutation(api.projectAccess.grant, { projectId: borealis, userId: carol.subject });
}


async function exportRows(client: Ctx["a"], projectId?: Id<"projects">) {
  const now = Date.now();
  return (await client.query(api.activity.exportPage, { fromMs: now - 3_600_000, toMs: now + 3_600_000, projectId, paginationOpts: { numItems: 100, cursor: null } })).page;
}

describe("existing-team migration (open policy)", () => {
  test("until an admin restricts access, every member keeps seeing every project", async () => {
    const ctx = await setup();
    const { b, c } = ctx;
    expect(await b.query(api.projectAccess.me, {})).toMatchObject({ isAdmin: false, restricted: false, grantedProjects: null });
    for (const client of [b, c]) {
      expect((await client.query(api.projects.list, {})).map((p) => p.name)).toEqual(["Apollo", "Borealis"]);
      expect(await client.query(api.todos.listForTeam, WEEK)).toHaveLength(2);
      expect(new Set((await exportRows(client)).map((r) => r.projectName))).toEqual(new Set(["Apollo", "Borealis"]));
    }
    // Members can still work anywhere and assign any active teammate.
    await c.mutation(api.todos.create, { projectId: ctx.apollo, title: "Help", date: DAY, assigneeId: bob.subject });
  });

  test("turning on restricted access can seed grants from existing work", async () => {
    const ctx = await setup();
    const { a, b, c } = ctx;
    const { seeded } = await a.mutation(api.projectAccess.setRestricted, { enabled: true, seedFromWork: true });
    expect(seeded).toBe(1); // Bob is assigned in Apollo; Carol has no work yet.
    expect((await b.query(api.projects.list, {})).map((p) => p.name)).toEqual(["Apollo"]);
    expect(await c.query(api.projects.list, {})).toEqual([]);
    expect(await c.query(api.projectAccess.me, {})).toMatchObject({ restricted: true, grantedProjects: 0 });
    // Admins always see everything.
    expect((await a.query(api.projects.list, {})).map((p) => p.name)).toEqual(["Apollo", "Borealis"]);
    // Turning it back off restores the open policy.
    await a.mutation(api.projectAccess.setRestricted, { enabled: false });
    expect(await c.query(api.projects.list, {})).toHaveLength(2);
  });

  test("only admins manage access", async () => {
    const { b, apollo } = await setup();
    await expect(b.mutation(api.projectAccess.setRestricted, { enabled: true })).rejects.toThrow(/admins/);
    await expect(b.mutation(api.projectAccess.grant, { projectId: apollo, userId: carol.subject })).rejects.toThrow(/admins/);
    expect(await b.query(api.projectAccess.overview, {})).toBeNull();
  });
});

describe("restricted access: two projects with different memberships", () => {
  test("reads are scoped to granted projects; admins see everything", async () => {
    const ctx = await setup();
    await restrict(ctx);
    const { a, b, c, apollo, borealis, apolloTodo, borealisTodo } = ctx;

    expect((await b.query(api.projects.list, { includeArchived: true })).map((p) => p.name)).toEqual(["Apollo"]);
    expect((await c.query(api.projects.list, {})).map((p) => p.name)).toEqual(["Borealis"]);
    expect((await b.query(api.projects.listWithStats, WEEK)).map((p) => [p.name, p.total])).toEqual([["Apollo", 1]]);
    expect((await b.query(api.todos.listForTeam, WEEK)).map((t) => t.title)).toEqual(["Apollo work"]);
    expect((await c.query(api.todos.listForTeam, WEEK)).map((t) => t.title)).toEqual(["Borealis work"]);
    expect(await a.query(api.todos.listForTeam, WEEK)).toHaveLength(2);

    // Direct-ID attempts reveal nothing.
    expect(await b.query(api.projects.get, { projectId: borealis })).toBeNull();
    expect(await b.query(api.todos.listForProject, { projectId: borealis, ...WEEK })).toEqual([]);
    expect(await b.query(api.todos.get, { todoId: borealisTodo })).toBeNull();
    expect(await b.query(api.activity.forTodo, { todoId: borealisTodo })).toEqual([]);
    expect(await b.query(api.projectAccess.assignable, { projectId: borealis })).toBeNull();
    expect(await b.query(api.projects.get, { projectId: apollo })).toMatchObject({ name: "Apollo" });
    expect(await b.query(api.todos.get, { todoId: apolloTodo })).toMatchObject({ title: "Apollo work" });

    // History and exports.
    const page = { paginationOpts: { numItems: 50, cursor: null } };
    const bobHistory = await b.query(api.activity.list, page);
    expect(new Set(bobHistory.page.map((r) => r.projectName))).toEqual(new Set(["Apollo"]));
    expect((await b.query(api.activity.list, { ...page, projectId: borealis })).page).toEqual([]);
    expect((await b.query(api.activity.list, { ...page, actorId: alice.subject })).page.every((r) => r.projectName === "Apollo")).toBe(true);
    expect(new Set((await exportRows(b)).map((r) => r.projectName))).toEqual(new Set(["Apollo"]));
    expect(await exportRows(b, borealis)).toEqual([]);
    const now = Date.now();
    expect(await b.query(api.activity.exportRange, { fromMs: now - 3_600_000, toMs: now + 3_600_000, projectId: borealis })).toEqual([]);
    expect(new Set((await exportRows(a)).map((r) => r.projectName))).toEqual(new Set(["Apollo", "Borealis"]));
  });

  test("writes to an inaccessible project fail as if it didn't exist", async () => {
    const ctx = await setup();
    await restrict(ctx);
    const { b, borealis, borealisTodo, apollo } = ctx;
    await expect(b.mutation(api.todos.create, { projectId: borealis, title: "x", date: DAY })).rejects.toThrow(/Project not found/);
    await expect(b.mutation(api.todos.setStatus, { todoId: borealisTodo, status: "done" })).rejects.toThrow(/Todo not found/);
    await expect(b.mutation(api.todos.update, { todoId: borealisTodo, title: "x", date: DAY })).rejects.toThrow(/Todo not found/);
    await expect(b.mutation(api.todos.remove, { todoId: borealisTodo })).rejects.toThrow(/Todo not found/);
    await expect(b.mutation(api.todos.carryOver, { projectId: borealis, date: DAY })).rejects.toThrow(/Project not found/);
    await expect(b.mutation(api.projects.update, { projectId: borealis, name: "Mine", color: "#6366f1" })).rejects.toThrow(/Project not found/);
    // Bob can still work in Apollo.
    await b.mutation(api.todos.create, { projectId: apollo, title: "Bob's", date: DAY });
  });

  test("a member's new project stays visible to them after restriction", async () => {
    const ctx = await setup();
    const own = await ctx.c.mutation(api.projects.create, { name: "Carol's", color: "#10b981" });
    await restrict(ctx);
    expect((await ctx.c.query(api.projects.list, {})).map((p) => p._id)).toContain(own);
    expect((await ctx.b.query(api.projects.list, {})).map((p) => p._id)).not.toContain(own);
  });

  test("outsiders see nothing", async () => {
    const ctx = await setup();
    await restrict(ctx);
    const e = ctx.t.withIdentity(eve);
    expect(await e.query(api.projects.get, { projectId: ctx.apollo })).toBeNull();
    expect(await e.query(api.todos.get, { todoId: ctx.apolloTodo })).toBeNull();
    expect(await exportRows(e, ctx.apollo)).toEqual([]);
    await expect(e.mutation(api.projectAccess.grant, { projectId: ctx.apollo, userId: eve.subject })).rejects.toThrow(/not found/);
  });
});

describe("assignees", () => {
  test("must be active members with access to the project", async () => {
    const ctx = await setup();
    await restrict(ctx);
    const { a, apollo, borealis } = ctx;
    await expect(a.mutation(api.todos.create, { projectId: apollo, title: "x", date: DAY, assigneeId: carol.subject }))
      .rejects.toThrow(/access to this project/);
    await expect(a.mutation(api.todos.create, { projectId: apollo, title: "x", date: DAY, assigneeId: eve.subject }))
      .rejects.toThrow(/active member/);
    await a.mutation(api.todos.create, { projectId: apollo, title: "x", date: DAY, assigneeId: bob.subject });
    await a.mutation(api.todos.create, { projectId: borealis, title: "x", date: DAY, assigneeId: alice.subject });
    expect((await a.query(api.projectAccess.assignable, { projectId: apollo }))?.userIds.sort())
      .toEqual([alice.subject, bob.subject].sort());
  });

  test("after access removal: history is kept, the work leaves their list, an admin can reassign", async () => {
    const ctx = await setup();
    await restrict(ctx);
    const { a, b, apollo, apolloTodo } = ctx;
    expect(await a.mutation(api.projectAccess.revoke, { projectId: apollo, userId: bob.subject })).toEqual({ openAssigned: 1 });

    // Reads and writes stop immediately.
    expect(await b.query(api.todos.listForTeam, WEEK)).toEqual([]);
    await expect(b.mutation(api.todos.setStatus, { todoId: apolloTodo, status: "done" })).rejects.toThrow(/not found/);

    // The historical assignee is kept, and editing other fields doesn't drop it.
    await a.mutation(api.todos.update, { todoId: apolloTodo, title: "Renamed", date: DAY, assigneeId: bob.subject });
    expect(await a.query(api.todos.get, { todoId: apolloTodo })).toMatchObject({ assigneeId: bob.subject, title: "Renamed" });

    // Carry-over leaves the new copy unassigned; the original keeps Bob.
    await a.mutation(api.todos.carryOver, { projectId: apollo, date: DAY });
    const next = await a.query(api.todos.listForProject, { projectId: apollo, from: "2026-09-24", to: "2026-09-24" });
    expect(next).toHaveLength(1);
    expect(next[0].assigneeId).toBeUndefined();

    // Reassigning needs someone with access.
    await expect(a.mutation(api.todos.update, { todoId: next[0]._id, title: "Renamed", date: "2026-09-24", assigneeId: carol.subject }))
      .rejects.toThrow(/access/);
    await a.mutation(api.projectAccess.grant, { projectId: apollo, userId: carol.subject });
    await a.mutation(api.todos.update, { todoId: next[0]._id, title: "Renamed", date: "2026-09-24", assigneeId: carol.subject });
  });
});

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

type Call = { url: string; method: string; body: Record<string, unknown> | null };

describe("invitations", () => {
  let calls: Call[];
  let nextId: number;
  let previousKey: string | undefined;

  beforeEach(() => {
    calls = [];
    nextId = 0;
    previousKey = process.env.CLERK_SECRET_KEY;
    process.env.CLERK_SECRET_KEY = "sk_test_example";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      calls.push({ url, method, body });
      if (method === "POST" && url.endsWith("/invitations")) {
        return new Response(JSON.stringify({ id: `inv_${++nextId}`, status: "pending", expires_at: Date.now() + 86_400_000 }), { status: 200 });
      }
      if (method === "POST" && url.endsWith("/revoke")) return new Response(JSON.stringify({ id: "x", status: "revoked" }), { status: 200 });
      if (method === "DELETE") return new Response("{}", { status: 200 });
      if (method === "GET" && url.includes("/invitations/")) {
        return new Response(JSON.stringify({ id: url.split("/").pop(), status: "expired" }), { status: 200 });
      }
      return new Response(JSON.stringify({ errors: [{ message: "unexpected" }] }), { status: 500 });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousKey === undefined) delete process.env.CLERK_SECRET_KEY;
    else process.env.CLERK_SECRET_KEY = previousKey;
  });

  const grantsOf = (t: Ctx["t"], userId: string) =>
    t.run((ctx) => ctx.db.query("projectMemberships")
      .withIndex("by_org_user", (q) => q.eq("orgId", "org_a").eq("userId", userId)).collect());

  test("inviting validates the caller, role and projects server-side", async () => {
    const ctx = await setup();
    const { t, a, b, apollo } = ctx;
    const other = await t.withIdentity(eve).mutation(api.projects.create, { name: "Theirs", color: "#6366f1" });
    await expect(b.action(api.invitations.invite, { email: "x@example.com", role: "org:member", projectIds: [apollo] }))
      .rejects.toThrow(/admins/);
    await expect(a.action(api.invitations.invite, { email: "x@example.com", role: "org:owner", projectIds: [apollo] }))
      .rejects.toThrow(/Invalid role/);
    await expect(a.action(api.invitations.invite, { email: "x@example.com", role: "org:member", projectIds: [other] }))
      .rejects.toThrow(/Project not found/);
    await expect(a.action(api.invitations.invite, { email: "not-an-email", role: "org:member", projectIds: [] }))
      .rejects.toThrow(/valid email/);
    expect(calls).toEqual([]);
  });

  test("a pending invitation's projects are granted exactly once on acceptance", async () => {
    const ctx = await setup();
    const { t, a, apollo, borealis } = ctx;
    await a.mutation(api.projectAccess.setRestricted, { enabled: true });
    expect(await a.action(api.invitations.invite, { email: " Dave@Example.com ", role: "org:member", projectIds: [apollo] }))
      .toEqual({ outcome: "invited" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST", body: { email_address: "dave@example.com", role: "org:member", inviter_user_id: alice.subject },
    });
    expect(calls[0].url).toContain("/organizations/org_a/invitations");

    // Inviting the same email again adds projects to the pending invitation instead of a new email.
    expect(await a.action(api.invitations.invite, { email: "dave@example.com", role: "org:member", projectIds: [borealis] }))
      .toEqual({ outcome: "merged" });
    expect(calls).toHaveLength(1);
    const overview = await a.query(api.projectAccess.overview, {});
    expect(overview?.invitations).toMatchObject([{ email: "dave@example.com", status: "pending", projectIds: [apollo, borealis] }]);

    // Clerk: invitation accepted (with the new user id), then membership created. Retries included.
    await t.mutation(internal.invitations.applyAccepted, { invitationId: "inv_1", orgId: "org_a", userId: dave.subject });
    await t.mutation(internal.invitations.applyAccepted, { invitationId: "inv_1", orgId: "org_a", userId: dave.subject });
    await join(t, dave.subject, "org:member", "dave@example.com");
    expect((await grantsOf(t, dave.subject)).map((g) => g.projectId).sort()).toEqual([apollo, borealis].sort());
    expect((await a.query(api.projectAccess.overview, {}))?.invitations[0]).toMatchObject({ status: "accepted", acceptedUserId: dave.subject });

    // Revoking one project later isn't undone by a replayed event.
    await a.mutation(api.projectAccess.revoke, { projectId: borealis, userId: dave.subject });
    await t.mutation(internal.invitations.applyAccepted, { invitationId: "inv_1", orgId: "org_a", userId: dave.subject });
    expect((await t.withIdentity(dave).query(api.projects.list, {})).map((p) => p.name)).toEqual(["Apollo"]);
  });

  test("falls back to the membership webhook's email when the accepted event isn't delivered", async () => {
    const ctx = await setup();
    const { t, a, apollo } = ctx;
    await a.mutation(api.projectAccess.setRestricted, { enabled: true });
    await a.action(api.invitations.invite, { email: "dave@example.com", role: "org:member", projectIds: [apollo] });

    const previous = process.env.CLERK_WEBHOOK_SECRET;
    const secret = `whsec_${Buffer.from("test-signing-secret-32-bytes-long!!!").toString("base64")}`;
    process.env.CLERK_WEBHOOK_SECRET = secret;
    try {
      const payload = JSON.stringify({
        type: "organizationMembership.created",
        data: {
          id: "mem_dave", organization: { id: "org_a" }, role: "org:member", created_at: 50, updated_at: 50,
          public_user_data: { user_id: dave.subject, identifier: "Dave@example.com" },
        },
      });
      const timestamp = new Date();
      const response = await t.fetch("/clerk-webhook", {
        method: "POST",
        body: payload,
        headers: {
          "svix-id": "msg_dave", "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
          "svix-signature": new Webhook(secret).sign("msg_dave", timestamp, payload),
        },
      });
      expect(response.status).toBe(200);
    } finally {
      if (previous === undefined) delete process.env.CLERK_WEBHOOK_SECRET;
      else process.env.CLERK_WEBHOOK_SECRET = previous;
    }
    expect((await grantsOf(t, dave.subject)).map((g) => g.projectId)).toEqual([apollo]);
    expect((await t.withIdentity(dave).query(api.todos.listForTeam, WEEK)).map((x) => x.title)).toEqual(["Apollo work"]);
  });

  test("the signed invitation-accepted webhook applies grants", async () => {
    const ctx = await setup();
    const { t, a, apollo } = ctx;
    await a.action(api.invitations.invite, { email: "dave@example.com", role: "org:member", projectIds: [apollo] });
    const previous = process.env.CLERK_WEBHOOK_SECRET;
    const secret = `whsec_${Buffer.from("test-signing-secret-32-bytes-long!!!").toString("base64")}`;
    process.env.CLERK_WEBHOOK_SECRET = secret;
    try {
      const payload = JSON.stringify({
        type: "organizationInvitation.accepted",
        data: { id: "inv_1", organization_id: "org_a", user_id: dave.subject, email_address: "dave@example.com", status: "accepted" },
      });
      const timestamp = new Date();
      const response = await t.fetch("/clerk-webhook", {
        method: "POST",
        body: payload,
        headers: {
          "svix-id": "msg_inv", "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
          "svix-signature": new Webhook(secret).sign("msg_inv", timestamp, payload),
        },
      });
      expect(response.status).toBe(200);
    } finally {
      if (previous === undefined) delete process.env.CLERK_WEBHOOK_SECRET;
      else process.env.CLERK_WEBHOOK_SECRET = previous;
    }
    expect((await grantsOf(t, dave.subject)).map((g) => g.projectId)).toEqual([apollo]);
  });

  test("revoked invitations never grant; resend issues a new Clerk invitation", async () => {
    const ctx = await setup();
    const { t, a, b, apollo } = ctx;
    await a.action(api.invitations.invite, { email: "dave@example.com", role: "org:member", projectIds: [apollo] });
    const id = (await a.query(api.projectAccess.overview, {}))!.invitations[0]._id;
    await expect(b.action(api.invitations.revoke, { id })).rejects.toThrow(/admins/);

    await a.action(api.invitations.revoke, { id });
    expect(calls.at(-1)).toMatchObject({ method: "POST", body: { requesting_user_id: alice.subject } });
    expect(calls.at(-1)!.url).toContain("/invitations/inv_1/revoke");
    await t.mutation(internal.invitations.applyAccepted, { invitationId: "inv_1", orgId: "org_a", userId: dave.subject });
    expect(await grantsOf(t, dave.subject)).toEqual([]);

    // Resend: a fresh invitation with the same grants; the old id no longer applies.
    await a.action(api.invitations.resend, { id });
    expect((await a.query(api.projectAccess.overview, {}))!.invitations[0]).toMatchObject({ status: "pending" });
    await t.mutation(internal.invitations.applyAccepted, { invitationId: "inv_1", orgId: "org_a", userId: dave.subject });
    expect(await grantsOf(t, dave.subject)).toEqual([]);
    await t.mutation(internal.invitations.applyAccepted, { invitationId: "inv_2", orgId: "org_a", userId: dave.subject });
    expect((await grantsOf(t, dave.subject)).map((g) => g.projectId)).toEqual([apollo]);
    await expect(a.action(api.invitations.resend, { id })).rejects.toThrow(/already accepted/);
  });

  test("refresh marks invitations Clerk reports as expired", async () => {
    const { a, apollo } = await setup();
    await a.action(api.invitations.invite, { email: "dave@example.com", role: "org:member", projectIds: [apollo] });
    expect(await a.action(api.invitations.refresh, {})).toBe(1);
    expect((await a.query(api.projectAccess.overview, {}))!.invitations[0].status).toBe("expired");
  });

  test("inviting an existing member grants projects directly", async () => {
    const ctx = await setup();
    const { t, a, borealis } = ctx;
    await t.withIdentity(bob).mutation(api.users.store, {});
    expect(await a.action(api.invitations.invite, { email: "BOB@example.com", role: "org:member", projectIds: [borealis] }))
      .toEqual({ outcome: "granted" });
    expect(calls).toEqual([]);
    expect((await grantsOf(t, bob.subject)).map((g) => g.projectId)).toEqual([borealis]);
  });

  test("removing someone from the team ends their access immediately", async () => {
    const ctx = await setup();
    await restrict(ctx);
    const { t, a, b } = ctx;
    await expect(b.action(api.invitations.removeMember, { userId: carol.subject })).rejects.toThrow(/admins/);
    await expect(a.action(api.invitations.removeMember, { userId: alice.subject })).rejects.toThrow(/yourself/);
    await a.action(api.invitations.removeMember, { userId: bob.subject });
    expect(calls.at(-1)).toMatchObject({ method: "DELETE" });
    expect(calls.at(-1)!.url).toContain("/organizations/org_a/memberships/user_bob");
    expect(await grantsOf(t, bob.subject)).toEqual([]);
    expect(await b.query(api.projects.list, {})).toEqual([]);
    await expect(b.mutation(api.todos.create, { projectId: ctx.apollo, title: "x", date: DAY })).rejects.toThrow(/signed in/);
  });

  test("a membership.deleted webhook drops project grants", async () => {
    const ctx = await setup();
    await restrict(ctx);
    const { t } = ctx;
    const row = await t.run((c) => c.db.query("memberships")
      .withIndex("by_org_user", (q) => q.eq("orgId", "org_a").eq("userId", carol.subject)).unique());
    await t.mutation(internal.memberships.applyWebhook, {
      orgId: "org_a", userId: carol.subject, membershipId: row!.membershipId!, role: "org:member",
      active: false, createdAt: row!.membershipCreatedAt!, updatedAt: 10_000,
    });
    expect(await grantsOf(t, carol.subject)).toEqual([]);
  });
});
