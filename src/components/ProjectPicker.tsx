"use client";

import clsx from "clsx";
import type { Id } from "../../convex/_generated/dataModel";

export type ProjectLite = { _id: Id<"projects">; name: string; color: string; archived: boolean };

/** Toggleable project chips, used to pick which projects an invitation or member can see (#46). */
export function ProjectPicker({
  projects,
  selected,
  onToggle,
  legend,
}: {
  projects: ProjectLite[];
  selected: Set<Id<"projects">>;
  onToggle: (id: Id<"projects">) => void;
  legend: string;
}) {
  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      {projects.length === 0 ? (
        <p className="text-sm text-muted">Crea un proyecto antes de dar acceso.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {projects.map((p) => (
            <label
              key={p._id}
              className={clsx(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm has-focus-visible:outline-2 has-focus-visible:outline-accent",
                selected.has(p._id) ? "border-accent bg-surface-2 text-fg" : "border-line text-muted hover:text-fg",
              )}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={selected.has(p._id)}
                onChange={() => onToggle(p._id)}
              />
              <span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden />
              {p.name}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
