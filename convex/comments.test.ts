import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { LIMITS } from "./lib/constants";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const alice = { subject: "user_alice", name: "Alice", org_id: "org_a", org_role: "org:admin" };
const bob = { subject: "user_bob", name: "Bob", org_id: "org_a", org_role: "org:member" };
const carol = { subject: "user_carol", name: "Carol", org_id: "org_a", org_role: "org:member" };
const eve = { subject: "user_eve", name: "Eve", org_id: "org_b", org_role: "org:admin" };

async function setup() {
  const t = convexTest(schema, modules);
  const a = t.withIdentity(alice);
  const projectId = await a.mutation(api.projects.create, { name: "Launch", color: "#6366f1" });
  const todoId = await a.mutation(api.todos.create, { projectId, title: "Ship", date: "2026-09-21" });
  return { t, a, b: t.withIdentity(bob), c: t.withIdentity(carol), e: t.withIdentity(eve), projectId, todoId };
}

describe("comments (#24)", () => {
  test("teammates share a thread; the card count and activity follow", async () => {
    const { a, b, projectId, todoId } = await setup();
    await b.mutation(api.comments.add, { todoId, body: "  On it  " });
    await a.mutation(api.comments.add, { todoId, body: "Thanks!" });

    const thread = await a.query(api.comments.list, { todoId });
    expect(thread.map((c) => [c.authorId, c.body])).toEqual([
      ["user_bob", "On it"],
      ["user_alice", "Thanks!"],
    ]);

    const [todo] = await a.query(api.todos.listForProject, { projectId, from: "2026-09-21", to: "2026-09-21" });
    expect(todo.commentCount).toBe(2);

    const history = await a.query(api.activity.forTodo, { todoId });
    expect(history.filter((h) => h.action === "commented").map((h) => h.actorId)).toEqual(["user_alice", "user_bob"]);
  });

  test("validates length and emptiness", async () => {
    const { b, todoId } = await setup();
    await expect(b.mutation(api.comments.add, { todoId, body: "   " })).rejects.toThrow(/required/);
    await expect(b.mutation(api.comments.add, { todoId, body: "x".repeat(LIMITS.comment + 1) })).rejects.toThrow(
      /at most/,
    );
    await b.mutation(api.comments.add, { todoId, body: "x".repeat(LIMITS.comment) });
  });

  test("author edits their own; author or admin deletes", async () => {
    const { a, b, c, projectId, todoId } = await setup();
    const commentId = await b.mutation(api.comments.add, { todoId, body: "First" });

    // Permissions are reported per comment for the caller.
    expect((await b.query(api.comments.list, { todoId }))[0]).toMatchObject({ canEdit: true, canDelete: true });
    expect((await c.query(api.comments.list, { todoId }))[0]).toMatchObject({ canEdit: false, canDelete: false });
    expect((await a.query(api.comments.list, { todoId }))[0]).toMatchObject({ canEdit: false, canDelete: true });

    await expect(c.mutation(api.comments.edit, { commentId, body: "Hijack" })).rejects.toThrow(/own/);
    await expect(a.mutation(api.comments.edit, { commentId, body: "Admin edit" })).rejects.toThrow(/own/);
    await expect(c.mutation(api.comments.remove, { commentId })).rejects.toThrow(/author or a team admin/);

    await b.mutation(api.comments.edit, { commentId, body: "First (edited)" });
    const [edited] = await b.query(api.comments.list, { todoId });
    expect(edited.body).toBe("First (edited)");
    expect(edited.editedAt).toBeTypeOf("number");

    // An admin may delete someone else's comment; the count drops.
    await a.mutation(api.comments.remove, { commentId });
    expect(await a.query(api.comments.list, { todoId })).toEqual([]);
    const [todo] = await a.query(api.todos.listForProject, { projectId, from: "2026-09-21", to: "2026-09-21" });
    expect(todo.commentCount).toBe(0);

    // And the author may delete their own.
    const own = await c.mutation(api.comments.add, { todoId, body: "Mine" });
    await c.mutation(api.comments.remove, { commentId: own });
    expect(await a.query(api.comments.list, { todoId })).toEqual([]);
  });

  test("other teams can neither read nor write a thread", async () => {
    const { b, e, todoId } = await setup();
    const commentId = await b.mutation(api.comments.add, { todoId, body: "Internal" });
    expect(await e.query(api.comments.list, { todoId })).toEqual([]);
    await expect(e.mutation(api.comments.add, { todoId, body: "Hi" })).rejects.toThrow(/not found/);
    await expect(e.mutation(api.comments.edit, { commentId, body: "x" })).rejects.toThrow(/not found/);
    await expect(e.mutation(api.comments.remove, { commentId })).rejects.toThrow(/not found/);
    expect(await b.query(api.comments.list, { todoId })).toHaveLength(1);
  });

  test("archived projects are read-only", async () => {
    const { a, b, projectId, todoId } = await setup();
    const commentId = await b.mutation(api.comments.add, { todoId, body: "Before" });
    await a.mutation(api.projects.setArchived, { projectId, archived: true });

    await expect(b.mutation(api.comments.add, { todoId, body: "x" })).rejects.toThrow(/archived/);
    await expect(b.mutation(api.comments.edit, { commentId, body: "x" })).rejects.toThrow(/archived/);
    await expect(a.mutation(api.comments.remove, { commentId })).rejects.toThrow(/archived/);
    // Still readable, but nobody may change it.
    expect(await b.query(api.comments.list, { todoId })).toMatchObject([
      { body: "Before", canEdit: false, canDelete: false },
    ]);
  });

  test("deleting a todo deletes its comments", async () => {
    const { t, a, b, todoId } = await setup();
    await b.mutation(api.comments.add, { todoId, body: "One" });
    await b.mutation(api.comments.add, { todoId, body: "Two" });
    await a.mutation(api.todos.remove, { todoId });
    expect(await t.run((ctx) => ctx.db.query("comments").collect())).toEqual([]);
  });

  test("deleting a project deletes its comments", async () => {
    vi.useFakeTimers();
    try {
      const { t, a, b, projectId, todoId } = await setup();
      await b.mutation(api.comments.add, { todoId, body: "One" });
      await a.mutation(api.projects.remove, { projectId });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await t.run((ctx) => ctx.db.query("comments").collect())).toEqual([]);
      expect(await t.run((ctx) => ctx.db.query("todos").collect())).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
