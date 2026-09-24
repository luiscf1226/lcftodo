"use client";

import clsx from "clsx";
import { useMutation, useQuery } from "convex/react";
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
import { fmt, shiftDays, todayKey, weekDays, weekLabel, weekStart } from "@/lib/dates";
import { STATUS_META, STATUSES } from "@/lib/status";

type Editing = { date: string; todo?: Doc<"todos"> } | null;

export function WeekBoard({ projectId }: { projectId: Id<"projects"> }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { userId } = useAuth();
  const today = todayKey();
  const start = weekStart(search.get("week") ?? today);
  const days = weekDays(start);

  const project = useQuery(api.projects.get, { projectId });
  const todos = useQuery(api.todos.listForProject, { projectId, from: days[0], to: days[6] });
  const { members, byId } = useMembers();
  const [filter, setFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Editing>(null);
  const [editingProject, setEditingProject] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    const c = { todo: 0, doing: 0, done: 0, not_done: 0 };
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
                    <TodoItem key={t._id} todo={t} assignee={t.assigneeId ? byId.get(t.assigneeId) : undefined} onOpen={() => setEditing({ date: day, todo: t })} />
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
      />
      {project && <ProjectDialog open={editingProject} onClose={() => setEditingProject(false)} project={project} />}
      {project && <DeleteProject open={confirmDelete} onClose={() => setConfirmDelete(false)} project={project} />}
    </div>
  );
}

function QuickAdd({ projectId, date, onMore }: { projectId: Id<"projects">; date: string; onMore: () => void }) {
  const create = useMutation(api.todos.create);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  if (!adding) {
    return (
      <button className="btn-ghost flex-1 justify-start px-2 py-1.5 text-muted" onClick={() => setAdding(true)}>
        <Plus className="size-4" /> Add
      </button>
    );
  }

  return (
    <form
      className="flex w-full flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        const value = title.trim();
        if (!value) return;
        setTitle("");
        void create({ projectId, date, title: value });
      }}
    >
      <input
        autoFocus
        className="input py-1.5"
        placeholder="New todo… (Enter)"
        value={title}
        maxLength={300}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
        onBlur={() => !title.trim() && setAdding(false)}
      />
      <div className="flex gap-1">
        <button type="submit" className="btn-primary flex-1 py-1 text-xs" disabled={!title.trim()}>Add</button>
        <button type="button" className="btn-ghost py-1 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => { setAdding(false); onMore(); }}>
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
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => ref.current?.removeAttribute("open");

  return (
    <details ref={ref} className="relative">
      <summary className="btn-outline list-none px-2" aria-label="Project options">
        <MoreHorizontal className="size-4" />
      </summary>
      <div className="absolute right-0 z-10 mt-1 w-44 rounded-xl border border-line bg-surface p-1 shadow-lg">
        <button className="btn-ghost w-full justify-start" onClick={() => { close(); onEdit(); }}>
          <Pencil className="size-4" /> Edit
        </button>
        <button className="btn-ghost w-full justify-start" onClick={() => { close(); void setArchived({ projectId: project._id, archived: !project.archived }); }}>
          {project.archived ? <><ArchiveRestore className="size-4" /> Restore</> : <><Archive className="size-4" /> Archive</>}
        </button>
        {isAdmin && (
          <button className="btn-ghost w-full justify-start text-danger" onClick={() => { close(); onDelete(); }}>
            <Trash2 className="size-4" /> Delete
          </button>
        )}
      </div>
    </details>
  );
}

function DeleteProject({ open, onClose, project }: { open: boolean; onClose: () => void; project: Doc<"projects"> }) {
  const router = useRouter();
  const remove = useMutation(api.projects.remove);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="Delete project?">
      <p className="text-sm text-muted">
        This permanently deletes <span className="font-medium text-fg">{project.name}</span> and all its todos. The activity history is kept. Consider archiving instead.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Cancel</button>
        <button
          className="btn-danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              router.replace("/app/projects");
              await remove({ projectId: project._id });
            } finally {
              setBusy(false);
            }
          }}
        >
          Delete project
        </button>
      </div>
    </Modal>
  );
}
