import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const alice = { subject: "user_alice", name: "Alice", org_id: "org_a", org_role: "org:admin" };
const bob = { subject: "user_bob", name: "Bob", org_id: "org_a", org_role: "org:member" };
const eve = { subject: "user_eve", name: "Eve", org_id: "org_b", org_role: "org:admin" };

async function setup() {
  const t = convexTest(schema, modules);
  const a = t.withIdentity(alice);
  const projectId = await a.mutation(api.projects.create, { name: "Launch", color: "#6366f1" });
  return { t, a, b: t.withIdentity(bob), e: t.withIdentity(eve), projectId };
}

describe("team scoping", () => {
  test("members of the same team share projects and todos", async () => {
    const { a, b, projectId } = await setup();
    await b.mutation(api.todos.create, { projectId, title: "Write copy", date: "2026-09-21" });
    const todos = await a.query(api.todos.listForProject, { projectId, from: "2026-09-21", to: "2026-09-27" });
    expect(todos.map((t) => t.title)).toEqual(["Write copy"]);
  });

  test("other teams cannot see or modify data", async () => {
    const { a, e, projectId } = await setup();
    const todoId = await a.mutation(api.todos.create, { projectId, title: "Secret", date: "2026-09-21" });
    expect(await e.query(api.projects.list, {})).toEqual([]);
    expect(await e.query(api.projects.get, { projectId })).toBeNull();
    expect(await e.query(api.todos.listForProject, { projectId, from: "2026-01-01", to: "2026-12-31" })).toEqual([]);
    await expect(e.mutation(api.todos.setStatus, { todoId, status: "done" })).rejects.toThrow(/not found/);
    await expect(e.mutation(api.todos.create, { projectId, title: "x", date: "2026-09-21" })).rejects.toThrow(/not found/);
  });

  test("signed-in users without an active team are rejected", async () => {
    const t = convexTest(schema, modules);
    const noOrg = t.withIdentity({ subject: "user_x" });
    await expect(noOrg.mutation(api.projects.create, { name: "x", color: "#000" })).rejects.toThrow(/team/);
  });

  test("native Clerk integration `o` claim is accepted", async () => {
    const t = convexTest(schema, modules);
    const native = t.withIdentity({ subject: "user_n", o: { id: "org_n", rol: "admin" } } as never);
    const projectId = await native.mutation(api.projects.create, { name: "Native", color: "#000" });
    await native.mutation(api.projects.remove, { projectId });
    expect(await native.query(api.projects.list, {})).toEqual([]);
  });

  test("only admins can delete projects", async () => {
    const { a, b, projectId } = await setup();
    await expect(b.mutation(api.projects.remove, { projectId })).rejects.toThrow(/admins/);
    await a.mutation(api.projects.remove, { projectId });
    expect(await a.query(api.projects.list, {})).toEqual([]);
  });
});

describe("todos and history", () => {
  test("status changes, moves and deletes are logged", async () => {
    const { a, projectId } = await setup();
    const todoId = await a.mutation(api.todos.create, { projectId, title: "Ship", date: "2026-09-21" });
    await a.mutation(api.todos.setStatus, { todoId, status: "doing" });
    await a.mutation(api.todos.setStatus, { todoId, status: "done" });
    await a.mutation(api.todos.update, { todoId, title: "Ship it", date: "2026-09-22" });
    const history = await a.query(api.activity.forTodo, { todoId });
    expect(history.map((h) => h.action).reverse()).toEqual(["created", "status", "status", "moved", "updated"]);

    await a.mutation(api.todos.remove, { todoId });
    const log = await a.query(api.activity.list, { paginationOpts: { numItems: 50, cursor: null } });
    expect(log.page[0]).toMatchObject({ action: "deleted", todoTitle: "Ship it" });
  });

  test("carry over moves open todos to the next day and marks originals didn't finish", async () => {
    const { a, projectId } = await setup();
    const open = await a.mutation(api.todos.create, { projectId, title: "Open", date: "2026-09-21" });
    const doing = await a.mutation(api.todos.create, { projectId, title: "Doing", date: "2026-09-21" });
    const done = await a.mutation(api.todos.create, { projectId, title: "Done", date: "2026-09-21" });
    await a.mutation(api.todos.setStatus, { todoId: doing, status: "doing" });
    await a.mutation(api.todos.setStatus, { todoId: done, status: "done" });

    expect(await a.mutation(api.todos.carryOver, { projectId, date: "2026-09-21" })).toBe(2);

    const week = await a.query(api.todos.listForProject, { projectId, from: "2026-09-21", to: "2026-09-27" });
    const day1 = Object.fromEntries(week.filter((t) => t.date === "2026-09-21").map((t) => [t.title, t.status]));
    const day2 = Object.fromEntries(week.filter((t) => t.date === "2026-09-22").map((t) => [t.title, t.status]));
    expect(day1).toEqual({ Open: "not_done", Doing: "not_done", Done: "done" });
    expect(day2).toEqual({ Open: "todo", Doing: "doing" });
    expect(week.find((t) => t.date === "2026-09-22" && t.title === "Open")?.carriedFrom).toBe(open);
  });

  test("history survives project deletion", async () => {
    const { a, projectId } = await setup();
    await a.mutation(api.todos.create, { projectId, title: "Keep me", date: "2026-09-21" });
    await a.mutation(api.projects.remove, { projectId });
    const rows = await a.query(api.activity.exportRange, { fromMs: 0, toMs: Date.now() + 1000 });
    expect(rows.map((r) => r.action)).toEqual(["project_deleted", "created", "project_created"]);
  });

  test("rejects bad input", async () => {
    const { a, projectId } = await setup();
    await expect(a.mutation(api.todos.create, { projectId, title: "  ", date: "2026-09-21" })).rejects.toThrow(/Title/);
    await expect(a.mutation(api.todos.create, { projectId, title: "x", date: "tomorrow" })).rejects.toThrow(/date/);
  });
});
