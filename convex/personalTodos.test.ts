import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { ORDER_STEP } from "./lib/ordering";
import schema from "./schema";

// Personal todos: tasks created without a project, private to their creator until moved into one.

const modules = import.meta.glob("./**/*.ts");

const alice = { subject: "user_alice", name: "Alice", org_id: "org_a", org_role: "org:admin" };
const bob = { subject: "user_bob", name: "Bob", org_id: "org_a", org_role: "org:member" };

const MON = "2026-09-21";
const TUE = "2026-09-22";
const WEEK = { from: MON, to: "2026-09-27" };

async function setup() {
  const t = convexTest(schema, modules);
  // Assignees must be synced, active members of the team.
  for (const [i, user] of [alice, bob].entries()) {
    await t.mutation(internal.memberships.applyWebhook, {
      orgId: "org_a",
      userId: user.subject,
      membershipId: `mem_${user.subject}`,
      role: user.org_role,
      active: true,
      createdAt: i + 1,
      updatedAt: i + 1,
    });
  }
  await t.mutation(internal.memberships.completeBackfill, { orgId: "org_a", startedAt: 0 });
  return { t, a: t.withIdentity(alice), b: t.withIdentity(bob) };
}

describe("creating without a project", () => {
  test("a team with no projects can create a task straight away", async () => {
    const { a } = await setup();
    const todoId = await a.mutation(api.todos.create, { title: "Call the bank", date: MON });
    const todos = await a.query(api.todos.listPersonal, WEEK);
    expect(todos.map((t) => [t._id, t.title, t.projectId])).toEqual([[todoId, "Call the bank", undefined]]);
  });

  test("personal todos appear in the team list, labelled as having no project", async () => {
    const { a } = await setup();
    await a.mutation(api.todos.create, { title: "Mine", date: MON });
    const [todo] = await a.query(api.todos.listForTeam, WEEK);
    expect(todo).toMatchObject({ title: "Mine", projectName: "Sin proyecto", projectArchived: false });
  });

  test("they cannot be assigned to anyone", async () => {
    const { a } = await setup();
    await expect(a.mutation(api.todos.create, { title: "x", date: MON, assigneeId: bob.subject })).rejects.toThrow(
      /project/,
    );
  });

  test("they are private to their creator", async () => {
    const { a, b } = await setup();
    const todoId = await a.mutation(api.todos.create, { title: "Secret", date: MON });
    expect(await b.query(api.todos.listPersonal, WEEK)).toEqual([]);
    expect(await b.query(api.todos.listForTeam, WEEK)).toEqual([]);
    expect(await b.query(api.todos.get, { todoId })).toBeNull();
    expect(await b.query(api.search.todos, { query: "Secret" })).toEqual([]);
    await expect(b.mutation(api.todos.setStatus, { todoId, status: "done" })).rejects.toThrow(/not found/);
    await expect(b.mutation(api.todos.remove, { todoId })).rejects.toThrow(/not found/);
    await expect(b.mutation(api.todos.move, { todoId, date: TUE, order: 1 })).rejects.toThrow(/not found/);
    await expect(b.mutation(api.todos.update, { todoId, title: "Mine now", date: MON })).rejects.toThrow(/not found/);
  });

  test("the creator can find, edit, complete and delete them without touching the activity feed", async () => {
    const { a } = await setup();
    const todoId = await a.mutation(api.todos.create, { title: "Renew passport", date: MON });
    const [hit] = await a.query(api.search.todos, { query: "passport" });
    expect(hit).toMatchObject({ title: "Renew passport", projectName: "Sin proyecto" });
    expect(hit.projectId).toBeUndefined();
    await a.mutation(api.todos.update, { todoId, title: "Renew passport online", date: TUE });
    await a.mutation(api.todos.setStatus, { todoId, status: "done" });
    expect(await a.query(api.todos.listPersonal, WEEK)).toMatchObject([
      { title: "Renew passport online", date: TUE, status: "done" },
    ]);
    await a.mutation(api.todos.remove, { todoId });
    expect(await a.query(api.todos.listPersonal, WEEK)).toEqual([]);
    const feed = await a.query(api.activity.list, { paginationOpts: { numItems: 50, cursor: null } });
    expect(feed.page).toEqual([]);
  });

  test("they have no comment thread", async () => {
    const { a } = await setup();
    const todoId = await a.mutation(api.todos.create, { title: "Solo", date: MON });
    expect(await a.query(api.comments.list, { todoId })).toEqual([]);
    await expect(a.mutation(api.comments.add, { todoId, body: "hi" })).rejects.toThrow(/project/);
  });
});

describe("calendar drag & drop", () => {
  test("personal todos can be dropped on another day and reordered", async () => {
    const { a } = await setup();
    const one = await a.mutation(api.todos.create, { title: "one", date: MON });
    const two = await a.mutation(api.todos.create, { title: "two", date: MON });
    await a.mutation(api.todos.move, { todoId: two, date: MON, order: 1 });
    await a.mutation(api.todos.move, { todoId: one, date: TUE, order: 5 });
    const todos = await a.query(api.todos.listPersonal, WEEK);
    expect(todos.map((t) => [t.title, t.date])).toEqual([
      ["two", MON],
      ["one", TUE],
    ]);
  });

  test("a crowded personal day is renumbered without touching projects", async () => {
    const { a } = await setup();
    const projectId = await a.mutation(api.projects.create, { name: "Launch", color: "#6366f1" });
    await a.mutation(api.todos.create, { projectId, title: "project", date: MON });
    const before = await a.query(api.todos.listForProject, { projectId, ...WEEK });
    const one = await a.mutation(api.todos.create, { title: "one", date: MON });
    const two = await a.mutation(api.todos.create, { title: "two", date: MON });
    await a.mutation(api.todos.move, { todoId: one, date: MON, order: 10 });
    // Too close to `one` to tell apart: the whole personal day is renumbered, keeping the sequence.
    await a.mutation(api.todos.move, { todoId: two, date: MON, order: 10 + 1e-6 });
    const personal = await a.query(api.todos.listPersonal, WEEK);
    expect(personal.map((t) => [t.title, t.order])).toEqual([
      ["one", ORDER_STEP],
      ["two", 2 * ORDER_STEP],
    ]);
    expect(await a.query(api.todos.listForProject, { projectId, ...WEEK })).toEqual(before);
  });
});

describe("moving into a project", () => {
  test("a personal todo joins the project, keeps its data and shows up in the activity feed", async () => {
    const { a, b } = await setup();
    const projectId = await a.mutation(api.projects.create, { name: "Launch", color: "#6366f1" });
    const todoId = await a.mutation(api.todos.create, { title: "Draft plan", date: MON, notes: "v1" });
    await a.mutation(api.todos.update, { todoId, title: "Draft plan", notes: "v1", date: MON, projectId });

    expect(await a.query(api.todos.listPersonal, WEEK)).toEqual([]);
    const inProject = await b.query(api.todos.listForProject, { projectId, ...WEEK });
    expect(inProject).toMatchObject([{ _id: todoId, title: "Draft plan", notes: "v1", createdBy: alice.subject }]);

    const feed = await a.query(api.activity.list, { paginationOpts: { numItems: 50, cursor: null } });
    const entry = feed.page.find((e) => e.action === "project_changed");
    expect(entry).toMatchObject({ todoTitle: "Draft plan", projectName: "Launch", to: "Launch" });
    expect(entry?.from).toBeUndefined();
  });

  test("once in a project it can be assigned and commented on by teammates", async () => {
    const { a, b } = await setup();
    const projectId = await a.mutation(api.projects.create, { name: "Launch", color: "#6366f1" });
    const todoId = await a.mutation(api.todos.create, { title: "Draft plan", date: MON });
    await a.mutation(api.todos.update, {
      todoId,
      title: "Draft plan",
      date: MON,
      projectId,
      assigneeId: bob.subject,
    });
    await b.mutation(api.comments.add, { todoId, body: "On it" });
    expect((await b.query(api.comments.list, { todoId })).map((c) => c.body)).toEqual(["On it"]);
  });

  test("a todo can move from one project to another, taking its comments along", async () => {
    const { a } = await setup();
    const one = await a.mutation(api.projects.create, { name: "One", color: "#6366f1" });
    const two = await a.mutation(api.projects.create, { name: "Two", color: "#0ea5e9" });
    const todoId = await a.mutation(api.todos.create, { projectId: one, title: "Shared", date: MON });
    await a.mutation(api.comments.add, { todoId, body: "note" });
    await a.mutation(api.todos.update, { todoId, title: "Shared", date: MON, projectId: two });

    expect(await a.query(api.todos.listForProject, { projectId: one, ...WEEK })).toEqual([]);
    expect(await a.query(api.todos.listForProject, { projectId: two, ...WEEK })).toMatchObject([{ title: "Shared" }]);
    expect((await a.query(api.comments.list, { todoId })).map((c) => c.body)).toEqual(["note"]);
    const feed = await a.query(api.activity.list, { paginationOpts: { numItems: 50, cursor: null }, projectId: two });
    expect(feed.page.find((e) => e.action === "project_changed")).toMatchObject({ from: "One", to: "Two" });
  });

  test("moving needs write access to the target project", async () => {
    const { a, b } = await setup();
    const archived = await a.mutation(api.projects.create, { name: "Old", color: "#6366f1" });
    await a.mutation(api.projects.setArchived, { projectId: archived, archived: true });
    const todoId = await b.mutation(api.todos.create, { title: "Mine", date: MON });
    await expect(
      b.mutation(api.todos.update, { todoId, title: "Mine", date: MON, projectId: archived }),
    ).rejects.toThrow(/archived/);
    expect(await b.query(api.todos.listPersonal, WEEK)).toHaveLength(1);
  });

  test("recurring occurrences stay in their project", async () => {
    const { a } = await setup();
    const one = await a.mutation(api.projects.create, { name: "One", color: "#6366f1" });
    const two = await a.mutation(api.projects.create, { name: "Two", color: "#0ea5e9" });
    await a.mutation(api.recurrences.create, {
      projectId: one,
      title: "Standup",
      startDate: MON,
      rule: { kind: "daily" },
    });
    await a.mutation(api.recurrences.ensureOccurrences, { from: MON, to: MON, projectId: one });
    const [occurrence] = await a.query(api.todos.listForProject, { projectId: one, from: MON, to: MON });
    await expect(
      a.mutation(api.todos.update, { todoId: occurrence._id, title: "Standup", date: MON, projectId: two }),
    ).rejects.toThrow(/Recurring/);
  });
});
