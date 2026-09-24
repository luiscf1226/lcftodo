import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { Webhook } from "svix";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const clerkMember = (userId: string, role = "org:member") => ({
  id: `mem_${userId}`, role, created_at: 1, updated_at: 1, public_user_data: { user_id: userId },
});
const clerkPage = (data: object[], total: number) =>
  new Response(JSON.stringify({ data, total_count: total }), { status: 200 });

const alice = { subject: "user_alice", name: "Alice", org_id: "org_a", org_role: "org:admin" };
const eve = { subject: "user_eve", name: "Eve", org_id: "org_b", org_role: "org:admin" };

describe("team membership boundaries", () => {
  test("cannot resolve another team's profile", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(alice);
    const e = t.withIdentity(eve);
    await a.mutation(api.users.store, {});
    await e.mutation(api.users.store, {});
    expect(await a.query(api.users.byClerkIds, { clerkIds: ["user_alice", "user_eve"] })).toMatchObject([
      { clerkId: "user_alice", name: "Alice" },
    ]);
  });

  test("cannot assign a team A todo to a team B member", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(alice);
    await t.withIdentity(eve).mutation(api.users.store, {});
    const projectId = await a.mutation(api.projects.create, { name: "Private", color: "#6366f1" });
    await expect(a.mutation(api.todos.create, {
      projectId, title: "Secret", date: "2026-09-23", assigneeId: "user_eve",
    })).rejects.toThrow(/Assignee/);
  });

  test("webhook changes roles and removal wins over a stale token after backfill", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(alice);
    await t.mutation(internal.memberships.applyWebhook, {
      orgId: "org_a", userId: alice.subject, membershipId: "mem_alice", role: "org:member",
      active: true, createdAt: 1, updatedAt: 100,
    });
    await t.mutation(internal.memberships.completeBackfill, { orgId: "org_a", startedAt: 100 });
    const projectId = await a.mutation(api.projects.create, { name: "A", color: "#6366f1" });
    await expect(a.mutation(api.projects.remove, { projectId })).rejects.toThrow(/admins/);
    await t.mutation(internal.memberships.applyWebhook, {
      orgId: "org_a", userId: alice.subject, membershipId: "mem_alice", role: "org:admin",
      active: true, createdAt: 1, updatedAt: 200,
    });
    await a.mutation(api.projects.setArchived, { projectId, archived: true });
    await t.mutation(internal.memberships.applyWebhook, {
      orgId: "org_a", userId: alice.subject, membershipId: "mem_alice", role: "org:member",
      active: false, createdAt: 1, updatedAt: 300,
    });
    await t.mutation(internal.memberships.applyWebhook, {
      orgId: "org_a", userId: alice.subject, membershipId: "mem_alice", role: "org:admin",
      active: true, createdAt: 1, updatedAt: 250,
    });
    await expect(a.mutation(api.projects.create, { name: "Denied", color: "#6366f1" })).rejects.toThrow(/team/);
    expect(await a.query(api.projects.list, {})).toEqual([]);
  });

  test("former team members remain resolvable for history but cannot receive new work", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(alice);
    const bob = t.withIdentity({ subject: "user_bob", name: "Bob", org_id: "org_a", org_role: "org:member" });
    await bob.mutation(api.users.store, {});
    await t.mutation(internal.memberships.applyWebhook, {
      orgId: "org_a", userId: "user_bob", membershipId: "mem_user_bob", role: "org:member",
      active: true, createdAt: 1, updatedAt: 100,
    });
    const projectId = await a.mutation(api.projects.create, { name: "A", color: "#6366f1" });
    await a.mutation(api.todos.create, { projectId, title: "Before", date: "2026-09-23", assigneeId: "user_bob" });
    await t.mutation(internal.memberships.applyWebhook, {
      orgId: "org_a", userId: "user_bob", membershipId: "mem_user_bob", role: "org:member",
      active: false, createdAt: 1, updatedAt: 200,
    });
    expect(await a.query(api.users.byClerkIds, { clerkIds: ["user_bob"] })).toMatchObject([
      { clerkId: "user_bob", name: "Bob" },
    ]);
    await expect(a.mutation(api.todos.create, {
      projectId, title: "After", date: "2026-09-23", assigneeId: "user_bob",
    })).rejects.toThrow(/Assignee/);
  });

  test("backfill reconciles members and deactivates stale rows", async () => {
    const t = convexTest(schema, modules);
    const startedAt = Date.now() + 1000;
    await t.mutation(internal.memberships.applyWebhook, {
      orgId: "org_a", userId: "user_old", membershipId: "mem_user_old", role: "org:member",
      active: true, createdAt: 1, updatedAt: 10,
    });
    await t.mutation(internal.memberships.applyBackfillPage, {
      orgId: "org_a", runId: "run_1", startedAt,
      members: [{ membershipId: "mem_alice", userId: "user_alice", role: "org:admin", createdAt: 1, updatedAt: 1 }],
    });
    const result = await t.mutation(internal.memberships.finishBackfillPage, {
      orgId: "org_a", runId: "run_1", startedAt, cursor: null,
    });
    expect(result.isDone).toBe(true);
    await t.mutation(internal.memberships.completeBackfill, { orgId: "org_a", startedAt });
    const rows = await t.run((ctx) => ctx.db.query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", "org_a")).collect());
    expect(rows.map((row) => [row.userId, row.active]).sort()).toEqual([
      ["user_alice", true], ["user_old", false],
    ]);
  });

  test("a removal delivered during backfill is not restored by an older snapshot", async () => {
    const t = convexTest(schema, modules);
    const startedAt = Date.now() - 1000;
    await t.mutation(internal.memberships.applyWebhook, {
      orgId: "org_a", userId: "user_bob", membershipId: "mem_user_bob", role: "org:member",
      active: false, createdAt: 1, updatedAt: 300,
    });
    await t.mutation(internal.memberships.applyBackfillPage, {
      orgId: "org_a", runId: "run_race", startedAt,
      members: [{ membershipId: "mem_user_bob", userId: "user_bob", role: "org:member", createdAt: 1, updatedAt: 1 }],
    });
    const row = await t.run((ctx) => ctx.db.query("memberships")
      .withIndex("by_org_user", (q) => q.eq("orgId", "org_a").eq("userId", "user_bob")).unique());
    expect(row?.active).toBe(false);
  });

  test("backfill requires a team admin and imports Clerk's paginated response", async () => {
    const previous = process.env.CLERK_SECRET_KEY;
    process.env.CLERK_SECRET_KEY = "sk_test_example";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => clerkPage([
      clerkMember("user_alice", "org:admin"),
    ], 1));
    try {
      const t = convexTest(schema, modules);
      const member = t.withIdentity({ subject: "user_bob", org_id: "org_a", org_role: "org:member" });
      await expect(member.action(api.memberships.backfill, {})).rejects.toThrow(/admins/);
      const admin = t.withIdentity(alice);
      expect(await admin.action(api.memberships.backfill, {})).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(fetchMock.mock.calls[0][0])).toContain("org_a/memberships");
      const rows = await t.run((ctx) => ctx.db.query("memberships")
        .withIndex("by_org", (q) => q.eq("orgId", "org_a")).collect());
      expect(rows).toMatchObject([{ userId: "user_alice", role: "org:admin", active: true }]);
    } finally {
      fetchMock.mockRestore();
      if (previous === undefined) delete process.env.CLERK_SECRET_KEY;
      else process.env.CLERK_SECRET_KEY = previous;
    }
  });

  test("webhook rejects a bad signature and applies a signed membership event", async () => {
    const previous = process.env.CLERK_WEBHOOK_SECRET;
    const secret = `whsec_${Buffer.from("test-signing-secret-32-bytes-long!!!").toString("base64")}`;
    process.env.CLERK_WEBHOOK_SECRET = secret;
    try {
      const t = convexTest(schema, modules);
      const payload = JSON.stringify({
        type: "organizationMembership.created",
        data: {
          id: "mem_user_bob", organization: { id: "org_a" }, public_user_data: { user_id: "user_bob" },
          role: "org:member", created_at: 1, updated_at: 1,
        },
      });
      const timestamp = new Date();
      const id = "msg_123";
      const signature = new Webhook(secret).sign(id, timestamp, payload);
      const headers = {
        "svix-id": id, "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
        "svix-signature": signature,
      };
      const invalid = await t.fetch("/clerk-webhook", { method: "POST", headers, body: payload.replace("user_bob", "user_eve") });
      expect(invalid.status).toBe(400);
      const valid = await t.fetch("/clerk-webhook", { method: "POST", headers, body: payload });
      expect(valid.status).toBe(200);
      const row = await t.run((ctx) => ctx.db.query("memberships")
        .withIndex("by_org_user", (q) => q.eq("orgId", "org_a").eq("userId", "user_bob")).unique());
      expect(row).toMatchObject({ role: "org:member", active: true });
    } finally {
      if (previous === undefined) delete process.env.CLERK_WEBHOOK_SECRET;
      else process.env.CLERK_WEBHOOK_SECRET = previous;
    }
  });

  test("signed profile updates refresh the user and deletion removes access", async () => {
    const previous = process.env.CLERK_WEBHOOK_SECRET;
    const secret = `whsec_${Buffer.from("another-test-signing-secret-32bytes").toString("base64")}`;
    process.env.CLERK_WEBHOOK_SECRET = secret;
    try {
      const t = convexTest(schema, modules);
      const timestamp = new Date();
      const send = async (type: string, data: object) => {
        const payload = JSON.stringify({ type, data });
        const id = `msg_${type}`;
        return t.fetch("/clerk-webhook", {
          method: "POST",
          headers: {
            "svix-id": id,
            "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
            "svix-signature": new Webhook(secret).sign(id, timestamp, payload),
          },
          body: payload,
        });
      };
      expect((await send("organizationMembership.created", {
        id: "mem_user_bob", organization: { id: "org_a" }, public_user_data: { user_id: "user_bob" },
        role: "org:member", created_at: 1, updated_at: 1,
      })).status).toBe(200);
      expect((await send("user.updated", {
        id: "user_bob", updated_at: 1, first_name: "Bobby", last_name: "Jones", image_url: "https://example.com/b.png",
        primary_email_address_id: "email_1",
        email_addresses: [{ id: "email_1", email_address: "bob@example.com" }],
      })).status).toBe(200);
      const a = t.withIdentity(alice);
      expect(await a.query(api.users.byClerkIds, { clerkIds: ["user_bob"] })).toMatchObject([
        { clerkId: "user_bob", name: "Bobby Jones", imageUrl: "https://example.com/b.png" },
      ]);
      await t.withIdentity({ subject: "user_bob", name: "Old Bob", org_id: "org_a", org_role: "org:member" })
        .mutation(api.users.store, {});
      expect(await a.query(api.users.byClerkIds, { clerkIds: ["user_bob"] })).toMatchObject([
        { clerkId: "user_bob", name: "Bobby Jones" },
      ]);
      expect((await send("user.deleted", { id: "user_bob" })).status).toBe(200);
      expect(await a.query(api.users.byClerkIds, { clerkIds: ["user_bob"] })).toEqual([]);
      const row = await t.run((ctx) => ctx.db.query("memberships")
        .withIndex("by_org_user", (q) => q.eq("orgId", "org_a").eq("userId", "user_bob")).unique());
      expect(row?.active).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.CLERK_WEBHOOK_SECRET;
      else process.env.CLERK_WEBHOOK_SECRET = previous;
    }
  });

  test("a retried older event for a deleted membership never reactivates it", async () => {
    const previous = process.env.CLERK_WEBHOOK_SECRET;
    const secret = `whsec_${Buffer.from("retry-test-signing-secret-32-bytes!!").toString("base64")}`;
    process.env.CLERK_WEBHOOK_SECRET = secret;
    try {
      const t = convexTest(schema, modules);
      let attempt = 0;
      const send = async (type: string, data: object) => {
        const payload = JSON.stringify({ type, data });
        const id = `msg_${type}`;
        // Svix re-signs each delivery attempt with the attempt's own, later timestamp.
        const timestamp = new Date(Date.now() + 1000 * ++attempt);
        return t.fetch("/clerk-webhook", {
          method: "POST",
          headers: {
            "svix-id": id,
            "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
            "svix-signature": new Webhook(secret).sign(id, timestamp, payload),
          },
          body: payload,
        });
      };
      const bob = (id: string, createdAt: number, updatedAt: number) => ({
        id, organization: { id: "org_a" }, public_user_data: { user_id: "user_bob" },
        role: "org:member", created_at: createdAt, updated_at: updatedAt,
      });
      const row = () => t.run((ctx) => ctx.db.query("memberships")
        .withIndex("by_org_user", (q) => q.eq("orgId", "org_a").eq("userId", "user_bob")).unique());

      expect((await send("organizationMembership.deleted", bob("mem_1", 100, 100))).status).toBe(200);
      expect((await send("organizationMembership.created", bob("mem_1", 100, 100))).status).toBe(200);
      expect((await send("organizationMembership.updated", bob("mem_1", 100, 150))).status).toBe(200);
      expect(await row()).toMatchObject({ active: false });

      expect((await send("organizationMembership.created", bob("mem_2", 500, 500))).status).toBe(200);
      expect(await row()).toMatchObject({ active: true, membershipId: "mem_2" });

      await t.mutation(internal.memberships.applyWebhook, {
        orgId: "org_a", userId: "user_bob", membershipId: "mem_0", role: "org:admin",
        active: true, createdAt: 50, updatedAt: 900,
      });
      await t.mutation(internal.memberships.applyWebhook, {
        orgId: "org_a", userId: "user_bob", membershipId: "mem_0", role: "org:admin",
        active: false, createdAt: 50, updatedAt: 900,
      });
      await t.mutation(internal.memberships.applyWebhook, {
        orgId: "org_a", userId: "user_bob", membershipId: "mem_2", role: "org:admin",
        active: true, createdAt: 500, updatedAt: 400,
      });
      expect(await row()).toMatchObject({ active: true, membershipId: "mem_2", role: "org:member" });
    } finally {
      if (previous === undefined) delete process.env.CLERK_WEBHOOK_SECRET;
      else process.env.CLERK_WEBHOOK_SECRET = previous;
    }
  });

  test("backfill fails without enabling access when Clerk's list changes between reads", async () => {
    const previous = process.env.CLERK_SECRET_KEY;
    process.env.CLERK_SECRET_KEY = "sk_test_example";
    // user_bob is removed and user_dave added mid-read, so offset paging skips
    // user_carol while total_count stays 3; only the second read exposes it.
    const reads = [
      clerkPage([clerkMember("user_alice", "org:admin"), clerkMember("user_bob")], 3),
      clerkPage([clerkMember("user_dave")], 3),
      clerkPage([clerkMember("user_alice", "org:admin"), clerkMember("user_carol")], 3),
      clerkPage([clerkMember("user_dave")], 3),
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => reads.shift()!);
    try {
      const t = convexTest(schema, modules);
      await t.mutation(internal.memberships.applyWebhook, {
        orgId: "org_a", userId: "user_carol", membershipId: "mem_user_carol", role: "org:member",
        active: true, createdAt: 1, updatedAt: 1,
      });
      const admin = t.withIdentity(alice);
      await expect(admin.action(api.memberships.backfill, {})).rejects.toThrow(/changed/);

      reads.push(
        clerkPage([clerkMember("user_alice", "org:admin"), clerkMember("user_carol")], 2),
        clerkPage([clerkMember("user_alice", "org:admin"), clerkMember("user_carol", "org:admin")], 2),
      );
      await expect(admin.action(api.memberships.backfill, {})).rejects.toThrow(/changed/);

      reads.push(clerkPage([clerkMember("user_alice", "org:admin"), clerkMember("user_alice")], 2));
      await expect(admin.action(api.memberships.backfill, {})).rejects.toThrow(/changed/);

      const carol = await t.run((ctx) => ctx.db.query("memberships")
        .withIndex("by_org_user", (q) => q.eq("orgId", "org_a").eq("userId", "user_carol")).unique());
      expect(carol?.active).toBe(true);
      const sync = await t.run((ctx) => ctx.db.query("membershipSync")
        .withIndex("by_org", (q) => q.eq("orgId", "org_a")).unique());
      expect(sync).toBeNull();
    } finally {
      fetchMock.mockRestore();
      if (previous === undefined) delete process.env.CLERK_SECRET_KEY;
      else process.env.CLERK_SECRET_KEY = previous;
    }
  });

  test("backfill does not restore a membership whose deletion was already delivered", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.memberships.applyWebhook, {
      orgId: "org_a", userId: "user_bob", membershipId: "mem_user_bob", role: "org:member",
      active: false, createdAt: 1, updatedAt: 1,
    });
    await t.run((ctx) => ctx.db.query("memberships").first()
      .then((row) => ctx.db.patch(row!._id, { updatedAt: 0 })));
    await t.mutation(internal.memberships.applyBackfillPage, {
      orgId: "org_a", runId: "run_late", startedAt: 10,
      members: [{ membershipId: "mem_user_bob", userId: "user_bob", role: "org:member", createdAt: 1, updatedAt: 1 }],
    });
    const row = await t.run((ctx) => ctx.db.query("memberships").first());
    expect(row?.active).toBe(false);
  });

  test("profile webhooks apply in Clerk updated_at order and a deleted user stays deleted", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.memberships.applyWebhook, {
      orgId: "org_a", userId: "user_bob", membershipId: "mem_user_bob", role: "org:member",
      active: true, createdAt: 1, updatedAt: 1,
    });
    const a = t.withIdentity(alice);
    await t.mutation(internal.users.upsertFromWebhook, { clerkId: "user_bob", name: "Bob New", updatedAt: 200 });
    await t.mutation(internal.users.upsertFromWebhook, { clerkId: "user_bob", name: "Bob Old", updatedAt: 100 });
    expect(await a.query(api.users.byClerkIds, { clerkIds: ["user_bob"] })).toMatchObject([{ name: "Bob New" }]);

    await t.mutation(internal.users.deleteFromWebhook, { clerkId: "user_bob" });
    await t.mutation(internal.users.upsertFromWebhook, { clerkId: "user_bob", name: "Bob Retry", updatedAt: 300 });
    await t.mutation(internal.memberships.applyWebhook, {
      orgId: "org_a", userId: "user_bob", membershipId: "mem_user_bob", role: "org:member",
      active: true, createdAt: 1, updatedAt: 300,
    });
    expect(await a.query(api.users.byClerkIds, { clerkIds: ["user_bob"] })).toEqual([]);
    const row = await t.run((ctx) => ctx.db.query("memberships")
      .withIndex("by_org_user", (q) => q.eq("orgId", "org_a").eq("userId", "user_bob")).unique());
    expect(row?.active).toBe(false);
  });
});
