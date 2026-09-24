import { describe, expect, test } from "vitest";
import { collectPages, type Page } from "./export";

function pager(total: number, size: number) {
  const cursors: (string | null)[] = [];
  const fetchPage = async (cursor: string | null): Promise<Page<number>> => {
    cursors.push(cursor);
    const start = cursor ? Number(cursor) : 0;
    const page = Array.from({ length: Math.min(size, total - start) }, (_, i) => start + i);
    const next = start + page.length;
    return { page, isDone: next >= total, continueCursor: String(next) };
  };
  return { fetchPage, cursors };
}

describe("collectPages", () => {
  test("follows the cursor until isDone and returns every row in order", async () => {
    const { fetchPage, cursors } = pager(2_500, 1_000);
    const rows = await collectPages(fetchPage);
    expect(rows).toHaveLength(2_500);
    expect(rows[0]).toBe(0);
    expect(rows.at(-1)).toBe(2_499);
    expect(cursors).toEqual([null, "1000", "2000"]);
  });

  test("returns an empty list for an empty first page", async () => {
    expect(await collectPages(pager(0, 1_000).fetchPage)).toEqual([]);
  });

  test("throws instead of returning a partial export when the page limit is hit", async () => {
    await expect(collectPages(pager(5_000, 1_000).fetchPage, 3)).rejects.toThrow(/demasiado grande/);
  });
});
