import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { SYSTEM_ACTOR_ID } from "./lib/constants";
import { addDaysToKey, dateKeyInZone, isValidTimeZone, startOfDayInZone } from "./lib/timezone";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const alice = { subject: "user_alice", name: "Alice", org_id: "org_a", org_role: "org:admin" };
const bob = { subject: "user_bob", name: "Bob", org_id: "org_a", org_role: "org:member" };
const eve = { subject: "user_eve", name: "Eve", org_id: "org_b", org_role: "org:admin" };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const newTest = () => convexTest(schema, modules);
type T = ReturnType<typeof newTest>;

async function runCronAt(t: T, iso: string) {
  vi.setSystemTime(new Date(iso));
  const scheduled = await t.mutation(internal.teams.dispatchNightlyCarryOver, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return scheduled;
}

const todosOn = (t: T, projectId: Id<"projects">, date: string) =>
  t.run((ctx) =>
    ctx.db.query("todos").withIndex("by_project_date", (q) => q.eq("projectId", projectId).eq("date", date)).collect(),
  );

describe("timezone helpers", () => {
  test("validates IANA names", () => {
    expect(isValidTimeZone("Europe/Madrid")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  test("today depends on the zone, not the machine", () => {
    const instant = Date.parse("2026-09-23T05:30:00Z");
    expect(dateKeyInZone(instant, "America/Los_Angeles")).toBe("2026-09-22");
    expect(dateKeyInZone(instant, "Europe/Madrid")).toBe("2026-09-23");
    expect(dateKeyInZone(Date.parse("2026-09-23T12:30:00Z"), "Pacific/Auckland")).toBe("2026-09-24");
  });

  test("start of day handles DST and skipped midnights", () => {
    expect(startOfDayInZone("2026-09-23", "UTC")).toBe(Date.parse("2026-09-23T00:00:00Z"));
    expect(startOfDayInZone("2026-09-23", "Europe/Madrid")).toBe(Date.parse("2026-09-22T22:00:00Z"));
    expect(startOfDayInZone("2026-03-29", "Europe/Madrid")).toBe(Date.parse("2026-03-28T23:00:00Z"));
    expect(startOfDayInZone("2026-03-30", "Europe/Madrid")).toBe(Date.parse("2026-03-29T22:00:00Z"));
    // Whatever the DST rules, the result is the first instant of that local day.
    for (const zone of ["America/Santiago", "America/Havana", "Asia/Kathmandu", "Australia/Lord_Howe"]) {
      for (let day = "2026-01-01"; day <= "2026-12-31"; day = addDaysToKey(day, 7)) {
        const start = startOfDayInZone(day, zone);
        expect(dateKeyInZone(start, zone)).toBe(day);
        expect(dateKeyInZone(start - 1000, zone)).toBe(addDaysToKey(day, -1));
      }
    }
  });
});

describe("team settings", () => {
  test("defaults to no zone and carry-over off", async () => {
    const t = newTest();
    expect(await t.withIdentity(bob).query(api.teams.settings, {})).toEqual({
      timeZone: null,
      autoCarryOver: false,
      canEdit: false,
    });
    expect(await t.withIdentity(alice).query(api.teams.settings, {})).toMatchObject({ canEdit: true });
    expect(await t.query(api.teams.settings, {})).toBeNull();
  });

  test("only admins can change settings, and only for their own team", async () => {
    const t = newTest();
    await expect(
      t.withIdentity(bob).mutation(api.teams.updateSettings, { timeZone: "Europe/Madrid", autoCarryOver: true }),
    ).rejects.toThrow(/admins/);
    await expect(
      t.mutation(api.teams.updateSettings, { timeZone: "Europe/Madrid", autoCarryOver: true }),
    ).rejects.toThrow(/team/);

    await t.withIdentity(alice).mutation(api.teams.updateSettings, { timeZone: "Europe/Madrid", autoCarryOver: true });
    expect(await t.withIdentity(bob).query(api.teams.settings, {})).toMatchObject({
      timeZone: "Europe/Madrid",
      autoCarryOver: true,
    });
    // Other teams are unaffected.
    expect(await t.withIdentity(eve).query(api.teams.settings, {})).toMatchObject({ timeZone: null, autoCarryOver: false });
  });

  test("rejects unknown time zones", async () => {
    const t = newTest();
    await expect(
      t.withIdentity(alice).mutation(api.teams.updateSettings, { timeZone: "Nowhere/Land", autoCarryOver: false }),
    ).rejects.toThrow(/time zone/);
  });
});

describe("nightly carry-over cron", () => {
  async function setup(timeZone: string, autoCarryOver = true, setAt = "2026-09-22T12:00:00Z") {
    const t = newTest();
    const a = t.withIdentity(alice);
    vi.setSystemTime(new Date(setAt));
    const projectId = await a.mutation(api.projects.create, { name: "Launch", color: "#6366f1" });
    await a.mutation(api.teams.updateSettings, { timeZone, autoCarryOver });
    return { t, a, projectId };
  }

  test("carries yesterday's open todos once the team's day rolls over, as System", async () => {
    const { t, a, projectId } = await setup("America/Los_Angeles");
    const open = await a.mutation(api.todos.create, { projectId, title: "Open", date: "2026-09-22" });
    const done = await a.mutation(api.todos.create, { projectId, title: "Done", date: "2026-09-22" });
    await a.mutation(api.todos.setStatus, { todoId: done, status: "done" });

    // 23:01 in Los Angeles: still the 22nd, nothing happens.
    expect(await runCronAt(t, "2026-09-23T06:01:00Z")).toBe(0);
    expect(await todosOn(t, projectId, "2026-09-23")).toHaveLength(0);

    // 00:01 on the 23rd in Los Angeles.
    expect(await runCronAt(t, "2026-09-23T07:01:00Z")).toBe(1);
    const carried = await todosOn(t, projectId, "2026-09-23");
    expect(carried).toMatchObject([{ title: "Open", status: "todo", carriedFrom: open, createdBy: SYSTEM_ACTOR_ID }]);
    expect(await t.run((ctx) => ctx.db.get(open))).toMatchObject({ status: "not_done" });

    const history = await a.query(api.activity.forTodo, { todoId: open });
    expect(history[0]).toMatchObject({ action: "status", to: "not_done", actorId: SYSTEM_ACTOR_ID });
  });

  test("is idempotent: running again (or re-running the team job) does not double-carry", async () => {
    const { t, a, projectId } = await setup("UTC");
    await a.mutation(api.todos.create, { projectId, title: "Open", date: "2026-09-22" });

    expect(await runCronAt(t, "2026-09-23T00:01:00Z")).toBe(1);
    expect(await runCronAt(t, "2026-09-23T00:01:00Z")).toBe(0);
    expect(await runCronAt(t, "2026-09-23T01:01:00Z")).toBe(0);
    // A duplicate job for the same day (e.g. a retried scheduler run) is a no-op.
    expect(await t.mutation(internal.teams.carryOverTeam, { orgId: "org_a", date: "2026-09-23" })).toBe(0);

    expect(await todosOn(t, projectId, "2026-09-23")).toHaveLength(1);
    const log = await t.run((ctx) => ctx.db.query("activity").collect());
    expect(log.filter((r) => r.action === "carried_over")).toHaveLength(1);
  });

  test("skips archived projects", async () => {
    const { t, a, projectId } = await setup("UTC");
    const archivedId = await a.mutation(api.projects.create, { name: "Old", color: "#0ea5e9" });
    await a.mutation(api.todos.create, { projectId, title: "Live", date: "2026-09-22" });
    const frozen = await a.mutation(api.todos.create, { projectId: archivedId, title: "Frozen", date: "2026-09-22" });
    await a.mutation(api.projects.setArchived, { projectId: archivedId, archived: true });

    await runCronAt(t, "2026-09-23T00:01:00Z");
    expect(await todosOn(t, projectId, "2026-09-23")).toHaveLength(1);
    expect(await todosOn(t, archivedId, "2026-09-23")).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.get(frozen))).toMatchObject({ status: "todo" });
  });

  test("only runs for teams that turned it on", async () => {
    const { t, a, projectId } = await setup("UTC", false);
    await a.mutation(api.todos.create, { projectId, title: "Manual", date: "2026-09-22" });
    // A team without any settings row at all.
    const e = t.withIdentity(eve);
    const eveProject = await e.mutation(api.projects.create, { name: "Eve", color: "#6366f1" });
    await e.mutation(api.todos.create, { projectId: eveProject, title: "Eve's", date: "2026-09-22" });

    expect(await runCronAt(t, "2026-09-23T00:01:00Z")).toBe(0);
    expect(await todosOn(t, projectId, "2026-09-23")).toHaveLength(0);
    expect(await todosOn(t, eveProject, "2026-09-23")).toHaveLength(0);
  });

  test("turning it on mid-day waits for the next midnight", async () => {
    const { t, a, projectId } = await setup("UTC", true, "2026-09-23T15:00:00Z");
    await a.mutation(api.todos.create, { projectId, title: "Yesterday", date: "2026-09-22" });
    await a.mutation(api.todos.create, { projectId, title: "Today", date: "2026-09-23" });

    expect(await runCronAt(t, "2026-09-23T16:01:00Z")).toBe(0);
    expect(await runCronAt(t, "2026-09-24T00:01:00Z")).toBe(1);
    expect((await todosOn(t, projectId, "2026-09-24")).map((x) => x.title)).toEqual(["Today"]);
    expect((await todosOn(t, projectId, "2026-09-23")).map((x) => x.title)).toEqual(["Today"]);
  });

  test("runs exactly once per local day across a DST change that skips midnight", async () => {
    // Chile moves clocks from 24:00 to 01:00 in early September, so local
    // midnight never happens on that day; an "is it hour 0?" check would miss it.
    const zone = "America/Santiago";
    const { t, a, projectId } = await setup(zone, true, "2026-09-01T12:00:00Z");
    for (let day = "2026-09-01"; day <= "2026-09-10"; day = addDaysToKey(day, 1)) {
      await a.mutation(api.todos.create, { projectId, title: `Due ${day}`, date: day });
    }

    const runsPerDay = new Map<string, number>();
    for (let ms = Date.parse("2026-09-01T12:01:00Z"); ms <= Date.parse("2026-09-10T12:01:00Z"); ms += 3_600_000) {
      const iso = new Date(ms).toISOString();
      const ran = await runCronAt(t, iso);
      if (ran) {
        const day = dateKeyInZone(ms, zone);
        runsPerDay.set(day, (runsPerDay.get(day) ?? 0) + ran);
      }
    }
    const expected = [];
    for (let day = "2026-09-02"; day <= "2026-09-10"; day = addDaysToKey(day, 1)) expected.push([day, 1]);
    expect([...runsPerDay]).toEqual(expected);

    // No todo was ever carried twice.
    const all = await t.run((ctx) => ctx.db.query("todos").collect());
    const sources = all.flatMap((x) => (x.carriedFrom ? [x.carriedFrom] : []));
    expect(sources.length).toBeGreaterThan(0);
    expect(new Set(sources).size).toBe(sources.length);
  }, 30_000);
});
