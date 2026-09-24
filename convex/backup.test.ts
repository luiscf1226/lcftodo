import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { TEAM_EXPORT_TABLES, type TeamExportTable } from "./lib/constants";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const alice = { subject: "user_alice", name: "Alice", org_id: "org_a", org_role: "org:admin" };
const bob = { subject: "user_bob", name: "Bob", org_id: "org_a", org_role: "org:member" };
const eve = { subject: "user_eve", name: "Eve", org_id: "org_b", org_role: "org:admin" };

type T = ReturnType<typeof convexTest>;
type Caller = ReturnType<T["withIdentity"]>;

async function exportAll(caller: Caller, table: TeamExportTable, numItems = 2) {
  const rows: { orgId: string }[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { page: { orgId: string }[]; isDone: boolean; continueCursor: string } = await caller.query(
      api.backup.teamExportPage,
      { table, paginationOpts: { numItems, cursor } },
    );
    rows.push(...page.page);
    if (page.isDone) return rows;
    cursor = page.continueCursor;
  }
}

async function seedTwoTeams(t: T) {
  const a = t.withIdentity(alice);
  const e = t.withIdentity(eve);
  for (const [caller, prefix, orgId] of [
    [a, "A", "org_a"],
    [e, "E", "org_b"],
  ] as const) {
    const projectId = await caller.mutation(api.projects.create, { name: `${prefix} project`, color: "#6366f1" });
    const todoIds: Id<"todos">[] = [];
    for (let i = 0; i < 3; i++) {
      const todoId = await caller.mutation(api.todos.create, {
        projectId,
        title: `${prefix} ${i}`,
        date: `2025-0${i + 1}-15`,
      });
      await caller.mutation(api.todos.setStatus, { todoId, status: "done" });
      todoIds.push(todoId);
    }
    // Tables without activity side effects are seeded directly.
    await t.run(async (ctx) => {
      await ctx.db.insert("teamSettings", {
        orgId,
        timeZone: "UTC",
        autoCarryOver: false,
        updatedBy: "x",
        updatedAt: 1,
      });
      await ctx.db.insert("recurrences", {
        orgId,
        projectId,
        title: "Standup",
        rule: { kind: "daily" },
        startDate: "2025-01-01",
        createdBy: "x",
      });
      for (const body of ["first", "second"]) {
        await ctx.db.insert("comments", { orgId, projectId, todoId: todoIds[0], authorId: "x", body });
      }
      await ctx.db.insert("projectMemberships", { orgId, projectId, userId: "x", grantedBy: "x", grantedAt: 1 });
      await ctx.db.insert("projectInvitations", {
        orgId,
        invitationId: `inv_${orgId}`,
        email: `new@${orgId}.test`,
        role: "org:member",
        projectIds: [projectId],
        status: "pending",
        invitedBy: "x",
        createdAt: 1,
        updatedAt: 1,
      });
    });
  }
  for (const [orgId, userId] of [
    ["org_a", "user_alice"],
    ["org_a", "user_bob"],
    ["org_b", "user_eve"],
  ]) {
    await t.mutation(internal.memberships.applyWebhook, {
      orgId,
      userId,
      membershipId: `mem_${userId}`,
      role: userId === "user_bob" ? "org:member" : "org:admin",
      active: true,
      createdAt: 1,
      updatedAt: 100,
    });
  }
  return { a, e };
}

describe("backup.teamExportPage", () => {
  test("pages through every table for the admin's team only, all time", async () => {
    const t = convexTest(schema, modules);
    const { a, e } = await seedTwoTeams(t);
    const expected: Record<TeamExportTable, number> = {
      teamSettings: 1,
      projects: 1,
      todos: 3,
      recurrences: 1,
      comments: 2,
      activity: 7,
      memberships: 2,
      projectMemberships: 1,
      projectInvitations: 1,
    };
    for (const table of TEAM_EXPORT_TABLES) {
      const rows = await exportAll(a, table);
      expect(rows, table).toHaveLength(expected[table]);
      expect(
        rows.every((r) => r.orgId === "org_a"),
        table,
      ).toBe(true);
      const other = await exportAll(e, table);
      expect(
        other.every((r) => r.orgId === "org_b"),
        table,
      ).toBe(true);
    }
  });

  test("rejects non-admins and signed-out callers", async () => {
    const t = convexTest(schema, modules);
    await seedTwoTeams(t);
    const b = t.withIdentity(bob);
    for (const table of TEAM_EXPORT_TABLES) {
      await expect(
        b.query(api.backup.teamExportPage, { table, paginationOpts: { numItems: 10, cursor: null } }),
      ).rejects.toThrow(/admins/);
      await expect(
        t.query(api.backup.teamExportPage, { table, paginationOpts: { numItems: 10, cursor: null } }),
      ).rejects.toThrow(/signed in/);
    }
  });

  test("uses the synced membership role, not a stale admin token", async () => {
    const t = convexTest(schema, modules);
    const { a } = await seedTwoTeams(t);
    await t.mutation(internal.memberships.applyWebhook, {
      orgId: "org_a",
      userId: "user_alice",
      membershipId: "mem_user_alice",
      role: "org:member",
      active: true,
      createdAt: 1,
      updatedAt: 200,
    });
    await t.mutation(internal.memberships.completeBackfill, { orgId: "org_a", startedAt: 100 });
    await expect(
      a.query(api.backup.teamExportPage, { table: "todos", paginationOpts: { numItems: 10, cursor: null } }),
    ).rejects.toThrow(/admins/);
  });

  test("clamps oversized pages", async () => {
    const t = convexTest(schema, modules);
    const { a } = await seedTwoTeams(t);
    const page = await a.query(api.backup.teamExportPage, {
      table: "todos",
      paginationOpts: { numItems: 1_000_000, cursor: null },
    });
    expect(page.page).toHaveLength(3);
    expect(page.isDone).toBe(true);
  });
});
