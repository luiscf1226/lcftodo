"use client";

import clsx from "clsx";
import { useMutation, useQuery } from "convex/react";
import { isValid } from "date-fns";
import {
  ArchiveRestore,
  Archive,
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  Inbox,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { api } from "../../../../../convex/_generated/api";
import { Empty, Skeleton } from "@/components/PageHeader";
import { ProjectDialog } from "@/components/ProjectDialog";
import { TodoDialog } from "@/components/TodoDialog";
import { TodoItem } from "@/components/TodoItem";
import { Modal } from "@/components/Modal";
import { useMembers } from "@/components/useMembers";
import { showToast } from "@/components/ToastViewport";
import { AssigneeChip, MentionSuggestions, useAssigneeMention } from "@/components/AssigneeMention";
import { Menu, MenuItem } from "@/components/Menu";
import { useToday } from "@/components/useToday";
import { useRecurringTodos } from "@/components/useRecurringTodos";
import { fmt, fromKey, shiftDays, weekDays, weekLabel, weekStart } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { BoardDnd, DayList, SortableTodo } from "./BoardDnd";
import { emptyStatusCounts, LIMITS, STATUS_META, STATUSES } from "@/lib/status";

type Editing = { date: string; todo?: Doc<"todos"> } | null;

/**
 * A week calendar. With a `projectId` it is that project's board; without one it is the inbox: the
 * caller's personal todos that aren't in a project yet, which can be created, dragged between days
 * and moved into a project (from the todo dialog) just like project todos.
 */
export function WeekBoard({ projectId }: { projectId?: Id<"projects"> }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { userId } = useAuth();
  const today = useToday();
  const requestedWeek = search.get("week");
  const start = weekStart(requestedWeek && isValid(fromKey(requestedWeek)) ? requestedWeek : today);
  const days = useMemo(() => weekDays(start), [start]);

  const project = useQuery(api.projects.get, projectId ? { projectId } : "skip");
  const projectTodos = useQuery(
    api.todos.listForProject,
    projectId ? { projectId, from: days[0], to: days[6] } : "skip",
  );
  const personalTodos = useQuery(api.todos.listPersonal, projectId ? "skip" : { from: days[0], to: days[6] });
  const todos = projectId ? projectTodos : personalTodos;
  // Personal todos don't repeat: recurring series belong to a project.
  useRecurringTodos(days[0], days[6], projectId, projectId !== undefined);
  const { members, byId } = useMembers();
  const [filter, setFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Editing>(null);
  const [editingProject, setEditingProject] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const setWeek = (key: string) => {
    const params = new URLSearchParams(search);
    const ws = weekStart(key);
    if (ws === weekStart(today)) params.delete("week");
    else params.set("week", ws);
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  };

  const visible = useMemo(() => {
    const list = todos ?? [];
    if (filter === "all") return list;
    if (filter === "unassigned") return list.filter((t) => !t.assigneeId);
    return list.filter((t) => t.assigneeId === filter);
  }, [todos, filter]);

  const byDay = useMemo(() => {
    const map = new Map<string, Doc<"todos">[]>(days.map((d) => [d, []]));
    for (const t of visible) map.get(t.date)?.push(t);
    return map;
  }, [visible, days]);

  const counts = useMemo(() => {
    const c = emptyStatusCounts();
    for (const t of visible) c[t.status]++;
    return c;
  }, [visible]);

  // On phones, bring today's section into view when viewing the current week.
  const todayRef = useRef<HTMLElement>(null);
  const scrolled = useRef(false);
  useEffect(() => {
    if (todos && !scrolled.current && window.innerWidth < 1024) {
      scrolled.current = true;
      todayRef.current?.scrollIntoView({ block: "start" });
    }
  }, [todos]);

  if (project === null) {
    // We deleted it ourselves and are on our way back to the project list.
    if (deleting) return <Skeleton className="h-40" />;
    return (
      <Empty
        title="Proyecto no encontrado"
        body="Es posible que se haya eliminado, pertenezca a otro equipo o ya no tengas acceso."
        action={
          <Link href="/app/projects" className="btn-outline">
            Volver a proyectos
          </Link>
        }
      />
    );
  }

  const total = visible.length;
  // Archived projects are read-only (#18); wait for the project before enabling drag & drop.
  const readOnly = projectId !== undefined && (project === undefined || project.archived);

  return (
    <div className="mx-auto max-w-[110rem]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {projectId ? (
            <>
              <Link href="/app/projects" className="text-xs text-muted hover:text-fg">
                ← Proyectos
              </Link>
              {project === undefined ? (
                <Skeleton className="mt-1 h-8 w-48" />
              ) : (
                <h1 className="mt-0.5 flex items-center gap-2 text-2xl font-semibold tracking-tight">
                  <span className="size-3 shrink-0 rounded-full" style={{ background: project.color }} />
                  <span className="truncate">{project.name}</span>
                  {project.archived && (
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
                      Archivado
                    </span>
                  )}
                </h1>
              )}
              {project?.description && <p className="mt-1 max-w-2xl text-sm text-muted">{project.description}</p>}
            </>
          ) : (
            <>
              <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <Inbox className="size-6 shrink-0 text-muted" aria-hidden />
                <span className="truncate">Bandeja</span>
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted">
                Tareas sin proyecto: solo tú las ves. Añádelas a cualquier día, arrástralas por el calendario y muévelas
                a un proyecto cuando quieras (ábrela y elige el proyecto).
              </p>
            </>
          )}
        </div>
        {project && (
          <ProjectMenu
            project={project}
            onEdit={() => setEditingProject(true)}
            onDelete={() => setConfirmDelete(true)}
          />
        )}
      </div>

      {project?.archived && (
        <p
          className="mb-4 flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-muted"
          role="status"
        >
          <Archive className="size-4 shrink-0" /> Este proyecto está archivado. Sus tareas son de solo lectura.
          Restáuralo para hacer cambios.
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg border border-line bg-surface">
          <button
            className="btn-ghost rounded-r-none px-2"
            aria-label="Semana anterior"
            onClick={() => setWeek(shiftDays(start, -7))}
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-40 px-1 text-center text-sm font-medium tabular-nums">{weekLabel(start)}</span>
          <button
            className="btn-ghost rounded-l-none px-2"
            aria-label="Semana siguiente"
            onClick={() => setWeek(shiftDays(start, 7))}
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        {start !== weekStart(today) && (
          <button className="btn-outline" onClick={() => setWeek(today)}>
            Esta semana
          </button>
        )}
        <input
          type="date"
          aria-label="Ir a una fecha"
          className="input w-auto py-1.5"
          value={start}
          onChange={(e) => e.target.value && setWeek(e.target.value)}
        />
        {projectId && (
          <select
            aria-label="Filtrar por responsable"
            className="input w-auto py-1.5"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">Todos</option>
            {userId && <option value={userId}>Solo yo</option>}
            <option value="unassigned">Sin asignar</option>
            {members
              .filter((m) => m.id !== userId)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted sm:ml-auto">
          {STATUSES.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={clsx("size-2 rounded-full", STATUS_META[s].dot)} />
              {STATUS_META[s].label} <span className="font-medium text-fg tabular-nums">{counts[s]}</span>
            </span>
          ))}
          {total > 0 && (
            <span className="font-medium text-fg">{Math.round((counts.done / total) * 100)}% completado</span>
          )}
        </div>
      </div>

      <BoardDnd byDay={byDay} disabled={readOnly}>
        {(columns) => (
          <div className="grid gap-3 lg:grid-cols-7">
            {days.map((day) => {
              const items = columns.get(day) ?? [];
              const isToday = day === today;
              const open = items.filter((t) => t.status === "todo" || t.status === "doing").length;
              return (
                <section
                  key={day}
                  ref={isToday ? todayRef : undefined}
                  aria-label={fmt(day, "EEEE, MMMM d")}
                  className={clsx(
                    "flex scroll-mt-20 flex-col rounded-xl border bg-surface-2/60 p-2 lg:min-h-72",
                    isToday ? "border-accent/60" : "border-line",
                  )}
                >
                  <header className="mb-2 flex items-center gap-2 px-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className={clsx("text-sm font-semibold", isToday && "text-accent")}>{fmt(day, "EEE")}</span>
                      <span className="text-xs text-muted">{fmt(day, "MMM d")}</span>
                    </div>
                    {isToday && (
                      <span className="rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold text-accent-fg">
                        HOY
                      </span>
                    )}
                    <span className="ml-auto text-xs text-muted tabular-nums">
                      {items.filter((t) => t.status === "done").length}/{items.length}
                    </span>
                  </header>

                  {todos === undefined ? (
                    <Skeleton className="h-14" />
                  ) : (
                    <DayList day={day} items={items}>
                      {items.map((t) => (
                        <SortableTodo key={t._id} todo={t} day={day} columns={columns} readOnly={readOnly}>
                          <TodoItem
                            todo={t}
                            assignee={t.assigneeId ? byId.get(t.assigneeId) : undefined}
                            readOnly={project?.archived}
                            onOpen={() => setEditing({ date: day, todo: t })}
                          />
                        </SortableTodo>
                      ))}
                    </DayList>
                  )}

                  <div className="mt-1.5 flex items-center gap-1 lg:mt-auto lg:pt-1.5">
                    {!project?.archived && (
                      <QuickAdd projectId={projectId} date={day} onMore={() => setEditing({ date: day })} />
                    )}
                    {projectId && open > 0 && day <= today && !project?.archived && (
                      <CarryOver projectId={projectId} date={day} count={open} />
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </BoardDnd>

      <TodoDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        projectId={projectId}
        date={editing?.date ?? today}
        todo={editing?.todo}
        readOnly={project?.archived}
      />
      {project && <ProjectDialog open={editingProject} onClose={() => setEditingProject(false)} project={project} />}
      {project && (
        <DeleteProject
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onDeleting={setDeleting}
          project={project}
        />
      )}
    </div>
  );
}

function QuickAdd({ projectId, date, onMore }: { projectId?: Id<"projects">; date: string; onMore: () => void }) {
  const [adding, setAdding] = useState(false);
  if (!adding) {
    return (
      <button className="btn-ghost flex-1 justify-start px-2 py-1.5 text-muted" onClick={() => setAdding(true)}>
        <Plus className="size-4" /> Añadir
      </button>
    );
  }
  return <QuickAddForm projectId={projectId} date={date} onClose={() => setAdding(false)} onMore={onMore} />;
}

function QuickAddForm({
  projectId,
  date,
  onClose,
  onMore,
}: {
  projectId?: Id<"projects">;
  date: string;
  onClose: () => void;
  onMore: () => void;
}) {
  const create = useMutation(api.todos.create);
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const mention = useAssigneeMention(title, setTitle, inputRef, projectId);

  return (
    <form
      className="flex w-full flex-col gap-1.5"
      // Close once focus leaves the form with nothing typed.
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && !title.trim() && onClose()}
      onSubmit={async (e) => {
        e.preventDefault();
        const value = title.trim();
        if (!value || busy) return;
        setBusy(true);
        try {
          await create({ projectId, date, title: value, assigneeId: mention.assigneeId });
          setTitle("");
          mention.clearAssignee();
        } catch (error) {
          showToast(errorMessage(error, "No se pudo añadir la tarea."));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="relative">
        <input
          ref={inputRef}
          autoFocus
          className="input py-1.5"
          placeholder={projectId ? "Nueva tarea… @ para asignar" : "Nueva tarea sin proyecto…"}
          aria-label={`Nueva tarea para el ${fmt(date, "EEEE")}`}
          value={title}
          maxLength={LIMITS.todoTitle}
          enterKeyHint="done"
          {...mention.inputProps}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (mention.onKeyDown(e)) return;
            if (e.key === "Escape") onClose();
          }}
        />
        <MentionSuggestions mention={mention} />
      </div>
      <AssigneeChip mention={mention} className="self-start" />
      <div className="flex gap-1">
        <button type="submit" className="btn-primary flex-1 py-1 text-xs" disabled={busy || !title.trim()}>
          Añadir
        </button>
        <button
          type="button"
          className="btn-ghost py-1 text-xs"
          disabled={busy}
          onClick={() => {
            onClose();
            onMore();
          }}
        >
          Más…
        </button>
      </div>
    </form>
  );
}

function CarryOver({ projectId, date, count }: { projectId: Id<"projects">; date: string; count: number }) {
  const carry = useMutation(api.todos.carryOver);
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn-ghost px-2 py-1.5 text-xs text-muted"
      disabled={busy}
      title={`Pasar ${count} ${count === 1 ? "tarea pendiente" : "tareas pendientes"} al día siguiente y marcarlas como sin terminar`}
      onClick={async () => {
        setBusy(true);
        try {
          await carry({ projectId, date });
        } catch (error) {
          showToast(errorMessage(error, "No se pudieron pasar las tareas pendientes."));
        } finally {
          setBusy(false);
        }
      }}
    >
      <CornerDownRight className="size-3.5" /> Pasar {count}
    </button>
  );
}

function ProjectMenu({
  project,
  onEdit,
  onDelete,
}: {
  project: Doc<"projects">;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { has } = useAuth();
  const setArchived = useMutation(api.projects.setArchived);
  const isAdmin = has?.({ role: "org:admin" }) ?? false;

  const archive = async () => {
    try {
      await setArchived({ projectId: project._id, archived: !project.archived });
    } catch (error) {
      showToast(errorMessage(error, `No se pudo ${project.archived ? "restaurar" : "archivar"} el proyecto.`));
    }
  };

  return (
    <Menu
      label={<MoreHorizontal className="size-4" />}
      aria-label="Opciones del proyecto"
      triggerClassName="btn-outline px-2"
      menuClassName="w-44"
    >
      <MenuItem onSelect={onEdit}>
        <Pencil className="size-4" /> Editar
      </MenuItem>
      {isAdmin && (
        <>
          <MenuItem onSelect={() => void archive()}>
            {project.archived ? (
              <>
                <ArchiveRestore className="size-4" /> Restaurar
              </>
            ) : (
              <>
                <Archive className="size-4" /> Archivar
              </>
            )}
          </MenuItem>
          <MenuItem className="text-danger" onSelect={onDelete}>
            <Trash2 className="size-4" /> Eliminar
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

function DeleteProject({
  open,
  onClose,
  onDeleting,
  project,
}: {
  open: boolean;
  onClose: () => void;
  onDeleting: (deleting: boolean) => void;
  project: Doc<"projects">;
}) {
  const router = useRouter();
  const remove = useMutation(api.projects.remove);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setError(null);
    onClose();
  };
  return (
    <Modal open={open} onClose={close} title="¿Eliminar proyecto?">
      <p className="text-sm text-muted">
        Esto elimina permanentemente <span className="font-medium text-fg">{project.name}</span> y todas sus tareas. El
        historial de actividad se conserva. También puedes archivarlo.
      </p>
      {/* Shown inside the dialog: a toast would sit behind the modal backdrop. */}
      {error && (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-outline" onClick={close}>
          Cancelar
        </button>
        <button
          className="btn-danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              // Only leave the page once the server has accepted the delete.
              onDeleting(true);
              await remove({ projectId: project._id });
              router.replace("/app/projects");
            } catch (caught) {
              setError(errorMessage(caught, "No se pudo eliminar el proyecto."));
              onDeleting(false);
              setBusy(false);
            }
          }}
        >
          {busy ? "Eliminando…" : "Eliminar proyecto"}
        </button>
      </div>
    </Modal>
  );
}
