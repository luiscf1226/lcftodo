import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const alice = { subject: "user_alice", name: "Alice", org_id: "org_a", org_role: "org:admin" };
const eve = { subject: "user_eve", name: "Eve", org_id: "org_b", org_role: "org:admin" };

type Status = "todo" | "doing" | "done" | "not_done";

describe("projects.listWithStats", () => {
  test("counts todos per project and status within the range only", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(alice);
    const e = t.withIdentity(eve);
    const zeta = await a.mutation(api.projects.create, { name: "Zeta", color: "#111" });
    const alpha = await a.mutation(api.projects.create, { name: "Alpha", color: "#222" });
    const old = await a.mutation(api.projects.create, { name: "Old", color: "#333" });
    const empty = await a.mutation(api.projects.create, { name: "Empty", color: "#444" });
    await a.mutation(api.projects.setArchived, { projectId: old, archived: true });
    const other = await e.mutation(api.projects.create, { name: "Other team", color: "#555" });

    const seed = async (orgId: string, projectId: Id<"projects">, date: string, status: Status) =>
      t.run((ctx) =>
        ctx.db.insert("todos", { orgId, projectId, title: "x", date, status, createdBy: "u", order: 0 }),
      );
    // In range (2026-09-21 .. 2026-09-27)
    await seed("org_a", zeta, "2026-09-21", "todo");
    await seed("org_a", zeta, "2026-09-21", "done");
    await seed("org_a", zeta, "2026-09-27", "done");
    await seed("org_a", alpha, "2026-09-23", "doing");
    await seed("org_a", alpha, "2026-09-24", "not_done");
    await seed("org_a", old, "2026-09-25", "done");
    // Out of range
    await seed("org_a", zeta, "2026-09-20", "todo");
    await seed("org_a", alpha, "2026-09-28", "done");
    // Other team, in range
    await seed("org_b", other, "2026-09-22", "todo");

    const rows = await a.query(api.projects.listWithStats, { from: "2026-09-21", to: "2026-09-27" });
    // Active first (by name), archived last.
    expect(rows.map((r) => r.name)).toEqual(["Alpha", "Empty", "Zeta", "Old"]);
    const byName = Object.fromEntries(rows.map((r) => [r.name, { counts: r.counts, total: r.total }]));
    expect(byName).toEqual({
      Alpha: { counts: { todo: 0, doing: 1, done: 0, not_done: 1 }, total: 2 },
      Empty: { counts: { todo: 0, doing: 0, done: 0, not_done: 0 }, total: 0 },
      Zeta: { counts: { todo: 1, doing: 0, done: 2, not_done: 0 }, total: 3 },
      Old: { counts: { todo: 0, doing: 0, done: 1, not_done: 0 }, total: 1 },
    });
    // Response carries the full project document alongside the stats.
    const zetaRow = rows.find((r) => r._id === zeta)!;
    expect(zetaRow).toMatchObject({ _id: zeta, orgId: "org_a", name: "Zeta", color: "#111", archived: false, createdBy: "user_alice" });
    expect(Object.keys(zetaRow).sort()).toEqual(
      ["_creationTime", "_id", "archived", "color", "counts", "createdBy", "name", "orgId", "total"].sort(),
    );
    expect(rows.find((r) => r._id === empty)!.total).toBe(0);

    const eveRows = await e.query(api.projects.listWithStats, { from: "2026-09-21", to: "2026-09-27" });
    expect(eveRows.map((r) => [r.name, r.total])).toEqual([["Other team", 1]]);
  });
});
