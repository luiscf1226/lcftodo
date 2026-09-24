import { describe, expect, test } from "vitest";
import { ACTIONS, emptyStatusCounts, STATUSES } from "./lib/constants";
import { action, status } from "./schema";

describe("shared constants (#37)", () => {
  test("schema validators are derived from STATUSES and ACTIONS", () => {
    expect(status.members.map((m) => m.value)).toEqual([...STATUSES]);
    expect(action.members.map((m) => m.value)).toEqual([...ACTIONS]);
  });

  test("emptyStatusCounts has a zero for every status", () => {
    expect(emptyStatusCounts()).toEqual(Object.fromEntries(STATUSES.map((s) => [s, 0])));
  });
});
