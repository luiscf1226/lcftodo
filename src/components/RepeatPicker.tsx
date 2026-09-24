"use client";

import clsx from "clsx";
import type { RecurrenceKind, RecurrenceRule } from "../../convex/lib/constants";
import { WEEKDAY_ORDER, weekdayName, weekdayOf } from "../../convex/lib/recurrence";

// Picks a recurrence rule (#23): none, daily, weekdays, or weekly on chosen days.
export function RepeatPicker({
  id,
  value,
  onChange,
  day,
}: {
  id: string;
  value: RecurrenceRule | null;
  onChange: (rule: RecurrenceRule | null) => void;
  // The todo's day; a new weekly rule starts on that weekday.
  day: string;
}) {
  const weekdays = value?.weekdays ?? [];
  const toggle = (d: number) =>
    onChange({ kind: "weekly", weekdays: weekdays.includes(d) ? weekdays.filter((x) => x !== d) : [...weekdays, d] });

  return (
    <div className="space-y-2">
      <select
        id={id}
        className="input"
        value={value?.kind ?? ""}
        onChange={(e) => {
          const kind = e.target.value as RecurrenceKind | "";
          if (!kind) onChange(null);
          else if (kind === "weekly") onChange({ kind, weekdays: weekdays.length ? weekdays : [weekdayOf(day)] });
          else onChange({ kind });
        }}
      >
        <option value="">Does not repeat</option>
        <option value="daily">Every day</option>
        <option value="weekdays">Every weekday (Mon–Fri)</option>
        <option value="weekly">Weekly on…</option>
      </select>
      {value?.kind === "weekly" && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Repeat on">
          {WEEKDAY_ORDER.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={weekdays.includes(d)}
              onClick={() => toggle(d)}
              className={clsx(
                "rounded-md border px-2 py-1 text-xs font-medium",
                weekdays.includes(d)
                  ? "border-accent bg-accent text-accent-fg"
                  : "border-line text-muted hover:text-fg",
              )}
            >
              {weekdayName(d)}
            </button>
          ))}
        </div>
      )}
      {value?.kind === "weekly" && weekdays.length === 0 && (
        <p className="text-xs text-danger">Pick at least one day.</p>
      )}
    </div>
  );
}
