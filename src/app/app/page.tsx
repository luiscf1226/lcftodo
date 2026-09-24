"use client";

import { useAuth, useOrganization } from "@clerk/nextjs";
import clsx from "clsx";
import { useQuery } from "convex/react";
import { ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import { Empty, PageHeader, Skeleton } from "@/components/PageHeader";
import { SetupChecklist } from "@/components/SetupChecklist";
import { TodayQuickAdd } from "@/components/TodayQuickAdd";
import { TodoDialog } from "@/components/TodoDialog";
import { TodoItem } from "@/components/TodoItem";
import { useMembers } from "@/components/useMembers";
import { useToday } from "@/components/useToday";
import { useRecurringTodos } from "@/components/useRecurringTodos";
import { fmt, shiftDays, weekDays, weekStart } from "@/lib/dates";
import { emptyStatusCounts, STATUS_META, STATUSES } from "@/lib/status";

type TeamTodo = Doc<"todos"> & { projectName: string; projectColor: string; projectArchived: boolean };

export default function TodayPage() {
  const { userId } = useAuth();
  const { organization } = useOrganization();
  const today = useToday();
  const start = weekStart(today);
  const days = useMemo(() => weekDays(start), [start]);
  const todos = useQuery(api.todos.listForTeam, { from: start, to: shiftDays(start, 6) });
  useRecurringTodos(start, shiftDays(start, 6));
  const projects = useQuery(api.projects.list, {});
  const access = useQuery(api.projectAccess.me, {});
  const { byId } = useMembers();
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const [editing, setEditing] = useState<TeamTodo | null>(null);
  const [creating, setCreating] = useState(false);
  const [lastProjectId, setLastProjectId] = useState<Id<"projects"> | "">(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("lcftodos:last-project") as Id<"projects"> | null ?? "";
  });
  const activeProjects = useMemo(() => (projects ?? []).filter((project) => !project.archived), [projects]);
  const newProjectId = activeProjects.some((project) => project._id === lastProjectId)
    ? lastProjectId
    : activeProjects[0]?._id ?? "";

  const selectProject = (projectId: Id<"projects">) => {
    setLastProjectId(projectId);
    window.localStorage.setItem("lcftodos:last-project", projectId);
  };

  const inScope = useMemo(
    () => (todos ?? []).filter((t) => scope === "team" || t.assigneeId === userId || (!t.assigneeId && t.createdBy === userId)),
    [todos, scope, userId],
  );
  const todayItems = inScope.filter((t) => t.date === today);
  const overdue = inScope.filter((t) => t.date < today && (t.status === "todo" || t.status === "doing"));

  const perDay = days.map((d) => {
    const list = inScope.filter((t) => t.date === d);
    return { day: d, total: list.length, done: list.filter((t) => t.status === "done").length };
  });
  const weekCounts = emptyStatusCounts();
  for (const t of inScope) weekCounts[t.status]++;

  const list = (items: TeamTodo[]) => (
    <div className="flex flex-col gap-1.5">
      {items.map((t) => (
        <TodoItem
          key={t._id}
          todo={t}
          project={{ name: t.projectName, color: t.projectColor }}
          assignee={t.assigneeId ? byId.get(t.assigneeId) : undefined}
          readOnly={t.projectArchived}
          onOpen={() => setEditing(t)}
        />
      ))}
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={fmt(today, "EEEE, MMMM d")}
        subtitle={organization ? `${organization.name} · this week at a glance` : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {activeProjects.length > 0 && (
              <button className="btn-primary" onClick={() => setCreating(true)}>
                <Plus className="size-4" /> New todo
              </button>
            )}
            <div className="flex rounded-lg border border-line bg-surface p-0.5 text-sm" role="tablist">
              {(["mine", "team"] as const).map((s) => (
                <button
                  key={s}
                  role="tab"
                  aria-selected={scope === s}
                  onClick={() => setScope(s)}
                  className={clsx("rounded-md px-3 py-1.5", scope === s ? "bg-surface-2 font-medium" : "text-muted")}
                >
                  {s === "mine" ? "My todos" : "Whole team"}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {organization && access?.isAdmin && <SetupChecklist orgId={organization.id} />}

      {newProjectId && (
        <TodayQuickAdd
          date={today}
          projects={activeProjects}
          projectId={newProjectId}
          onProjectIdChange={selectProject}
          onMore={() => setCreating(true)}
        />
      )}
      {projects && projects.length > 0 && activeProjects.length === 0 && (
        <p className="card mb-6 flex flex-wrap items-center justify-between gap-2 p-3 text-sm text-muted">
          All your projects are archived. Create or restore one to add todos.
          <Link href="/app/projects" className="btn-outline">Go to projects <ArrowRight className="size-4" /></Link>
        </p>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STATUSES.map((s) => (
          <div key={s} className="card p-3">
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <span className={clsx("size-2 rounded-full", STATUS_META[s].dot)} /> {STATUS_META[s].label}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{todos === undefined ? "–" : weekCounts[s]}</p>
          </div>
        ))}
      </div>

      <div className="mb-6 card p-4">
        <p className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">This week</p>
        <div className="grid grid-cols-7 gap-1.5">
          {perDay.map(({ day, total, done }) => (
            <div key={day} className="flex flex-col items-center gap-1.5">
              <div className="relative h-16 w-full max-w-10 overflow-hidden rounded-md bg-surface-2">
                <div className="absolute inset-x-0 bottom-0 bg-emerald-500/80" style={{ height: total ? `${(done / total) * 100}%` : 0 }} />
              </div>
              <span className={clsx("text-xs", day === today ? "font-semibold text-accent" : "text-muted")}>{fmt(day, "EEEEE")}</span>
              <span className="text-[11px] text-muted tabular-nums">{done}/{total}</span>
            </div>
          ))}
        </div>
      </div>

      {todos === undefined ? (
        <Skeleton className="h-40" />
      ) : projects && projects.length === 0 && access?.restricted && !access.isAdmin ? (
        <Empty
          title="No projects yet"
          body="You haven't been added to any projects on this team. Ask a team admin to give you access, or create your own project."
          action={<Link href="/app/projects" className="btn-outline">Go to projects <ArrowRight className="size-4" /></Link>}
        />
      ) : projects && projects.length === 0 ? (
        <Empty
          title="Welcome! Start with a project"
          body="Create a project, then add todos to each day of the week. Invite teammates from the Team page."
          action={<Link href="/app/projects" className="btn-primary">Go to projects <ArrowRight className="size-4" /></Link>}
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <section>
            <h2 className="mb-2 text-sm font-semibold">Today <span className="font-normal text-muted">({todayItems.length})</span></h2>
            {todayItems.length === 0 ? (
              <p className="card p-4 text-sm text-muted">Nothing planned for today. Type above and press Enter to add one.</p>
            ) : list(todayItems)}
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold">Still open from earlier this week <span className="font-normal text-muted">({overdue.length})</span></h2>
            {overdue.length === 0 ? (
              <p className="card p-4 text-sm text-muted">All caught up.</p>
            ) : list(overdue)}
          </section>
        </div>
      )}

      {editing && (
        <TodoDialog open onClose={() => setEditing(null)} projectId={editing.projectId} date={editing.date} todo={editing} readOnly={editing.projectArchived} />
      )}
      {creating && newProjectId && (
        <TodoDialog
          open
          onClose={() => setCreating(false)}
          projectId={newProjectId}
          date={today}
          projects={activeProjects}
          onProjectIdChange={selectProject}
        />
      )}
    </div>
  );
}
