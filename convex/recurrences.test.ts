import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { describeRule, matchesRule } from "./lib/recurrence";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const alice = { subject: "user_alice", name: "Alice", org_id: "org_a", org_role: "org:admin" };
const bob = { subject: "user_bob", name: "Bob", org_id: "org_a", org_role: "org:member" };
const eve = { subject: "user_eve", name: "Eve", org_id: "org_b", org_role: "org:admin" };

// 2026-09-21 is a Monday; the week runs to Sunday 2026-09-27.
const MON = "2026-09-21";
const SUN = "2026-09-27";
const NEXT_MON = "2026-09-28";
const NEXT_SUN = "2026-10-04";

async function setup() {
  const t = convexTest(schema, modules);
  const a = t.withIdentity(alice);
  const projectId = await a.mutation(api.projects.create, { name: "Launch", color: "#6366f1" });
  return { t, a, b: t.withIdentity(bob), e: t.withIdentity(eve), projectId };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

const week = async ({ a, projectId }: Ctx, from = MON, to = SUN) =>
  (await a.query(api.todos.listForProject, { projectId, from, to })).sort((x, y) => x.date.localeCompare(y.date));

const datesOf = async (ctx: Ctx, from = MON, to = SUN) => (await week(ctx, from, to)).map((t) => t.date);

describe("recurrence rules", () => {
  test("daily, weekdays and weekly on chosen days", () => {
    const days = ["2026-09-20", MON, "2026-09-23", "2026-09-26"]; // Sun, Mon, Wed, Sat
    expect(days.filter((d) => matchesRule({ kind: "daily" }, d))).toEqual(days);
    expect(days.filter((d) => matchesRule({ kind: "weekdays" }, d))).toEqual([MON, "2026-09-23"]);
    expect(days.filter((d) => matchesRule({ kind: "weekly", weekdays: [0, 3] }, d))).toEqual(["2026-09-20", "2026-09-23"]);
    expect(describeRule({ kind: "weekly", weekdays: [0, 1, 4] })).toBe("Weekly on Mon, Thu, Sun");
  });
});

describe("recurring todos (#23)", () => {
  test("creating a series generates its first week", async () => {
    const ctx = await setup();
    await ctx.a.mutation(api.recurrences.create, {
      projectId: ctx.projectId, title: "Standup", startDate: MON, rule: { kind: "weekdays" },
    });
    expect(await datesOf(ctx)).toEqual([MON, "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"]);
    const [first] = await week(ctx);
    expect(first).toMatchObject({ title: "Standup", status: "todo", recurrenceDate: MON, createdBy: "user_alice" });
  });

  test("generation is idempotent and fills later weeks on demand", async () => {
    const ctx = await setup();
    await ctx.a.mutation(api.recurrences.create, {
      projectId: ctx.projectId, title: "Report", startDate: MON, rule: { kind: "weekly", weekdays: [5] },
    });
    expect(await datesOf(ctx, MON, NEXT_SUN)).toEqual(["2026-09-25"]);

    expect(await ctx.a.mutation(api.recurrences.ensureOccurrences, { from: NEXT_MON, to: NEXT_SUN })).toBe(1);
    expect(await ctx.b.mutation(api.recurrences.ensureOccurrences, { from: NEXT_MON, to: NEXT_SUN, projectId: ctx.projectId })).toBe(0);
    expect(await ctx.a.mutation(api.recurrences.ensureOccurrences, { from: MON, to: NEXT_SUN })).toBe(0);
    expect(await datesOf(ctx, MON, NEXT_SUN)).toEqual(["2026-09-25", "2026-10-02"]);
  });

  test("nothing is generated before the start date", async () => {
    const ctx = await setup();
    await ctx.a.mutation(api.recurrences.create, {
      projectId: ctx.projectId, title: "Daily", startDate: "2026-09-24", rule: { kind: "daily" },
    });
    await ctx.a.mutation(api.recurrences.ensureOccurrences, { from: MON, to: SUN });
    expect(await datesOf(ctx)).toEqual(["2026-09-24", "2026-09-25", "2026-09-26", SUN]);
  });

  test("a moved or deleted occurrence is not generated again", async () => {
    const ctx = await setup();
    await ctx.a.mutation(api.recurrences.create, {
      projectId: ctx.projectId, title: "Daily", startDate: MON, rule: { kind: "daily" },
    });
    const todos = await week(ctx);
    await ctx.a.mutation(api.todos.update, { todoId: todos[0]._id, title: "Daily", date: "2026-10-05" });
    await ctx.a.mutation(api.todos.remove, { todoId: todos[1]._id });
    await ctx.a.mutation(api.recurrences.ensureOccurrences, { from: MON, to: SUN });
    expect(await datesOf(ctx)).toEqual(["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", SUN]);
  });

  test("editing one occurrence leaves the series alone", async () => {
    const ctx = await setup();
    await ctx.a.mutation(api.recurrences.create, {
      projectId: ctx.projectId, title: "Standup", startDate: MON, rule: { kind: "weekdays" },
    });
    const [mon] = await week(ctx);
    await ctx.a.mutation(api.todos.update, { todoId: mon._id, title: "Standup (demo day)", date: MON });
    const titles = (await week(ctx)).map((t) => t.title);
    expect(titles).toEqual(["Standup (demo day)", "Standup", "Standup", "Standup", "Standup"]);
  });

  test("series edit changes future un-started occurrences only", async () => {
    const ctx = await setup();
    const recurrenceId = await ctx.a.mutation(api.recurrences.create, {
      projectId: ctx.projectId, title: "Standup", startDate: MON, rule: { kind: "weekdays" },
    });
    const [mon, tue, wed, thu] = await week(ctx);
    await ctx.a.mutation(api.todos.setStatus, { todoId: thu._id, status: "doing" });
    await ctx.a.mutation(api.todos.update, { todoId: wed._id, title: "Custom", date: wed.date });

    await ctx.a.mutation(api.recurrences.update, {
      recurrenceId, from: tue.date, title: "Sync", assigneeId: "", rule: { kind: "weekdays" },
    });
    const byDate = Object.fromEntries((await week(ctx)).map((t) => [t.date, t.title]));
    expect(byDate).toEqual({
      [mon.date]: "Standup", // before `from`
      [tue.date]: "Sync",
      [wed.date]: "Custom", // edited on its own
      [thu.date]: "Standup", // already started
      "2026-09-25": "Sync",
    });
    // New occurrences use the new title.
    await ctx.a.mutation(api.recurrences.ensureOccurrences, { from: NEXT_MON, to: NEXT_SUN });
    expect((await week(ctx, NEXT_MON, NEXT_SUN)).map((t) => t.title)).toEqual(Array(5).fill("Sync"));
  });

  test("changing the rule removes un-started days it no longer covers and never back-fills", async () => {
    const ctx = await setup();
    const recurrenceId = await ctx.a.mutation(api.recurrences.create, {
      projectId: ctx.projectId, title: "Weekly", startDate: MON, rule: { kind: "weekly", weekdays: [1, 3] },
    });
    expect(await datesOf(ctx)).toEqual([MON, "2026-09-23"]);

    // From Tuesday on: Tuesdays and Fridays instead.
    await ctx.a.mutation(api.recurrences.update, {
      recurrenceId, from: "2026-09-22", title: "Weekly", rule: { kind: "weekly", weekdays: [2, 5] },
    });
    await ctx.a.mutation(api.recurrences.ensureOccurrences, { from: MON, to: SUN });
    expect(await datesOf(ctx)).toEqual([MON, "2026-09-22", "2026-09-25"]);
  });

  test("stopping a series removes un-started future occurrences and stops generation", async () => {
    const ctx = await setup();
    const recurrenceId = await ctx.a.mutation(api.recurrences.create, {
      projectId: ctx.projectId, title: "Daily", startDate: MON, rule: { kind: "daily" },
    });
    const todos = await week(ctx);
    await ctx.a.mutation(api.todos.setStatus, { todoId: todos[5]._id, status: "done" });

    await ctx.b.mutation(api.recurrences.stop, { recurrenceId, from: "2026-09-24" });
    expect(await datesOf(ctx)).toEqual([MON, "2026-09-22", "2026-09-23", "2026-09-26"]);
    expect(await ctx.a.mutation(api.recurrences.ensureOccurrences, { from: MON, to: NEXT_SUN })).toBe(0);
    expect(await ctx.a.query(api.recurrences.list, { projectId: ctx.projectId })).toEqual([]);
    await expect(
      ctx.a.mutation(api.recurrences.update, { recurrenceId, from: MON, title: "x", rule: { kind: "daily" } }),
    ).rejects.toThrow(/stopped/);
  });

  test("validates rules, scopes by team, and respects archived projects", async () => {
    const ctx = await setup();
    const { a, e, projectId } = ctx;
    await expect(
      a.mutation(api.recurrences.create, { projectId, title: "x", startDate: MON, rule: { kind: "weekly", weekdays: [] } }),
    ).rejects.toThrow(/at least one day/);
    await expect(
      a.mutation(api.recurrences.create, { projectId, title: "x", startDate: MON, rule: { kind: "weekly", weekdays: [7] } }),
    ).rejects.toThrow(/Invalid day/);
    await expect(
      e.mutation(api.recurrences.create, { projectId, title: "x", startDate: MON, rule: { kind: "daily" } }),
    ).rejects.toThrow(/not found/);

    const recurrenceId = await a.mutation(api.recurrences.create, {
      projectId, title: "Daily", startDate: MON, rule: { kind: "daily" },
    });
    // Another team neither sees nor generates it.
    expect(await e.query(api.recurrences.list, {})).toEqual([]);
    expect(await e.query(api.recurrences.get, { recurrenceId })).toBeNull();
    expect(await e.mutation(api.recurrences.ensureOccurrences, { from: NEXT_MON, to: NEXT_SUN, projectId })).toBe(0);
    await expect(e.mutation(api.recurrences.stop, { recurrenceId, from: MON })).rejects.toThrow(/not found/);

    await a.mutation(api.projects.setArchived, { projectId, archived: true });
    expect(await a.mutation(api.recurrences.ensureOccurrences, { from: NEXT_MON, to: NEXT_SUN })).toBe(0);
    await expect(a.mutation(api.recurrences.stop, { recurrenceId, from: MON })).rejects.toThrow(/archived/);
    await expect(
      a.mutation(api.recurrences.ensureOccurrences, { from: "2026-01-01", to: "2026-12-31" }),
    ).rejects.toThrow(/at most/);
  });

  test("deleting the project deletes its series", async () => {
    vi.useFakeTimers();
    try {
      const { t, a, projectId } = await setup();
      await a.mutation(api.recurrences.create, { projectId, title: "Daily", startDate: MON, rule: { kind: "daily" } });
      await a.mutation(api.projects.remove, { projectId });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await t.run((ctx) => ctx.db.query("recurrences").collect())).toEqual([]);
      expect(await t.run((ctx) => ctx.db.query("todos").collect())).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("carrying over an occurrence copies it as a plain todo", async () => {
    const ctx = await setup();
    await ctx.a.mutation(api.recurrences.create, {
      projectId: ctx.projectId, title: "Report", startDate: MON, rule: { kind: "weekly", weekdays: [1] },
    });
    await ctx.a.mutation(api.todos.carryOver, { projectId: ctx.projectId, date: MON });
    const [orig, copy] = await week(ctx);
    expect(orig).toMatchObject({ status: "not_done", recurrenceDate: MON });
    expect(copy.recurrenceId).toBeUndefined();
    expect(copy.carriedFrom).toBe(orig._id as Id<"todos">);
  });

  test("carry-over doesn't copy an occurrence when the series recurs the next day", async () => {
    const ctx = await setup();
    await ctx.a.mutation(api.recurrences.create, {
      projectId: ctx.projectId, title: "Standup", startDate: MON, rule: { kind: "daily" },
    });
    expect(await ctx.a.mutation(api.todos.carryOver, { projectId: ctx.projectId, date: MON })).toBe(1);
    const todos = await week(ctx, MON, "2026-09-22");
    expect(todos.map((t) => [t.date, t.status, t.carriedFrom])).toEqual([
      [MON, "not_done", undefined],
      ["2026-09-22", "todo", undefined],
    ]);
  });
});
