"use client";

import clsx from "clsx";
import { useMutation, useQuery } from "convex/react";
import { isValid } from "date-fns";
import { ArchiveRestore, Archive, ChevronLeft, ChevronRight, CornerDownRight, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
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
import { emptyStatusCounts, LIMITS, STATUS_META, STATUSES } from "@/lib/status";

type Editing = { date: string; todo?: Doc<"todos"> } | null;

export function WeekBoard({ projectId }: { projectId: Id<"projects"> }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { userId } = useAuth();
  const today = useToday();
  const requestedWeek = search.get("week");
  const start = weekStart(requestedWeek && isValid(fromKey(requestedWeek)) ? requestedWeek : today);
  const days = useMemo(() => weekDays(start), [start]);

  const project = useQuery(api.projects.get, { projectId });
  const todos = useQuery(api.todos.listForProject, { projectId, from: days[0], to: days[6] });
  useRecurringTodos(days[0], days[6], projectId);
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
      <Empty title="Project not found" body="It may have been deleted, or it belongs to another team." action={<Link href="/app/projects" className="btn-outline">Back to projects</Link>} />
    );
  }

  const total = visible.length;

  return (
    <div className="mx-auto max-w-[110rem]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/app/projects" className="text-xs text-muted hover:text-fg">← Projects</Link>
          {project === undefined ? (
            <Skeleton className="mt-1 h-8 w-48" />
          ) : (
            <h1 className="mt-0.5 flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <span className="size-3 shrink-0 rounded-full" style={{ background: project.color }} />
              <span className="truncate">{project.name}</span>
              {project.archived && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">Archived</span>}
            </h1>
          )}
          {project?.description && <p className="mt-1 max-w-2xl text-sm text-muted">{project.description}</p>}
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
        <p className="mb-4 flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-muted" role="status">
          <Archive className="size-4 shrink-0" /> This project is archived. Its todos are read-only; restore the project to make changes.
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg border border-line bg-surface">
          <button className="btn-ghost rounded-r-none px-2" aria-label="Previous week" onClick={() => setWeek(shiftDays(start, -7))}>
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-40 px-1 text-center text-sm font-medium tabular-nums">{weekLabel(start)}</span>
          <button className="btn-ghost rounded-l-none px-2" aria-label="Next week" onClick={() => setWeek(shiftDays(start, 7))}>
            <ChevronRight className="size-4" />
          </button>
        </div>
        {start !== weekStart(today) && (
          <button className="btn-outline" onClick={() => setWeek(today)}>This week</button>
        )}
        <input
          type="date"
          aria-label="Jump to date"
          className="input w-auto py-1.5"
          value={start}
          onChange={(e) => e.target.value && setWeek(e.target.value)}
        />
        <select aria-label="Filter by assignee" className="input w-auto py-1.5" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Everyone</option>
          {userId && <option value={userId}>Only me</option>}
          <option value="unassigned">Unassigned</option>
          {members.filter((m) => m.id !== userId).map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted sm:ml-auto">
          {STATUSES.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={clsx("size-2 rounded-full", STATUS_META[s].dot)} />
              {STATUS_META[s].label} <span className="font-medium text-fg tabular-nums">{counts[s]}</span>
            </span>
          ))}
          {total > 0 && <span className="font-medium text-fg">{Math.round((counts.done / total) * 100)}% done</span>}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-7">
        {days.map((day) => {
          const items = byDay.get(day) ?? [];
          const isToday = day === today;
          const open = items.filter((t) => t.status === "todo" || t.status === "doing").length;
          return (
            <section
              key={day}
              ref={isToday ? todayRef : undefined}
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
                {isToday && <span className="rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold text-accent-fg">TODAY</span>}
                <span className="ml-auto text-xs text-muted tabular-nums">
                  {items.filter((t) => t.status === "done").length}/{items.length}
                </span>
              </header>

              {todos === undefined ? (
                <Skeleton className="h-14" />
              ) : (
                <div className="flex flex-col gap-1.5">
                  {items.map((t) => (
                    <TodoItem key={t._id} todo={t} assignee={t.assigneeId ? byId.get(t.assigneeId) : undefined} readOnly={project?.archived} onOpen={() => setEditing({ date: day, todo: t })} />
                  ))}
                </div>
              )}

              <div className="mt-1.5 flex items-center gap-1 lg:mt-auto lg:pt-1.5">
                {!project?.archived && (
                  <QuickAdd projectId={projectId} date={day} onMore={() => setEditing({ date: day })} />
                )}
                {open > 0 && day <= today && !project?.archived && (
                  <CarryOver projectId={projectId} date={day} count={open} />
                )}
              </div>
            </section>
          );
        })}
      </div>

      <TodoDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        projectId={projectId}
        date={editing?.date ?? today}
        todo={editing?.todo}
        readOnly={project?.archived}
      />
      {project && <ProjectDialog open={editingProject} onClose={() => setEditingProject(false)} project={project} />}
      {project && <DeleteProject open={confirmDelete} onClose={() => setConfirmDelete(false)} onDeleting={setDeleting} project={project} />}
    </div>
  );
}

function QuickAdd({ projectId, date, onMore }: { projectId: Id<"projects">; date: string; onMore: () => void }) {
  const [adding, setAdding] = useState(false);
  if (!adding) {
    return (
      <button className="btn-ghost flex-1 justify-start px-2 py-1.5 text-muted" onClick={() => setAdding(true)}>
        <Plus className="size-4" /> Add
      </button>
    );
  }
  return <QuickAddForm projectId={projectId} date={date} onClose={() => setAdding(false)} onMore={onMore} />;
}

function QuickAddForm({ projectId, date, onClose, onMore }: { projectId: Id<"projects">; date: string; onClose: () => void; onMore: () => void }) {
  const create = useMutation(api.todos.create);
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const mention = useAssigneeMention(title, setTitle, inputRef);

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
          showToast(errorMessage(error, "Couldn't add the todo."));
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
          placeholder="New todo… @ to assign"
          aria-label={`New todo for ${fmt(date, "EEEE")}`}
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
        <button type="submit" className="btn-primary flex-1 py-1 text-xs" disabled={busy || !title.trim()}>Add</button>
        <button type="button" className="btn-ghost py-1 text-xs" disabled={busy} onClick={() => { onClose(); onMore(); }}>
          More…
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
      title={`Move ${count} unfinished todo${count === 1 ? "" : "s"} to the next day and mark these as didn't finish`}
      onClick={async () => {
        setBusy(true);
        try {
          await carry({ projectId, date });
        } catch (error) {
          showToast(errorMessage(error, "Couldn't carry unfinished todos."));
        } finally {
          setBusy(false);
        }
      }}
    >
      <CornerDownRight className="size-3.5" /> Carry {count}
    </button>
  );
}

function ProjectMenu({ project, onEdit, onDelete }: { project: Doc<"projects">; onEdit: () => void; onDelete: () => void }) {
  const { has } = useAuth();
  const setArchived = useMutation(api.projects.setArchived);
  const isAdmin = has?.({ role: "org:admin" }) ?? false;

  const archive = async () => {
    try {
      await setArchived({ projectId: project._id, archived: !project.archived });
    } catch (error) {
      showToast(errorMessage(error, `Couldn't ${project.archived ? "restore" : "archive"} the project.`));
    }
  };

  return (
    <Menu label={<MoreHorizontal className="size-4" />} aria-label="Project options" triggerClassName="btn-outline px-2" menuClassName="w-44">
      <MenuItem onSelect={onEdit}>
        <Pencil className="size-4" /> Edit
      </MenuItem>
      {isAdmin && (
        <>
          <MenuItem onSelect={() => void archive()}>
            {project.archived ? <><ArchiveRestore className="size-4" /> Restore</> : <><Archive className="size-4" /> Archive</>}
          </MenuItem>
          <MenuItem className="text-danger" onSelect={onDelete}>
            <Trash2 className="size-4" /> Delete
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
    <Modal open={open} onClose={close} title="Delete project?">
      <p className="text-sm text-muted">
        This permanently deletes <span className="font-medium text-fg">{project.name}</span> and all its todos. The activity history is kept. Consider archiving instead.
      </p>
      {/* Shown inside the dialog: a toast would sit behind the modal backdrop. */}
      {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-outline" onClick={close}>Cancel</button>
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
              setError(errorMessage(caught, "Couldn't delete the project."));
              onDeleting(false);
              setBusy(false);
            }
          }}
        >
          {busy ? "Deleting…" : "Delete project"}
        </button>
      </div>
    </Modal>
  );
}
