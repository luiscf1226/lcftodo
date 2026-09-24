import { describe, expect, test } from "vitest";
import { toCsv } from "./csv";
import { columnWidths, toSheetData } from "./xlsx";

describe("toSheetData", () => {
  test("writes a bold header row and cells in header order", () => {
    const data = toSheetData({ name: "People", rows: [{ done: 2, person: "Ana" }], headers: ["person", "done"] });
    expect(data).toEqual([
      [
        { value: "person", fontWeight: "bold" },
        { value: "done", fontWeight: "bold" },
      ],
      ["Ana", 2],
    ]);
  });

  test("keeps headers for empty sheets and blanks missing cells", () => {
    expect(toSheetData({ name: "Activity", rows: [], headers: ["time", "person"] })).toHaveLength(1);
    expect(toSheetData({ name: "Todos", rows: [{ title: "x" }], headers: ["title", "notes"] })[1]).toEqual(["x", null]);
  });

  test("falls back to the first row's keys", () => {
    expect(
      toSheetData({ name: "S", rows: [{ a: 1, b: "two" }] })[0].map((c) => (c as { value: string }).value),
    ).toEqual(["a", "b"]);
  });
});

describe("columnWidths", () => {
  test("fits the longest value within bounds", () => {
    const widths = columnWidths({ name: "S", rows: [{ id: 1, title: "x".repeat(20), notes: "y".repeat(500) }] });
    expect(widths).toEqual([{ width: 10 }, { width: 22 }, { width: 60 }]);
  });
});

describe("workbook", () => {
  test("produces an .xlsx with Todos, Activity and People sheets", async () => {
    // Same writer as the browser build, minus the download step.
    const { default: writeXlsxFile } = await import("write-excel-file/universal");
    const { unzipSync, strFromU8 } = await import("fflate");
    const sheets = [
      { name: "Todos", rows: [{ title: '=HYPERLINK("x")' }], headers: ["title"] },
      { name: "Activity", rows: [], headers: ["time"] },
      { name: "People", rows: [{ person: "Ana", done: 1 }] },
    ];
    const blob = await writeXlsxFile(
      sheets.map((s) => ({ sheet: s.name, data: toSheetData(s), columns: columnWidths(s) })),
    ).toBlob();
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const workbook = strFromU8(files["xl/workbook.xml"]);
    expect([...workbook.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "Todos",
      "Activity",
      "People",
    ]);
    // Text that looks like a formula is stored as text, never as a formula.
    expect(strFromU8(files["xl/worksheets/sheet1.xml"])).not.toContain("<f>");
  });
});

describe("toCsv headers", () => {
  test("keeps a header row when there are no rows", () => {
    expect(toCsv([], ["person", "done"])).toBe("person,done");
    expect(toCsv([])).toBe("");
  });
});
