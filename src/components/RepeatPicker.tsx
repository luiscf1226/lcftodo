"use client";

import clsx from "clsx";
import type { RecurrenceKind, RecurrenceRule } from "../../convex/lib/constants";
import { WEEKDAY_ORDER, weekdayOf } from "../../convex/lib/recurrence";

const WEEKDAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

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
        <option value="">No se repite</option>
        <option value="daily">Todos los días</option>
        <option value="weekdays">Días laborables (lun–vie)</option>
        <option value="weekly">Cada semana los…</option>
      </select>
      {value?.kind === "weekly" && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Repetir los">
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
              {WEEKDAY_LABELS[d]}
            </button>
          ))}
        </div>
      )}
      {value?.kind === "weekly" && weekdays.length === 0 && (
        <p className="text-xs text-danger">Elige al menos un día.</p>
      )}
    </div>
  );
}
