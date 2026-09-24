import { describe, expect, test } from "vitest";
import { isQuickAddShortcut, splitTitles } from "./quickAdd";

describe("splitTitles", () => {
  test("creates one title per non-empty line", () => {
    expect(splitTitles("Buy milk\n\n  Email Ana  \r\nBook dentist")).toEqual(["Buy milk", "Email Ana", "Book dentist"]);
  });

  test("strips list markers from pasted lists", () => {
    expect(splitTitles("- one\n* two\n• three\n1. four\n2) five\n[ ] six\n[x] seven")).toEqual([
      "one", "two", "three", "four", "five", "six", "seven",
    ]);
  });

  test("keeps text that only looks like a marker", () => {
    expect(splitTitles("-5 degrees\n2026 plan")).toEqual(["-5 degrees", "2026 plan"]);
  });

  test("returns nothing for blank input", () => {
    expect(splitTitles("  \n\t\n")).toEqual([]);
  });
});

describe("isQuickAddShortcut", () => {
  const key = (k: string, target: object | null = { tagName: "BODY" }, mods = {}) =>
    isQuickAddShortcut({ key: k, metaKey: false, ctrlKey: false, altKey: false, target, ...mods } as never);

  test("fires on / and n outside text fields", () => {
    expect(key("/")).toBe(true);
    expect(key("n")).toBe(true);
  });

  test("ignores typing, other keys and modifier combos", () => {
    expect(key("n", { tagName: "INPUT" })).toBe(false);
    expect(key("/", { tagName: "TEXTAREA" })).toBe(false);
    expect(key("n", { tagName: "DIV", isContentEditable: true })).toBe(false);
    expect(key("x")).toBe(false);
    expect(key("n", undefined, { metaKey: true })).toBe(false);
  });
});
