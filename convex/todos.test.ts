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
    await expect(noOrg.mutation(api.projects.create, { name: "x", color: "#6366f1" })).rejects.toThrow(/team/);
  });

  test("native Clerk integration `o` claim is accepted", async () => {
    const t = convexTest(schema, modules);
    const native = t.withIdentity({ subject: "user_n", o: { id: "org_n", rol: "admin" } } as never);
    const projectId = await native.mutation(api.projects.create, { name: "Native", color: "#6366f1" });
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
    expect(week.find((t) => t.date === "2026-09-22" && t.title === "Doing")?.carriedFrom).toBe(doing);

    // #33: each original records its own "didn't finish" status change.
    const openHistory = await a.query(api.activity.forTodo, { todoId: open });
    expect(openHistory[0]).toMatchObject({ action: "status", from: "todo", to: "not_done", date: "2026-09-21" });
    const doingHistory = await a.query(api.activity.forTodo, { todoId: doing });
    expect(doingHistory[0]).toMatchObject({ action: "status", from: "doing", to: "not_done", date: "2026-09-21" });
    // The finished todo is untouched.
    const doneHistory = await a.query(api.activity.forTodo, { todoId: done });
    expect(doneHistory.filter((h) => h.to === "not_done")).toEqual([]);
    // The copy still gets its carried_over entry.
    const copy = week.find((t) => t.date === "2026-09-22" && t.title === "Open")!;
    const copyHistory = await a.query(api.activity.forTodo, { todoId: copy._id });
    expect(copyHistory.map((h) => h.action)).toEqual(["carried_over"]);
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

describe("archived projects are read-only (#18)", () => {
  test("todo mutations are rejected while archived and allowed again after restore", async () => {
    const { a, b, projectId } = await setup();
    const todoId = await a.mutation(api.todos.create, { projectId, title: "Frozen", date: "2026-09-21" });
    await a.mutation(api.projects.setArchived, { projectId, archived: true });

    const archived = /archived/;
    await expect(b.mutation(api.todos.create, { projectId, title: "x", date: "2026-09-21" })).rejects.toThrow(archived);
    await expect(b.mutation(api.todos.update, { todoId, title: "x", date: "2026-09-21" })).rejects.toThrow(archived);
    await expect(b.mutation(api.todos.setStatus, { todoId, status: "done" })).rejects.toThrow(archived);
    await expect(b.mutation(api.todos.setStatus, { todoId, status: "todo" })).rejects.toThrow(archived);
    await expect(b.mutation(api.todos.remove, { todoId })).rejects.toThrow(archived);
    await expect(b.mutation(api.todos.carryOver, { projectId, date: "2026-09-21" })).rejects.toThrow(archived);

    // Nothing changed and nothing was logged.
    const [todo] = await a.query(api.todos.listForProject, { projectId, from: "2026-09-21", to: "2026-09-22" });
    expect(todo).toMatchObject({ title: "Frozen", status: "todo" });
    expect((await a.query(api.activity.forTodo, { todoId })).map((h) => h.action)).toEqual(["created"]);

    // Reads still work, and restoring makes the project writable again.
    await a.mutation(api.projects.setArchived, { projectId, archived: false });
    await b.mutation(api.todos.setStatus, { todoId, status: "done" });
    await b.mutation(api.todos.create, { projectId, title: "Back", date: "2026-09-21" });
  });

  test("todos of a project being deleted are frozen and hidden", async () => {
    const { a, b, projectId } = await setup();
    const todoId = await a.mutation(api.todos.create, { projectId, title: "Doomed", date: "2026-09-21" });
    // The batch delete is scheduled but has not run yet.
    await a.mutation(api.projects.remove, { projectId });

    await expect(b.mutation(api.todos.create, { projectId, title: "x", date: "2026-09-21" })).rejects.toThrow();
    await expect(b.mutation(api.todos.setStatus, { todoId, status: "done" })).rejects.toThrow();
    expect(await b.query(api.todos.listForTeam, { from: "2026-09-21", to: "2026-09-21" })).toEqual([]);
  });
});

describe("bounded team queries (#15)", () => {
  test("listForTeam accepts up to 366 days and rejects larger or inverted ranges", async () => {
    const { a, projectId } = await setup();
    await a.mutation(api.todos.create, { projectId, title: "In range", date: "2026-09-21" });
    // 366 days inclusive (2028 is a leap year).
    const rows = await a.query(api.todos.listForTeam, { from: "2028-01-01", to: "2028-12-31" });
    expect(rows).toEqual([]);
    const ok = await a.query(api.todos.listForTeam, { from: "2026-01-01", to: "2027-01-01" });
    expect(ok.map((t) => t.title)).toEqual(["In range"]);

    await expect(a.query(api.todos.listForTeam, { from: "2026-01-01", to: "2027-01-02" })).rejects.toThrow(
      /at most 366 days/,
    );
    await expect(a.query(api.todos.listForTeam, { from: "2026-09-22", to: "2026-09-21" })).rejects.toThrow(
      /start date is after the end date/,
    );
    await expect(a.query(api.todos.listForTeam, { from: "2026-02-31", to: "2026-03-01" })).rejects.toThrow(/date/);
  });
});

describe("server-side input validation (#29)", () => {
  test("todo title is trimmed, required and capped at 300 chars", async () => {
    const { a, projectId } = await setup();
    const todoId = await a.mutation(api.todos.create, { projectId, title: "  Trim me  ", date: "2026-09-21" });
    const [todo] = await a.query(api.todos.listForProject, { projectId, from: "2026-09-21", to: "2026-09-21" });
    expect(todo.title).toBe("Trim me");
    await a.mutation(api.todos.create, { projectId, title: "x".repeat(300), date: "2026-09-21" });
    await expect(
      a.mutation(api.todos.create, { projectId, title: "x".repeat(301), date: "2026-09-21" }),
    ).rejects.toThrow(/Title.*300/);
    await expect(
      a.mutation(api.todos.update, { todoId, title: "x".repeat(301), date: "2026-09-21" }),
    ).rejects.toThrow(/Title.*300/);
    await expect(a.mutation(api.todos.update, { todoId, title: "   ", date: "2026-09-21" })).rejects.toThrow(/Title/);
  });

  test("todo notes are capped at 5000 chars", async () => {
    const { a, projectId } = await setup();
    const todoId = await a.mutation(api.todos.create, {
      projectId, title: "ok", notes: "n".repeat(5000), date: "2026-09-21",
    });
    await expect(
      a.mutation(api.todos.create, { projectId, title: "x", notes: "n".repeat(5001), date: "2026-09-21" }),
    ).rejects.toThrow(/Notes.*5,000/);
    await expect(
      a.mutation(api.todos.update, { todoId, title: "ok", notes: "n".repeat(5001), date: "2026-09-21" }),
    ).rejects.toThrow(/Notes.*5,000/);
  });

  test("dates must be real calendar days", async () => {
    const { a, projectId } = await setup();
    await a.mutation(api.todos.create, { projectId, title: "leap", date: "2028-02-29" });
    for (const date of ["2026-02-31", "2026-13-01", "2026-00-10", "2026-04-31", "2027-02-29"]) {
      await expect(a.mutation(api.todos.create, { projectId, title: "x", date })).rejects.toThrow(/date/);
    }
    const todoId = await a.mutation(api.todos.create, { projectId, title: "x", date: "2026-09-21" });
    await expect(a.mutation(api.todos.update, { todoId, title: "x", date: "2026-02-31" })).rejects.toThrow(/date/);
    await expect(a.mutation(api.todos.carryOver, { projectId, date: "2026-02-31" })).rejects.toThrow(/date/);
  });

  test("assigneeId must be a known user", async () => {
    const { a, b, projectId } = await setup();
    await b.mutation(api.users.store, {});
    const todoId = await a.mutation(api.todos.create, {
      projectId, title: "assigned", date: "2026-09-21", assigneeId: bob.subject,
    });
    await expect(
      a.mutation(api.todos.create, { projectId, title: "x", date: "2026-09-21", assigneeId: "user_ghost" }),
    ).rejects.toThrow(/Assignee/);
    await expect(
      a.mutation(api.todos.update, { todoId, title: "x", date: "2026-09-21", assigneeId: "user_ghost" }),
    ).rejects.toThrow(/Assignee/);
    // Clearing the assignee is still allowed.
    await a.mutation(api.todos.update, { todoId, title: "x", date: "2026-09-21", assigneeId: "" });
  });

  test("project name ≤ 80, description ≤ 500, color from the palette", async () => {
    const { a, projectId } = await setup();
    await a.mutation(api.projects.create, { name: "n".repeat(80), description: "d".repeat(500), color: "#0ea5e9" });
    await expect(a.mutation(api.projects.create, { name: "n".repeat(81), color: "#0ea5e9" })).rejects.toThrow(/name.*80/);
    await expect(
      a.mutation(api.projects.create, { name: "ok", description: "d".repeat(501), color: "#0ea5e9" }),
    ).rejects.toThrow(/Description.*500/);
    await expect(a.mutation(api.projects.create, { name: "ok", color: "red" })).rejects.toThrow(/color/);
    await expect(
      a.mutation(api.projects.create, { name: "ok", color: "#000;background:url(x)" }),
    ).rejects.toThrow(/color/);
    await expect(
      a.mutation(api.projects.update, { projectId, name: "n".repeat(81), color: "#6366f1" }),
    ).rejects.toThrow(/name.*80/);
    await expect(
      a.mutation(api.projects.update, { projectId, name: "ok", description: "d".repeat(501), color: "#6366f1" }),
    ).rejects.toThrow(/Description.*500/);
    await expect(a.mutation(api.projects.update, { projectId, name: "ok", color: "#123456" })).rejects.toThrow(/color/);
    // Palette colors are accepted case-insensitively.
    await a.mutation(api.projects.update, { projectId, name: "ok", color: "#6366F1" });
  });
});
