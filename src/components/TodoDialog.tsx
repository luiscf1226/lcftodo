"use client";

import { useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Archive, CornerDownRight, Repeat, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import type { RecurrenceRule } from "../../convex/lib/constants";
import { WEEKDAY_ORDER } from "../../convex/lib/recurrence";
import { describe } from "@/lib/activity";
import { fmt, shiftDays, weekStart } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { LIMITS } from "@/lib/status";
import { CommentThread } from "./CommentThread";
import { Modal } from "./Modal";
import { RepeatPicker } from "./RepeatPicker";
import { useAssignableMembers } from "./useMembers";
import { useToday } from "./useToday";

type Props = {
  open: boolean;
  onClose: () => void;
  projectId: Id<"projects">;
  date: string;
  todo?: Doc<"todos">;
  projects?: Array<{ _id: Id<"projects">; name: string; archived: boolean }>;
  onProjectIdChange?: (projectId: Id<"projects">) => void;
  // The todo belongs to an archived project: show it, but allow no changes (#18).
  readOnly?: boolean;
};

const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
function describeRule(rule: RecurrenceRule) {
  if (rule.kind === "daily") return "Todos los días";
  if (rule.kind === "weekdays") return "Días laborables";
  return `Cada semana los ${WEEKDAY_ORDER.filter((day) => rule.weekdays?.includes(day))
    .map((day) => WEEKDAYS[day])
    .join(", ")}`;
}

export function TodoDialog(props: Props) {
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={props.todo ? (props.readOnly ? "Tarea" : "Editar tarea") : "Nueva tarea"}
    >
      <TodoForm key={props.todo?._id ?? props.date} {...props} />
    </Modal>
  );
}

function TodoForm({ onClose, projectId, date, todo, projects, onProjectIdChange, readOnly = false }: Props) {
  const create = useMutation(api.todos.create);
  const update = useMutation(api.todos.update);
  const remove = useMutation(api.todos.remove);
  const createSeries = useMutation(api.recurrences.create);
  const updateSeries = useMutation(api.recurrences.update);
  const stopSeries = useMutation(api.recurrences.stop);
  const history = useQuery(api.activity.forTodo, todo ? { todoId: todo._id } : "skip");
  const carriedFrom = useQuery(api.todos.get, todo?.carriedFrom ? { todoId: todo.carriedFrom } : "skip");
  const series = useQuery(api.recurrences.get, todo?.recurrenceId ? { recurrenceId: todo.recurrenceId } : "skip");
  const activeSeries = series && !series.stoppedFrom ? series : null;
  const today = useToday();

  const [title, setTitle] = useState(todo?.title ?? "");
  const [notes, setNotes] = useState(todo?.notes ?? "");
  const [day, setDay] = useState(todo?.date ?? date);
  const [assigneeId, setAssigneeId] = useState(todo?.assigneeId ?? "");
  const [selectedProjectId, setSelectedProjectId] = useState(projectId);
  // Only people with access to the project can be picked (#46).
  const { members, nameOf } = useAssignableMembers(todo?.projectId ?? selectedProjectId);
  // A historical assignee who has since lost access stays visible, but can't be re-picked.
  const formerAssignee =
    todo?.assigneeId && !members.some((m) => m.id === todo.assigneeId) ? todo.assigneeId : undefined;
  // New todos: an optional repeat rule. Occurrences: edit "this" todo or the whole series (#23).
  const [repeat, setRepeat] = useState<RecurrenceRule | null>(null);
  const [scope, setScope] = useState<"this" | "series">("this");
  const [seriesRule, setSeriesRule] = useState<RecurrenceRule | null>(null);
  const editingSeries = scope === "series" && activeSeries !== null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy || readOnly) return;
    const fields = { title, notes, date: day, assigneeId: assigneeId || undefined };
    if (editingSeries) {
      const rule = seriesRule ?? activeSeries.rule;
      // Series edits apply to this and later occurrences, never to past days.
      const from = [today, todo?.recurrenceDate ?? day].sort()[1];
      void run(() =>
        updateSeries({ recurrenceId: activeSeries._id, from, title, notes, assigneeId: fields.assigneeId, rule }),
      );
    } else if (todo) {
      void run(() => update({ todoId: todo._id, ...fields }));
    } else if (repeat) {
      const { date, ...rest } = fields;
      void run(() => createSeries({ projectId: selectedProjectId, startDate: date, rule: repeat, ...rest }));
    } else {
      void run(() => create({ projectId: selectedProjectId, ...fields }));
    }
  }

  const invalidRule = (rule: RecurrenceRule | null) => rule?.kind === "weekly" && !rule.weekdays?.length;
  const ruleInvalid = editingSeries ? invalidRule(seriesRule) : !todo && invalidRule(repeat);

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-4">
        {readOnly && (
          <p
            className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-muted"
            role="status"
          >
            <Archive className="size-4 shrink-0" /> Este proyecto está archivado. La tarea es de solo lectura.
          </p>
        )}
        {todo?.carriedFrom && (
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <CornerDownRight className="size-4 shrink-0" />
            {carriedFrom ? (
              <>
                Pasada desde{" "}
                <Link
                  href={`/app/projects/${carriedFrom.projectId}?week=${weekStart(carriedFrom.date)}`}
                  className="font-medium text-fg underline underline-offset-2 hover:text-accent"
                  onNavigate={onClose}
                >
                  {fmt(carriedFrom.date, "EEE, MMM d")}
                </Link>
              </>
            ) : (
              "Pasada desde un día anterior"
            )}
          </p>
        )}
        {todo?.recurrenceId && series !== undefined && (
          <div className="space-y-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
            <p className="flex items-center gap-2 text-muted">
              <Repeat className="size-4 shrink-0" />
              {series === null
                ? "Forma parte de una serie recurrente que ya no existe."
                : series.stoppedFrom
                  ? `Se repetía: ${describeRule(series.rule)} (detenida)`
                  : `Se repite: ${describeRule(series.rule)}`}
            </p>
            {activeSeries && !readOnly && (
              <div
                className="flex flex-wrap items-center gap-x-4 gap-y-1"
                role="radiogroup"
                aria-label="Aplicar cambios a"
              >
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" name="scope" checked={scope === "this"} onChange={() => setScope("this")} /> Solo
                  esta tarea
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" name="scope" checked={scope === "series"} onChange={() => setScope("series")} />{" "}
                  Esta y las tareas futuras
                </label>
              </div>
            )}
          </div>
        )}
        <fieldset disabled={readOnly} className="space-y-4">
          <div>
            <label className="label" htmlFor="todo-title">
              Título
            </label>
            <input
              id="todo-title"
              autoFocus
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="¿Qué hay que hacer?"
              maxLength={LIMITS.todoTitle}
              required
            />
          </div>
          {!todo && projects && (
            <div>
              <label className="label" htmlFor="todo-project">
                Proyecto
              </label>
              <select
                id="todo-project"
                className="input"
                value={selectedProjectId}
                onChange={(e) => {
                  const nextProjectId = e.target.value as Id<"projects">;
                  setSelectedProjectId(nextProjectId);
                  onProjectIdChange?.(nextProjectId);
                }}
              >
                {projects
                  .filter((project) => !project.archived)
                  .map((project) => (
                    <option key={project._id} value={project._id}>
                      {project.name}
                    </option>
                  ))}
              </select>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="todo-date">
                {!todo && repeat ? "Empieza" : "Día"}
              </label>
              <input
                id="todo-date"
                type="date"
                className="input"
                value={day}
                onChange={(e) => setDay(e.target.value)}
                required
                disabled={editingSeries}
                title={editingSeries ? "Para cambiar el día, elige «Solo esta tarea»" : undefined}
              />
            </div>
            <div>
              <label className="label" htmlFor="todo-assignee">
                Responsable
              </label>
              <select
                id="todo-assignee"
                className="input"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
              >
                <option value="">Sin asignar</option>
                {formerAssignee && (
                  <option value={formerAssignee}>{nameOf(formerAssignee)} (sin acceso al proyecto)</option>
                )}
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="todo-notes">
              Notas
            </label>
            <textarea
              id="todo-notes"
              className="min-h-20 input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={LIMITS.todoNotes}
              placeholder="Detalles opcionales"
            />
          </div>
          {(!todo || editingSeries) && (
            <div>
              <label className="label" htmlFor="todo-repeat">
                Repetir
              </label>
              {editingSeries ? (
                <RepeatPicker
                  id="todo-repeat"
                  day={day}
                  value={seriesRule ?? activeSeries.rule}
                  onChange={(rule) => rule && setSeriesRule(rule)}
                />
              ) : (
                <RepeatPicker id="todo-repeat" day={day} value={repeat} onChange={setRepeat} />
              )}
            </div>
          )}
        </fieldset>

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        {readOnly ? (
          <div className="flex justify-end">
            <button type="button" className="btn-outline" onClick={onClose}>
              Cerrar
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {todo && (
              <button
                type="button"
                className="btn-ghost text-danger"
                disabled={busy}
                onClick={() => void run(() => remove({ todoId: todo._id }))}
              >
                <Trash2 className="size-4" /> Eliminar
              </button>
            )}
            {activeSeries && (
              <button
                type="button"
                className="btn-ghost text-muted"
                disabled={busy}
                title="Conservar las tareas de hoy y anteriores; quitar las futuras que no hayan empezado"
                // Stops after today: from tomorrow on nothing is generated.
                onClick={() =>
                  void run(() => stopSeries({ recurrenceId: activeSeries._id, from: shiftDays(today, 1) }))
                }
              >
                <Repeat className="size-4" /> Detener repetición
              </button>
            )}
            <div className="ml-auto flex gap-2">
              <button type="button" className="btn-outline" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={busy || !title.trim() || ruleInvalid}>
                {todo ? (editingSeries ? "Guardar serie" : "Guardar") : "Añadir tarea"}
              </button>
            </div>
          </div>
        )}
      </form>

      {todo && <CommentThread todoId={todo._id} readOnly={readOnly} />}

      {todo && (
        <div className="border-t border-line pt-4">
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Historial</h3>
          {history === undefined ? (
            <p className="text-sm text-muted">Cargando…</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted">Todavía no hay cambios.</p>
          ) : (
            <ul className="max-h-48 space-y-1.5 overflow-y-auto text-sm">
              {history.map((a) => (
                <li key={a._id} className="flex gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{nameOf(a.actorId)}</span> {describe(a, { withTitle: false })}
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {formatDistanceToNow(a._creationTime, { addSuffix: true, locale: es })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
