"use client";

import clsx from "clsx";
import { STATUS_META, STATUSES, type Status } from "@/lib/status";

export function StatusPill({ status, className }: { status: Status; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", meta.pill, className)}>
      <span className={clsx("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function StatusSelect({
  value,
  onChange,
}: {
  value: Status;
  onChange: (s: Status) => void;
}) {
  const meta = STATUS_META[value];
  return (
    <label className="relative inline-flex">
      <span className="sr-only">Status</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Status)}
        onClick={(e) => e.stopPropagation()}
        className={clsx(
          "cursor-pointer appearance-none rounded-full py-0.5 pr-2 pl-5 text-xs font-medium ring-1 ring-inset focus:outline-2 focus:outline-accent",
          meta.pill,
        )}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_META[s].label}
          </option>
        ))}
      </select>
      <span className={clsx("pointer-events-none absolute top-1/2 left-2 size-1.5 -translate-y-1/2 rounded-full", meta.dot)} />
    </label>
  );
}
