export type Page<T> = { page: T[]; isDone: boolean; continueCursor: string };

// Upper bound on round trips for one export, so a misbehaving cursor can't loop forever.
// At 1,000 rows per page this is far above a 366-day export for any realistic team.
export const MAX_EXPORT_PAGES = 1000;

/**
 * Follows `continueCursor` until `isDone` and returns every row (#15).
 * Throws instead of returning a partial result if the page limit is reached.
 */
export async function collectPages<T>(
  fetchPage: (cursor: string | null) => Promise<Page<T>>,
  maxPages = MAX_EXPORT_PAGES,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const result: Page<T> = await fetchPage(cursor);
    rows.push(...result.page);
    if (result.isDone) return rows;
    cursor = result.continueCursor;
  }
  throw new Error("Esta exportación es demasiado grande. Reduce el período o ajusta los filtros e inténtalo de nuevo.");
}
