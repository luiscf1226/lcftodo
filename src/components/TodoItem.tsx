"use client";

import clsx from "clsx";
import { useMutation } from "convex/react";
import { Check, CornerDownRight } from "lucide-react";
import type { Doc } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { Avatar } from "./Avatar";
import { StatusSelect } from "./StatusSelect";
import type { Member } from "./useMembers";

export function TodoItem({
  todo,
  assignee,
  project,
  onOpen,
}: {
  todo: Doc<"todos">;
  assignee?: Member;
  project?: { name: string; color: string };
  onOpen: () => void;
}) {
  const setStatus = useMutation(api.todos.setStatus).withOptimisticUpdate((store, { todoId, status }) => {
    for (const { args, value } of store.getAllQueries(api.todos.listForProject)) {
      if (!value) continue;
      store.setQuery(api.todos.listForProject, args, value.map((t) => (t._id === todoId ? { ...t, status } : t)));
    }
    for (const { args, value } of store.getAllQueries(api.todos.listForTeam)) {
      if (!value) continue;
      store.setQuery(api.todos.listForTeam, args, value.map((t) => (t._id === todoId ? { ...t, status } : t)));
    }
  });
  const done = todo.status === "done";
  const notDone = todo.status === "not_done";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-surface px-2.5 py-2 text-sm transition-colors hover:border-muted/40 focus-visible:outline-2 focus-visible:outline-accent"
    >
      <button
        type="button"
        aria-label={done ? "Mark as to do" : "Mark as done"}
        onClick={(e) => {
          e.stopPropagation();
          void setStatus({ todoId: todo._id, status: done ? "todo" : "done" });
        }}
        className={clsx(
          "mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full border transition-colors",
          done ? "border-emerald-500 bg-emerald-500 text-white" : "border-line hover:border-emerald-500",
        )}
      >
        {done && <Check className="size-3" strokeWidth={3} />}
      </button>

      <div className="min-w-0 flex-1">
        <p className={clsx("break-words", (done || notDone) && "text-muted", done && "line-through")}>
          {todo.title}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <StatusSelect value={todo.status} onChange={(status) => void setStatus({ todoId: todo._id, status })} />
          {project && (
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <span className="size-2 rounded-full" style={{ background: project.color }} />
              {project.name}
            </span>
          )}
          {todo.carriedFrom && (
            <span className="inline-flex items-center gap-0.5 text-xs text-muted" title="Carried over from a previous day">
              <CornerDownRight className="size-3" /> carried
            </span>
          )}
          {assignee && (
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted">
              <Avatar member={assignee} size={16} />
              <span className="max-w-24 truncate">{assignee.name.split(" ")[0]}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
