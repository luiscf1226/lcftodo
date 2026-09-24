import { describe, expect, test, vi } from "vitest";
import { weekStart } from "./dates";

describe("weekStart", () => {
  test("falls back to the current week for an invalid date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T12:00:00"));

    expect(weekStart("abc")).toBe("2026-09-21");

    vi.useRealTimers();
  });

  test("snaps valid dates to Monday", () => {
    expect(weekStart("2026-09-23")).toBe("2026-09-21");
  });
});
