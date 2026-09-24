import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const alice = { subject: "user_alice", name: "Alice", org_id: "org_a", org_role: "org:admin" };
const bob = { subject: "user_bob", name: "Bob", org_id: "org_a", org_role: "org:member" };
const eve = { subject: "user_eve", name: "Eve", org_id: "org_b", org_role: "org:admin" };

type Status = "todo" | "doing" | "done" | "not_done";

describe("projects.listWithStats", () => {
  test("counts todos per project and status within the range only", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(alice);
    const e = t.withIdentity(eve);
    const zeta = await a.mutation(api.projects.create, { name: "Zeta", color: "#6366f1" });
    const alpha = await a.mutation(api.projects.create, { name: "Alpha", color: "#0ea5e9" });
    const old = await a.mutation(api.projects.create, { name: "Old", color: "#10b981" });
    const empty = await a.mutation(api.projects.create, { name: "Empty", color: "#f59e0b" });
    await a.mutation(api.projects.setArchived, { projectId: old, archived: true });
    const other = await e.mutation(api.projects.create, { name: "Other team", color: "#ef4444" });

    const seed = async (orgId: string, projectId: Id<"projects">, date: string, status: Status) =>
      t.run((ctx) =>
        ctx.db.insert("todos", { orgId, projectId, title: "x", date, status, createdBy: "u", order: 0 }),
      );
    // In range (2026-09-21 .. 2026-09-27)
    await seed("org_a", zeta, "2026-09-21", "todo");
    await seed("org_a", zeta, "2026-09-21", "done");
    await seed("org_a", zeta, "2026-09-27", "done");
    await seed("org_a", alpha, "2026-09-23", "doing");
    await seed("org_a", alpha, "2026-09-24", "not_done");
    await seed("org_a", old, "2026-09-25", "done");
    // Out of range
    await seed("org_a", zeta, "2026-09-20", "todo");
    await seed("org_a", alpha, "2026-09-28", "done");
    // Other team, in range
    await seed("org_b", other, "2026-09-22", "todo");

    const rows = await a.query(api.projects.listWithStats, { from: "2026-09-21", to: "2026-09-27" });
    // Active first (by name), archived last.
    expect(rows.map((r) => r.name)).toEqual(["Alpha", "Empty", "Zeta", "Old"]);
    const byName = Object.fromEntries(rows.map((r) => [r.name, { counts: r.counts, total: r.total }]));
    expect(byName).toEqual({
      Alpha: { counts: { todo: 0, doing: 1, done: 0, not_done: 1 }, total: 2 },
      Empty: { counts: { todo: 0, doing: 0, done: 0, not_done: 0 }, total: 0 },
      Zeta: { counts: { todo: 1, doing: 0, done: 2, not_done: 0 }, total: 3 },
      Old: { counts: { todo: 0, doing: 0, done: 1, not_done: 0 }, total: 1 },
    });
    // Response carries the full project document alongside the stats.
    const zetaRow = rows.find((r) => r._id === zeta)!;
    expect(zetaRow).toMatchObject({ _id: zeta, orgId: "org_a", name: "Zeta", color: "#6366f1", archived: false, createdBy: "user_alice" });
    expect(Object.keys(zetaRow).sort()).toEqual(
      ["_creationTime", "_id", "archived", "color", "counts", "createdBy", "name", "orgId", "total"].sort(),
    );
    expect(rows.find((r) => r._id === empty)!.total).toBe(0);

    const eveRows = await e.query(api.projects.listWithStats, { from: "2026-09-21", to: "2026-09-27" });
    expect(eveRows.map((r) => [r.name, r.total])).toEqual([["Other team", 1]]);
  });
});

describe("projects.remove (batched)", () => {
  // Convex caps writes per transaction (16,000 docs in production). Scale the cap down so a
  // 1,500-todo project reproduces the "delete everything in one transaction" failure.
  const WRITE_LIMIT = 1_000;
  const TODOS = 1_500;

  async function seedBigProject() {
    const t = convexTest({ schema, modules, transactionLimits: { documentsWritten: WRITE_LIMIT } });
    const a = t.withIdentity(alice);
    const big = await a.mutation(api.projects.create, { name: "Big", color: "#6366f1" });
    const keep = await a.mutation(api.projects.create, { name: "Keep", color: "#0ea5e9" });
    for (let start = 0; start < TODOS; start += 500) {
      await t.run(async (ctx) => {
        for (let i = start; i < Math.min(start + 500, TODOS); i++) {
          await ctx.db.insert("todos", {
            orgId: "org_a",
            projectId: big,
            title: `t${i}`,
            date: "2026-09-21",
            status: "todo",
            createdBy: "user_alice",
            order: i,
          });
        }
      });
    }
    await a.mutation(api.todos.create, { projectId: big, title: "Logged", date: "2026-09-21" });
    await a.mutation(api.todos.create, { projectId: keep, title: "Survivor", date: "2026-09-21" });
    return { t, a, big, keep };
  }

  const countTodos = (t: Awaited<ReturnType<typeof seedBigProject>>["t"], projectId: Id<"projects">) =>
    t.run(async (ctx) =>
      (await ctx.db.query("todos").withIndex("by_project_date", (q) => q.eq("projectId", projectId)).collect()).length,
    );

  test(`deletes a project with > ${TODOS} todos in batches, hiding it immediately`, async () => {
    vi.useFakeTimers();
    try {
      const { t, a, big, keep } = await seedBigProject();
      expect(await countTodos(t, big)).toBe(TODOS + 1);

      await a.mutation(api.projects.remove, { projectId: big });

      // Hidden immediately, before any batch has run.
      expect((await a.query(api.projects.list, { includeArchived: true })).map((p) => p.name)).toEqual(["Keep"]);
      expect((await a.query(api.projects.listWithStats, { from: "2026-09-21", to: "2026-09-21" })).map((p) => p.name)).toEqual(["Keep"]);
      expect(await a.query(api.projects.get, { projectId: big })).toBeNull();

      await t.finishAllScheduledFunctions(vi.runAllTimers);

      expect(await countTodos(t, big)).toBe(0);
      expect(await t.run((ctx) => ctx.db.get(big))).toBeNull();
      expect(await countTodos(t, keep)).toBe(1);

      // Logged exactly once; the todo history is kept.
      const log = await t.run((ctx) => ctx.db.query("activity").collect());
      expect(log.filter((r) => r.action === "project_deleted")).toHaveLength(1);
      expect(log.some((r) => r.action === "created" && r.todoTitle === "Logged")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("removing an already-deleting project is a no-op and logs once", async () => {
    vi.useFakeTimers();
    try {
      const { t, a, big } = await seedBigProject();
      await a.mutation(api.projects.remove, { projectId: big });
      await a.mutation(api.projects.remove, { projectId: big });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const log = await t.run((ctx) => ctx.db.query("activity").collect());
      expect(log.filter((r) => r.action === "project_deleted")).toHaveLength(1);
      expect(await t.run((ctx) => ctx.db.get(big))).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("projects.setArchived", () => {
  test("only admins can archive or restore", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(alice);
    const b = t.withIdentity(bob);
    const projectId = await a.mutation(api.projects.create, { name: "Board", color: "#6366f1" });

    await expect(b.mutation(api.projects.setArchived, { projectId, archived: true })).rejects.toThrow(
      /Only team admins/,
    );
    expect((await t.run((ctx) => ctx.db.get(projectId)))?.archived).toBeFalsy();

    await a.mutation(api.projects.setArchived, { projectId, archived: true });
    await expect(b.mutation(api.projects.setArchived, { projectId, archived: false })).rejects.toThrow(
      /Only team admins/,
    );
    expect((await t.run((ctx) => ctx.db.get(projectId)))?.archived).toBe(true);

    await a.mutation(api.projects.setArchived, { projectId, archived: false });
    expect((await t.run((ctx) => ctx.db.get(projectId)))?.archived).toBe(false);
  });
});
