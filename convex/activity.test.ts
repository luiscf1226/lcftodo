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
  const p1 = await a.mutation(api.projects.create, { name: "One", color: "#111" });
  const p2 = await a.mutation(api.projects.create, { name: "Two", color: "#222" });
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
    expect(res.page.map((r) => r.todoTitle)).toEqual(["user_bob-p1-3", "user_bob-p1-2", "user_bob-p1-1", "user_bob-p1-0"]);
  });

  test("unfiltered and project-only listing still work", async () => {
    const { a, p1, seed } = await setup();
    await seed([{ actorId: "user_bob", projectId: p1, n: 3 }]);
    const all = await a.query(api.activity.list, { paginationOpts: { numItems: 50, cursor: null } });
    expect(all.page).toHaveLength(5); // 2 project_created + 3 seeded
    const one = await a.query(api.activity.list, { projectId: p1, paginationOpts: { numItems: 50, cursor: null } });
    expect(one.page).toHaveLength(4);
  });
});
