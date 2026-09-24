// Fractional ordering for todos within a project's day (#13). Pure helpers with
// no server-only imports so the UI computes the same positions it sends to
// `todos.move`.

/** Spacing between neighbours after a rebalance, and when appending to a day. */
export const ORDER_STEP = 1024;

/**
 * Smallest gap allowed between two neighbours. Orders created by `todos.create`
 * are millisecond timestamps (~1.7e12), where a double's precision is ~2.4e-4,
 * so a gap below this is close to collapsing into a tie and the day is renumbered.
 */
export const MIN_ORDER_GAP = 1e-3;

/**
 * An order that sorts between `before` and `after` (either may be missing for
 * the start/end of the list).
 */
export function orderBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return ORDER_STEP;
  if (before === undefined) return after! - ORDER_STEP;
  if (after === undefined) return before + ORDER_STEP;
  return before + (after - before) / 2;
}

/**
 * The order that places an item at `index` of `list` (sorted by order, with the
 * item itself already removed).
 */
export function orderAt(list: readonly { order: number }[], index: number): number {
  return orderBetween(list[index - 1]?.order, list[index]?.order);
}

/** True if any two neighbours of an order-sorted list are closer than MIN_ORDER_GAP. */
export function needsRebalance(sorted: readonly { order: number }[]): boolean {
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].order - sorted[i - 1].order < MIN_ORDER_GAP) return true;
  }
  return false;
}
