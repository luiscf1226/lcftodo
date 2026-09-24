import type { Status } from "../../convex/lib/constants";

// Statuses, limits and the palette are defined once in Convex (#37) and shared with the UI.
export { emptyStatusCounts, LIMITS, PROJECT_COLORS, STATUSES, type Status } from "../../convex/lib/constants";

// UI metadata for each status. `Record<Status, …>` fails to compile if a status is missing.
export const STATUS_META: Record<Status, { label: string; dot: string; pill: string }> = {
  todo: {
    label: "To do",
    dot: "bg-slate-400",
    pill: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
  },
  doing: {
    label: "Doing",
    dot: "bg-amber-500",
    pill: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900",
  },
  done: {
    label: "Done",
    dot: "bg-emerald-500",
    pill: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900",
  },
  not_done: {
    label: "Didn't finish",
    dot: "bg-rose-500",
    pill: "bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-900",
  },
};
