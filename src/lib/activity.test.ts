import { describe as group, expect, test } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { ACTIONS } from "../../convex/lib/constants";
import { describe } from "./activity";

// Moves and carry-overs store days in from/to; status changes store statuses.
const dated = new Set(["moved", "carried_over"]);

const entry = (action: Doc<"activity">["action"]): Doc<"activity"> => ({
  _id: "a" as Id<"activity">,
  _creationTime: 0,
  orgId: "org_a",
  projectId: "p" as Id<"projects">,
  projectName: "Launch",
  actorId: "user_a",
  action,
  todoTitle: "Ship",
  from: dated.has(action) ? "2026-09-21" : "todo",
  to: dated.has(action) ? "2026-09-22" : "not_done",
  date: "2026-09-21",
});

group("describe (#37)", () => {
  test("every activity action has a sentence", () => {
    for (const action of ACTIONS) expect(describe(entry(action))).toMatch(/\w/);
  });

  test("status changes use the shared status labels", () => {
    expect(describe(entry("status"))).toBe("marked “Ship” Didn't finish (was To do)");
  });
});
