"use client";

import { useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { describe } from "@/lib/activity";
import { Modal } from "./Modal";
import { useMembers } from "./useMembers";

type Props = {
  open: boolean;
  onClose: () => void;
  projectId: Id<"projects">;
  date: string;
  todo?: Doc<"todos">;
};

export function TodoDialog(props: Props) {
  return (
    <Modal open={props.open} onClose={props.onClose} title={props.todo ? "Edit todo" : "New todo"}>
      <TodoForm key={props.todo?._id ?? props.date} {...props} />
    </Modal>
  );
}

function TodoForm({ onClose, projectId, date, todo }: Props) {
  const { members, nameOf } = useMembers();
  const create = useMutation(api.todos.create);
  const update = useMutation(api.todos.update);
  const remove = useMutation(api.todos.remove);
  const history = useQuery(api.activity.forTodo, todo ? { todoId: todo._id } : "skip");

  const [title, setTitle] = useState(todo?.title ?? "");
  const [notes, setNotes] = useState(todo?.notes ?? "");
  const [day, setDay] = useState(todo?.date ?? date);
  const [assigneeId, setAssigneeId] = useState(todo?.assigneeId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : "Something went wrong.");
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    const fields = { title, notes, date: day, assigneeId: assigneeId || undefined };
    void run(() => (todo ? update({ todoId: todo._id, ...fields }) : create({ projectId, ...fields })));
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor="todo-title">Title</label>
        <input id="todo-title" autoFocus className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to get done?" maxLength={300} required />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="todo-date">Day</label>
          <input id="todo-date" type="date" className="input" value={day} onChange={(e) => setDay(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="todo-assignee">Assignee</label>
          <select id="todo-assignee" className="input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="todo-notes">Notes</label>
        <textarea id="todo-notes" className="input min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} placeholder="Optional details" />
      </div>

      {error && <p className="text-sm text-danger" role="alert">{error}</p>}

      <div className="flex items-center gap-2">
        {todo && (
          <button type="button" className="btn-ghost text-danger" disabled={busy} onClick={() => void run(() => remove({ todoId: todo._id }))}>
            <Trash2 className="size-4" /> Delete
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy || !title.trim()}>
            {todo ? "Save" : "Add todo"}
          </button>
        </div>
      </div>

      {todo && (
        <div className="border-t border-line pt-4">
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">History</h3>
          {history === undefined ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted">No changes yet.</p>
          ) : (
            <ul className="max-h-48 space-y-1.5 overflow-y-auto text-sm">
              {history.map((a) => (
                <li key={a._id} className="flex gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{nameOf(a.actorId)}</span> {describe(a, { withTitle: false })}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{formatDistanceToNow(a._creationTime, { addSuffix: true })}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
