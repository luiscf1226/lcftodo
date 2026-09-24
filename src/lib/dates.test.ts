import { describe, expect, test, vi } from "vitest";
import { dayStartMs, todayKey, weekStart } from "./dates";

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

describe("team time zone (#21)", () => {
  test("todayKey uses the team zone when given", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T03:00:00Z"));

    expect(todayKey("America/New_York")).toBe("2026-09-22");
    expect(todayKey("Asia/Tokyo")).toBe("2026-09-23");

    vi.useRealTimers();
  });

  test("dayStartMs is midnight in the team zone", () => {
    expect(dayStartMs("2026-09-23", "Asia/Tokyo")).toBe(Date.parse("2026-09-22T15:00:00Z"));
    expect(dayStartMs("2026-09-23", "America/New_York")).toBe(Date.parse("2026-09-23T04:00:00Z"));
  });
});
