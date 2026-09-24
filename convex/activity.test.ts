import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { PaginationResult } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const alice = { subject: "user_alice", name: "Alice", org_id: "org_a", org_role: "org:admin" };

type Actor = "user_alice" | "user_bob";

async function setup() {
  const t = convexTest(schema, modules);
  const a = t.withIdentity(alice);
  const p1 = await a.mutation(api.projects.create, { name: "One", color: "#6366f1" });
  const p2 = await a.mutation(api.projects.create, { name: "Two", color: "#0ea5e9" });
  // Insert activity rows directly, oldest first.
  const seed = (rows: { actorId: Actor; projectId: Id<"projects">; n: number }[]) =>
    t.run(async (ctx) => {
      for (const { actorId, projectId, n } of rows) {
        for (let i = 0; i < n; i++) {
          await ctx.db.insert("activity", {
            orgId: "org_a",
            projectId,
            projectName: projectId === p1 ? "One" : "Two",
            actorId,
            action: "created",
            todoTitle: `${actorId}-${projectId === p1 ? "p1" : "p2"}-${i}`,
          });
        }
      }
    });
  return { t, a, p1, p2, seed };
}

// Deployed Convex bounds how many rows one page may scan; a `.filter()` after the index
// counts non-matching rows against that budget, which is what makes filtered pages sparse.
// `maximumRowsRead` reproduces that budget in convex-test.
const SCAN_BUDGET = 20;

describe("activity.list actor filter (by_org_actor)", () => {
  test("filtered pages are full, newest first, and page through every match", async () => {
    const { a, p1, p2, seed } = await setup();
    // Bob's rows are buried under lots of Alice's newer activity.
    await seed([
      { actorId: "user_bob", projectId: p1, n: 7 },
      { actorId: "user_bob", projectId: p2, n: 5 },
      { actorId: "user_alice", projectId: p1, n: 100 },
    ]);

    const sizes: number[] = [];
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 50; i++) {
      const res: PaginationResult<Doc<"activity">> = await a.query(api.activity.list, {
        actorId: "user_bob",
        paginationOpts: { numItems: 5, cursor, maximumRowsRead: SCAN_BUDGET },
      });
      expect(res.page.every((r) => r.actorId === "user_bob")).toBe(true);
      sizes.push(res.page.length);
      seen.push(...res.page.map((r) => r.todoTitle!));
      if (res.isDone) break;
      cursor = res.continueCursor;
    }
    // 12 matches at 5 per page: three full-as-possible pages, no empty/sparse ones.
    expect(sizes).toEqual([5, 5, 2]);
    expect(seen).toHaveLength(12);
    expect(seen[0]).toBe("user_bob-p2-4"); // newest first
    expect(seen.at(-1)).toBe("user_bob-p1-0");
  });

  test("project + actor filter pages are full and scoped", async () => {
    const { a, p1, p2, seed } = await setup();
    await seed([
      { actorId: "user_bob", projectId: p1, n: 4 },
      { actorId: "user_bob", projectId: p2, n: 50 },
      { actorId: "user_alice", projectId: p1, n: 50 },
    ]);
    const res = await a.query(api.activity.list, {
      projectId: p1,
      actorId: "user_bob",
      paginationOpts: { numItems: 4, cursor: null, maximumRowsRead: SCAN_BUDGET },
    });
    expect(res.page.map((r) => r.todoTitle)).toEqual([
      "user_bob-p1-3",
      "user_bob-p1-2",
      "user_bob-p1-1",
      "user_bob-p1-0",
    ]);
  });

  test("unfiltered and project-only listing still work (list)", async () => {
    const { a, p1, seed } = await setup();
    await seed([{ actorId: "user_bob", projectId: p1, n: 3 }]);
    const all = await a.query(api.activity.list, { paginationOpts: { numItems: 50, cursor: null } });
    expect(all.page).toHaveLength(5); // 2 project_created + 3 seeded
    const one = await a.query(api.activity.list, { projectId: p1, paginationOpts: { numItems: 50, cursor: null } });
    expect(one.page).toHaveLength(4);
  });
});

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
// What the History page sends: local midnight of `from` .. one ms before local midnight after `to`.
const around = (now = Date.now()) => ({ fromMs: now - DAY, toMs: now + DAY });

describe("activity export", () => {
  test("exportRange reports the 5,000-row cap instead of silently truncating", async () => {
    const { a, p1, seed } = await setup();
    await seed([{ actorId: "user_bob", projectId: p1, n: 5_100 }]);
    await expect(a.query(api.activity.exportRange, around())).rejects.toThrow(/more than 5,000/);
  });

  test("exportRange still returns every row under the cap", async () => {
    const { a, p1, p2, seed } = await setup();
    await seed([
      { actorId: "user_bob", projectId: p1, n: 30 },
      { actorId: "user_bob", projectId: p2, n: 20 },
    ]);
    expect(await a.query(api.activity.exportRange, around())).toHaveLength(52);
    expect(await a.query(api.activity.exportRange, { ...around(), projectId: p2 })).toHaveLength(21);
  });

  test("exportPage pages through every row in the range, newest first", async () => {
    const { a, p1, p2, seed } = await setup();
    await seed([
      { actorId: "user_bob", projectId: p1, n: 5_100 },
      { actorId: "user_alice", projectId: p2, n: 50 },
    ]);
    const rows: Doc<"activity">[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const res: PaginationResult<Doc<"activity">> = await a.query(api.activity.exportPage, {
        ...around(),
        paginationOpts: { numItems: 5_000, cursor }, // clamped server-side
      });
      expect(res.page.length).toBeLessThanOrEqual(1_000);
      rows.push(...res.page);
      pages++;
      if (res.isDone) break;
      cursor = res.continueCursor;
    }
    expect(pages).toBeGreaterThan(5);
    expect(rows).toHaveLength(5_152); // 2 project_created + 5,100 + 50
    expect(new Set(rows.map((r) => r._id)).size).toBe(rows.length);
    const times = rows.map((r) => r._creationTime);
    expect(times).toEqual([...times].sort((x, y) => y - x));
  });

  test("exportPage filters by project and actor via indexes", async () => {
    const { a, p1, p2, seed } = await setup();
    await seed([
      { actorId: "user_bob", projectId: p1, n: 3 },
      { actorId: "user_bob", projectId: p2, n: 4 },
      { actorId: "user_alice", projectId: p1, n: 5 },
    ]);
    const page = (args: { projectId?: Id<"projects">; actorId?: string }) =>
      a
        .query(api.activity.exportPage, { ...around(), ...args, paginationOpts: { numItems: 100, cursor: null } })
        .then((r) => r.page.length);
    expect(await page({ projectId: p1 })).toBe(9); // 3 + 5 + project_created
    expect(await page({ actorId: "user_bob" })).toBe(7);
    expect(await page({ projectId: p1, actorId: "user_bob" })).toBe(3);
    expect(await page({ projectId: p2, actorId: "user_alice" })).toBe(1); // project_created
  });

  test("exportPage respects the time range", async () => {
    const { a, p1, seed } = await setup();
    await seed([{ actorId: "user_bob", projectId: p1, n: 3 }]);
    const future = Date.now() + 10 * DAY;
    const res = await a.query(api.activity.exportPage, {
      fromMs: future,
      toMs: future + DAY,
      paginationOpts: { numItems: 100, cursor: null },
    });
    expect(res).toMatchObject({ page: [], isDone: true });
  });

  test("exportPage caps the range at 366 days with a clear error", async () => {
    const { a } = await setup();
    const fromMs = Date.now() - 400 * DAY;
    const paginationOpts = { numItems: 10, cursor: null };
    // 366 calendar days, inclusive, as the History page computes it (+1h DST slack).
    await expect(
      a.query(api.activity.exportPage, { fromMs, toMs: fromMs + 366 * DAY - 1 + HOUR, paginationOpts }),
    ).resolves.toMatchObject({ isDone: true });
    await expect(
      a.query(api.activity.exportPage, { fromMs, toMs: fromMs + 367 * DAY - 1, paginationOpts }),
    ).rejects.toThrow(/366 days/);
    await expect(
      a.query(api.activity.exportPage, { fromMs: fromMs + DAY, toMs: fromMs, paginationOpts }),
    ).rejects.toThrow(/before/);
  });

  test("exportPage rejects non-finite bounds", async () => {
    const { a } = await setup();
    const paginationOpts = { numItems: 100, cursor: null };
    await expect(
      a.query(api.activity.exportPage, { fromMs: Number.NaN, toMs: Date.now(), paginationOpts }),
    ).rejects.toThrow(/Invalid date range/);
    await expect(
      a.query(api.activity.exportPage, { fromMs: 0, toMs: Number.POSITIVE_INFINITY, paginationOpts }),
    ).rejects.toThrow(/Invalid date range/);
  });

  test("exportPage is scoped to the caller's team", async () => {
    const { t, p1, seed } = await setup();
    await seed([{ actorId: "user_bob", projectId: p1, n: 3 }]);
    const e = t.withIdentity({ subject: "user_eve", org_id: "org_b", org_role: "org:admin" });
    const paginationOpts = { numItems: 100, cursor: null };
    expect((await e.query(api.activity.exportPage, { ...around(), paginationOpts })).page).toEqual([]);
    expect(await e.query(api.activity.exportPage, { ...around(), projectId: p1, paginationOpts })).toMatchObject({
      page: [],
      isDone: true,
    });
  });
});
