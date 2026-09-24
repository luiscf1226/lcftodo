import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const alice = { subject: "user_alice", name: "Alice", org_id: "org_a", org_role: "org:admin" };
const eve = { subject: "user_eve", name: "Eve", org_id: "org_b", org_role: "org:admin" };

async function setup() {
  const t = convexTest(schema, modules);
  const a = t.withIdentity(alice);
  const e = t.withIdentity(eve);
  const launch = await a.mutation(api.projects.create, { name: "Launch", color: "#6366f1" });
  const ops = await a.mutation(api.projects.create, { name: "Ops", color: "#0ea5e9" });
  const eveProject = await e.mutation(api.projects.create, { name: "Rival", color: "#ef4444" });
  return { t, a, e, launch, ops, eveProject };
}

describe("search.todos", () => {
  test("finds titles across projects and weeks with project details", async () => {
    const { a, launch, ops } = await setup();
    await a.mutation(api.todos.create, { projectId: launch, title: "Write launch copy", date: "2026-09-21" });
    await a.mutation(api.todos.create, { projectId: ops, title: "Rotate launch keys", date: "2026-03-02" });
    await a.mutation(api.todos.create, { projectId: ops, title: "Unrelated", date: "2026-09-22" });

    const results = await a.query(api.search.todos, { query: "launch" });
    expect(results.map((r) => r.title).sort()).toEqual(["Rotate launch keys", "Write launch copy"]);
    const rotate = results.find((r) => r.title === "Rotate launch keys")!;
    expect(rotate).toMatchObject({ projectId: ops, projectName: "Ops", date: "2026-03-02", status: "todo" });
  });

  test("never returns another team's todos", async () => {
    const { a, e, launch, eveProject } = await setup();
    await a.mutation(api.todos.create, { projectId: launch, title: "Secret roadmap", date: "2026-09-21" });
    await e.mutation(api.todos.create, { projectId: eveProject, title: "Public roadmap", date: "2026-09-21" });

    expect((await a.query(api.search.todos, { query: "roadmap" })).map((r) => r.title)).toEqual(["Secret roadmap"]);
    expect((await e.query(api.search.todos, { query: "roadmap" })).map((r) => r.title)).toEqual(["Public roadmap"]);
    expect(await e.query(api.search.todos, { query: "secret" })).toEqual([]);
  });

  test("follows the caller's active team when they switch", async () => {
    const { t, a, launch } = await setup();
    await a.mutation(api.todos.create, { projectId: launch, title: "Team A plan", date: "2026-09-21" });
    const aliceInB = t.withIdentity({ ...alice, org_id: "org_b" });
    expect(await aliceInB.query(api.search.todos, { query: "plan" })).toEqual([]);
  });

  test("blank queries return nothing and callers need a team", async () => {
    const { t, a, launch } = await setup();
    await a.mutation(api.todos.create, { projectId: launch, title: "Anything", date: "2026-09-21" });
    expect(await a.query(api.search.todos, { query: "   " })).toEqual([]);
    await expect(t.query(api.search.todos, { query: "anything" })).rejects.toThrow(/team/);
    await expect(t.withIdentity({ subject: "user_x" }).query(api.search.todos, { query: "anything" })).rejects.toThrow(
      /team/,
    );
  });

  test("hides todos of projects that are being deleted but keeps archived ones", async () => {
    const { t, a, launch, ops } = await setup();
    await a.mutation(api.todos.create, { projectId: launch, title: "Archived task", date: "2026-09-21" });
    await a.mutation(api.todos.create, { projectId: ops, title: "Doomed task", date: "2026-09-21" });
    await t.run(async (ctx) => {
      await ctx.db.patch(launch, { archived: true });
      await ctx.db.patch(ops, { deleting: true });
    });
    const results = await a.query(api.search.todos, { query: "task" });
    expect(results.map((r) => [r.title, r.projectArchived])).toEqual([["Archived task", true]]);
  });

  test("caps the number of results", async () => {
    const { t, launch } = await setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 40; i++) {
        await ctx.db.insert("todos", {
          orgId: "org_a",
          projectId: launch,
          title: `Bulk item ${i}`,
          date: "2026-09-21",
          status: "todo",
          createdBy: "user_alice",
          order: i,
        });
      }
    });
    expect(await t.withIdentity(alice).query(api.search.todos, { query: "bulk" })).toHaveLength(20);
  });
});
