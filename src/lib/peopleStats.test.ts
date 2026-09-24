import { describe, expect, test } from "vitest";
import { completion, peopleStats } from "./peopleStats";

const members = [
  { id: "u_ana", name: "Ana" },
  { id: "u_ben", name: "Ben" },
  { id: "u_cy", name: "Cy" },
];
const nameOf = (id: string) => (id === "u_old" ? "Olga (former)" : "Former member");

describe("peopleStats", () => {
  test("counts assigned, done, didn't finish and open per person", () => {
    const stats = peopleStats(
      [
        { assigneeId: "u_ana", status: "done" },
        { assigneeId: "u_ana", status: "done" },
        { assigneeId: "u_ana", status: "not_done" },
        { assigneeId: "u_ana", status: "todo" },
        { assigneeId: "u_ben", status: "doing" },
        { assigneeId: "u_ben", status: "done" },
      ],
      members,
      nameOf,
    );
    expect(stats.find((p) => p.id === "u_ana")).toEqual({
      id: "u_ana",
      name: "Ana",
      assigned: 4,
      done: 2,
      notDone: 1,
      open: 1,
    });
    expect(stats.find((p) => p.id === "u_ben")).toEqual({
      id: "u_ben",
      name: "Ben",
      assigned: 2,
      done: 1,
      notDone: 0,
      open: 1,
    });
  });

  test("always shows every member and an Unassigned bucket", () => {
    const stats = peopleStats([{ status: "todo" }, { assigneeId: "", status: "done" }], members, nameOf);
    expect(stats.map((p) => p.name)).toEqual(["Unassigned", "Ana", "Ben", "Cy"]);
    expect(stats[0]).toMatchObject({ id: undefined, assigned: 2, done: 1, open: 1 });
    expect(stats.find((p) => p.id === "u_cy")).toMatchObject({ assigned: 0 });
  });

  test("includes former members who still have todos", () => {
    const stats = peopleStats([{ assigneeId: "u_old", status: "not_done" }], members, nameOf);
    expect(stats[0]).toEqual({ id: "u_old", name: "Olga (former)", assigned: 1, done: 0, notDone: 1, open: 0 });
    expect(stats).toHaveLength(5);
  });

  test("sorts busiest first, then by name", () => {
    const stats = peopleStats(
      [
        { assigneeId: "u_cy", status: "todo" },
        { assigneeId: "u_cy", status: "todo" },
        { assigneeId: "u_ben", status: "todo" },
      ],
      members,
      nameOf,
    );
    expect(stats.map((p) => p.name)).toEqual(["Cy", "Ben", "Ana", "Unassigned"]);
  });

  test("buckets sum to the number of todos", () => {
    const todos = [
      { assigneeId: "u_ana", status: "done" as const },
      { assigneeId: "u_old", status: "doing" as const },
      { status: "not_done" as const },
    ];
    const stats = peopleStats(todos, members, nameOf);
    expect(stats.reduce((n, p) => n + p.assigned, 0)).toBe(todos.length);
    for (const p of stats) expect(p.done + p.notDone + p.open).toBe(p.assigned);
  });
});

describe("completion", () => {
  test("rounds to a whole percent and is null with nothing assigned", () => {
    expect(completion({ assigned: 3, done: 2 })).toBe(67);
    expect(completion({ assigned: 4, done: 4 })).toBe(100);
    expect(completion({ assigned: 0, done: 0 })).toBeNull();
  });
});
