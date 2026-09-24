import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { MIN_ORDER_GAP, needsRebalance, ORDER_STEP, orderAt, orderBetween } from "./lib/ordering";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const alice = { subject: "user_alice", name: "Alice", org_id: "org_a", org_role: "org:admin" };
const bob = { subject: "user_bob", name: "Bob", org_id: "org_a", org_role: "org:member" };
const eve = { subject: "user_eve", name: "Eve", org_id: "org_b", org_role: "org:admin" };

const MON = "2026-09-21";
const TUE = "2026-09-22";

async function setup() {
  const t = convexTest(schema, modules);
  const a = t.withIdentity(alice);
  const projectId = await a.mutation(api.projects.create, { name: "Launch", color: "#6366f1" });
  const add = (title: string, date = MON) => a.mutation(api.todos.create, { projectId, title, date });
  const day = async (date = MON) =>
    (await a.query(api.todos.listForProject, { projectId, from: date, to: date })).map((x) => x.title);
  const orders = async (date = MON) =>
    (await a.query(api.todos.listForProject, { projectId, from: date, to: date })).map((x) => x.order);
  return { t, a, b: t.withIdentity(bob), e: t.withIdentity(eve), projectId, add, day, orders };
}

describe("ordering helpers", () => {
  test("orderBetween places items between, before, after and into empty lists", () => {
    expect(orderBetween(undefined, undefined)).toBe(ORDER_STEP);
    expect(orderBetween(10, 20)).toBe(15);
    expect(orderBetween(undefined, 10)).toBe(10 - ORDER_STEP);
    expect(orderBetween(10, undefined)).toBe(10 + ORDER_STEP);
    expect(orderAt([{ order: 1 }, { order: 3 }], 1)).toBe(2);
  });

  test("needsRebalance flags neighbours closer than the minimum gap", () => {
    expect(needsRebalance([{ order: 1 }, { order: 2 }])).toBe(false);
    expect(needsRebalance([{ order: 1 }, { order: 1 + MIN_ORDER_GAP / 2 }])).toBe(true);
    expect(needsRebalance([{ order: 5 }, { order: 5 }])).toBe(true);
  });
});

describe("todos.move", () => {
  test("reorders within a day without logging", async () => {
    const { a, add, day, orders } = await setup();
    await add("one");
    await add("two");
    const three = await add("three");
    const [first] = await orders();
    await a.mutation(api.todos.move, { todoId: three, date: MON, order: first - ORDER_STEP });
    expect(await day()).toEqual(["three", "one", "two"]);

    const history = await a.query(api.activity.forTodo, { todoId: three });
    expect(history.map((h) => h.action)).toEqual(["created"]);
  });

  test("moving to another day changes the date and logs `moved`", async () => {
    const { a, add, day } = await setup();
    const todoId = await add("Ship");
    await add("Later", TUE);
    await a.mutation(api.todos.move, { todoId, date: TUE, order: 1 });
    expect(await day(MON)).toEqual([]);
    expect(await day(TUE)).toEqual(["Ship", "Later"]);

    const [latest] = await a.query(api.activity.forTodo, { todoId });
    expect(latest).toMatchObject({ action: "moved", from: MON, to: TUE, date: TUE, todoTitle: "Ship" });
  });

  test("a no-op move writes nothing", async () => {
    const { a, add, orders } = await setup();
    const todoId = await add("Same");
    const [order] = await orders();
    await a.mutation(api.todos.move, { todoId, date: MON, order });
    const history = await a.query(api.activity.forTodo, { todoId });
    expect(history).toHaveLength(1);
  });

  async function seeded() {
    const s = await setup();
    const ids: Id<"todos">[] = [];
    for (const title of ["a", "b", "c"]) ids.push(await s.add(title));
    await s.t.run(async (ctx) => {
      for (const [i, id] of ids.entries()) await ctx.db.patch(id, { order: i + 1 });
    });
    return { ...s, ids };
  }

  test("keeps other todos' orders when the gap is still wide", async () => {
    const { a, ids, day, orders } = await seeded();
    await a.mutation(api.todos.move, { todoId: ids[2], date: MON, order: orderBetween(1, 2) });
    expect(await day()).toEqual(["a", "c", "b"]);
    expect(await orders()).toEqual([1, 1.5, 2]);
  });

  test("rebalances a day when neighbours get too close, keeping the sequence", async () => {
    const { a, ids, day, orders } = await seeded();
    await a.mutation(api.todos.move, { todoId: ids[2], date: MON, order: 1 + MIN_ORDER_GAP / 2 });
    expect(await day()).toEqual(["a", "c", "b"]);
    expect(await orders()).toEqual([ORDER_STEP, 2 * ORDER_STEP, 3 * ORDER_STEP]);
  });

  test("repeated drops into the same slot eventually rebalance and never tie", async () => {
    const { a, projectId, ids, day, orders } = await seeded();
    // Alternately drop "c" and "b" right after "a": each drop halves the gap next to "a".
    let rebalanced = false;
    for (let i = 0; i < 40 && !rebalanced; i++) {
      const moving = i % 2 === 0 ? ids[2] : ids[1];
      const list = await a.query(api.todos.listForProject, { projectId, from: MON, to: MON });
      const rest = list.filter((x) => x._id !== moving);
      await a.mutation(api.todos.move, { todoId: moving, date: MON, order: orderAt(rest, 1) });
      const current = await orders();
      expect(new Set(current).size).toBe(3);
      rebalanced = current[0] === ORDER_STEP;
    }
    expect(rebalanced).toBe(true);
    expect((await day())[0]).toBe("a");
  });

  test("teammates can move; other teams cannot", async () => {
    const { b, e, add, day } = await setup();
    const todoId = await add("Shared");
    await b.mutation(api.todos.move, { todoId, date: TUE, order: 1 });
    expect(await day(TUE)).toEqual(["Shared"]);
    await expect(e.mutation(api.todos.move, { todoId, date: MON, order: 1 })).rejects.toThrow(/not found/);
    expect(await day(TUE)).toEqual(["Shared"]);
  });

  test("requires a team", async () => {
    const { t, add } = await setup();
    const todoId = await add("x");
    await expect(t.mutation(api.todos.move, { todoId, date: TUE, order: 1 })).rejects.toThrow(/team/);
    await expect(
      t.withIdentity({ subject: "user_x" }).mutation(api.todos.move, { todoId, date: TUE, order: 1 }),
    ).rejects.toThrow(/team/);
  });

  test("archived projects are read-only", async () => {
    const { a, projectId, add, day } = await setup();
    const todoId = await add("Frozen");
    await a.mutation(api.projects.setArchived, { projectId, archived: true });
    await expect(a.mutation(api.todos.move, { todoId, date: TUE, order: 1 })).rejects.toThrow(/archived/);
    expect(await day(MON)).toEqual(["Frozen"]);
  });

  test("moving a recurring occurrence to another day detaches it and it is not regenerated", async () => {
    const { a, projectId, day } = await setup();
    await a.mutation(api.recurrences.create, {
      projectId,
      title: "Report",
      startDate: MON,
      rule: { kind: "weekly", weekdays: [1] },
    });
    const [occurrence] = await a.query(api.todos.listForProject, { projectId, from: MON, to: MON });
    await a.mutation(api.todos.move, { todoId: occurrence._id, date: TUE, order: 1 });
    expect(await a.mutation(api.recurrences.ensureOccurrences, { from: MON, to: TUE, projectId })).toBe(0);
    expect(await day(MON)).toEqual([]);
    const [moved] = await a.query(api.todos.listForProject, { projectId, from: TUE, to: TUE });
    expect(moved).toMatchObject({ title: "Report", recurrenceDate: MON, recurrenceDetached: true });
  });

  test("reordering a recurring occurrence within its day keeps it attached", async () => {
    const { a, projectId } = await setup();
    await a.mutation(api.recurrences.create, {
      projectId,
      title: "Report",
      startDate: MON,
      rule: { kind: "weekly", weekdays: [1] },
    });
    const [occurrence] = await a.query(api.todos.listForProject, { projectId, from: MON, to: MON });
    await a.mutation(api.todos.move, { todoId: occurrence._id, date: MON, order: 1 });
    const [after] = await a.query(api.todos.listForProject, { projectId, from: MON, to: MON });
    expect(after.recurrenceDetached).toBeUndefined();
  });

  test("rejects invalid dates and positions", async () => {
    const { a, add } = await setup();
    const todoId = await add("x");
    await expect(a.mutation(api.todos.move, { todoId, date: "2026-02-30", order: 1 })).rejects.toThrow(/Invalid date/);
    await expect(a.mutation(api.todos.move, { todoId, date: "tomorrow", order: 1 })).rejects.toThrow(/Invalid date/);
    await expect(a.mutation(api.todos.move, { todoId, date: TUE, order: Number.NaN })).rejects.toThrow(/position/);
    await expect(a.mutation(api.todos.move, { todoId, date: TUE, order: Infinity })).rejects.toThrow(/position/);
  });
});
