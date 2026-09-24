import type { Sheet, SheetData } from "write-excel-file/browser";

type Row = Record<string, string | number>;
export type XlsxSheet = { name: string; rows: Row[]; headers?: string[] };

const headersOf = ({ rows, headers }: XlsxSheet) => headers ?? Object.keys(rows[0] ?? {});

// Bold header row + one row per record. `headers` keeps the columns when a sheet has no rows.
// Strings are always written as text cells (never formulas), so no formula injection.
export function toSheetData(sheet: XlsxSheet): SheetData {
  const headers = headersOf(sheet);
  return [
    headers.map((h) => ({ value: h, fontWeight: "bold" as const })),
    ...sheet.rows.map((row) => headers.map((h) => row[h] ?? null)),
  ];
}

// Column widths (in characters) that fit the longest value, within sane bounds.
export function columnWidths(sheet: XlsxSheet) {
  return headersOf(sheet).map((h) => ({
    width: Math.min(
      60,
      sheet.rows.reduce((max, r) => Math.max(max, String(r[h] ?? "").length), Math.max(8, h.length)) + 2,
    ),
  }));
}

/** Builds an .xlsx workbook and saves it. The library is loaded on first use only. */
export async function downloadXlsx(filename: string, sheets: XlsxSheet[]) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const workbook: Sheet<File | Blob | ArrayBuffer>[] = sheets.map((s) => ({
    sheet: s.name,
    data: toSheetData(s),
    columns: columnWidths(s),
    stickyRowsCount: 1,
  }));
  await writeXlsxFile(workbook).toFile(filename);
}
