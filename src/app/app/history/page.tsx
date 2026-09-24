"use client";

import clsx from "clsx";
import { useConvex, usePaginatedQuery, useQuery } from "convex/react";
import { differenceInCalendarDays, format, formatDistanceToNow, isValid } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronDown, Download } from "lucide-react";
import { useMemo, useState } from "react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import { MAX_EXPORT_PAGE_SIZE, MAX_RANGE_DAYS } from "../../../../convex/lib/constants";
import { Avatar } from "@/components/Avatar";
import { Empty, PageHeader, Skeleton } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusSelect";
import { Menu, MenuItem } from "@/components/Menu";
import { useMembers } from "@/components/useMembers";
import { useTeamTimeZone } from "@/components/useTeamTimeZone";
import { useToday } from "@/components/useToday";
import { describe } from "@/lib/activity";
import { download, toCsv } from "@/lib/csv";
import { browserTimeZone, dayStartMs, fmt, fromKey, shiftDays } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { collectPages } from "@/lib/export";
import { completion, peopleStats, type PersonStats } from "@/lib/peopleStats";
import { emptyStatusCounts, STATUS_META, STATUSES } from "@/lib/status";
import { downloadXlsx } from "@/lib/xlsx";

export default function HistoryPage() {
  // Default range follows the team's "today" (#21) until the user picks dates.
  const today = useToday();
  const timeZone = useTeamTimeZone();
  const [picked, setPicked] = useState<{ from?: string; to?: string }>({});
  const from = picked.from ?? shiftDays(today, -29);
  const to = picked.to ?? today;
  const setFrom = (value: string) => setPicked((p) => ({ ...p, from: value }));
  const setTo = (value: string) => setPicked((p) => ({ ...p, to: value }));
  const [projectId, setProjectId] = useState<Id<"projects"> | "">("");
  const [memberId, setMemberId] = useState("");
  const [tab, setTab] = useState<"days" | "people" | "activity">("days");
  const validDates = Boolean(from && to) && isValid(fromKey(from)) && isValid(fromKey(to));
  const validRange = validDates && from <= to;
  const rangeDays = validRange ? differenceInCalendarDays(fromKey(to), fromKey(from)) + 1 : 0;
  const rangeTooLarge = rangeDays > MAX_RANGE_DAYS;
  const canViewRange = validRange && !rangeTooLarge;
  const memberFilterLabel = tab === "activity" ? "Modificado por" : "Asignado a";

  const projects = useQuery(api.projects.list, { includeArchived: true });
  // Activity keeps the names of projects that have since been deleted. List those projects too,
  // so their history stays reachable from the filter.
  const rangeActivity = useQuery(
    api.activity.exportPage,
    canViewRange
      ? {
          fromMs: dayStartMs(from, timeZone),
          toMs: dayStartMs(shiftDays(to, 1), timeZone) - 1,
          paginationOpts: { numItems: 1000, cursor: null },
        }
      : "skip",
  );
  const deletedProjects = useMemo(() => {
    if (!projects) return [];
    const known = new Set<string>(projects.map((p) => p._id));
    const names = new Map<Id<"projects">, string>();
    // Newest first, so the first name seen is the project's last name.
    for (const a of rangeActivity?.page ?? []) {
      if (!known.has(a.projectId) && !names.has(a.projectId)) names.set(a.projectId, a.projectName);
    }
    // Keep the current choice listed even if a new date range no longer mentions it.
    if (projectId && !known.has(projectId) && !names.has(projectId)) names.set(projectId, "Proyecto eliminado");
    return [...names].map(([_id, name]) => ({ _id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [projects, rangeActivity, projectId]);
  const projectDeleted = deletedProjects.some((p) => p._id === projectId);
  const todos = useQuery(api.todos.listForTeam, canViewRange ? { from, to } : "skip");
  const filtered = useMemo(
    () =>
      (todos ?? []).filter(
        (t) => (!projectId || t.projectId === projectId) && (!memberId || t.assigneeId === memberId),
      ),
    [todos, projectId, memberId],
  );
  const { members, byId, nameOf } = useMembers(
    useMemo(() => (todos ?? []).flatMap((t) => [t.assigneeId, t.createdBy]).filter((x): x is string => !!x), [todos]),
  );
  // Per-person totals for the People tab and exports; an "Assigned to" filter narrows it to that person.
  const people = useMemo(() => {
    const rows = peopleStats(filtered, members, nameOf);
    return memberId ? rows.filter((p) => p.id === memberId) : rows;
  }, [filtered, members, nameOf, memberId]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Historial"
        subtitle="Todo lo que tu equipo planificó, terminó y dejó pendiente."
        actions={
          <ExportMenu
            disabled={!canViewRange}
            from={from}
            to={to}
            projectId={projectId || undefined}
            projectDeleted={projectDeleted}
            memberId={memberId}
            todos={filtered}
            people={people}
            nameOf={nameOf}
          />
        }
      />

      <div className="mb-5 grid gap-3 card p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor="h-from">
            Desde
          </label>
          <input
            id="h-from"
            type="date"
            className="input"
            value={from}
            max={to}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="h-to">
            Hasta
          </label>
          <input
            id="h-to"
            type="date"
            className="input"
            value={to}
            min={from}
            onChange={(e) => e.target.value && setTo(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="h-project">
            Proyecto
          </label>
          <select
            id="h-project"
            className="input"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value as Id<"projects"> | "")}
          >
            <option value="">Todos los proyectos</option>
            {projects?.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
                {p.archived ? " (archivado)" : ""}
              </option>
            ))}
            {deletedProjects.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name} (eliminado)
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="h-member">
            {memberFilterLabel}
          </label>
          <select id="h-member" className="input" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">Todos</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!validDates ? (
        <p className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
          Selecciona fechas de inicio y fin válidas para ver o exportar el historial.
        </p>
      ) : (
        !validRange && (
          <p
            className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
            role="alert"
          >
            La fecha de inicio debe ser anterior o igual a la fecha de fin. Corrige las fechas para ver o exportar el
            historial.
          </p>
        )
      )}
      {rangeTooLarge && (
        <p className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
          El historial admite hasta {MAX_RANGE_DAYS} días por consulta (este rango tiene {rangeDays}). Selecciona un
          período más corto para verlo o exportarlo.
        </p>
      )}

      <div className="mb-4 flex gap-1 border-b border-line" role="tablist">
        {(["days", "people", "activity"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={clsx(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              tab === t ? "border-accent font-medium" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {t === "days" ? "Día a día" : t === "people" ? "Personas" : "Actividad"}
          </button>
        ))}
      </div>

      {!canViewRange ? null : tab === "days" ? (
        todos === undefined ? (
          <Skeleton className="h-60" />
        ) : (
          <DaySummary todos={filtered} byId={byId} />
        )
      ) : tab === "people" ? (
        todos === undefined ? (
          <Skeleton className="h-60" />
        ) : (
          <PeopleSummary people={people} />
        )
      ) : (
        <ActivityLog
          projectId={projectId || undefined}
          projectDeleted={projectDeleted}
          actorId={memberId || undefined}
          byId={byId}
          nameOf={nameOf}
        />
      )}
    </div>
  );
}

type TeamTodos = NonNullable<ReturnType<typeof useQuery<typeof api.todos.listForTeam>>>;
type Members = ReturnType<typeof useMembers>;

// Fixed export columns, so empty sheets/CSVs still carry their headers.
const TODO_HEADERS = [
  "date",
  "project",
  "title",
  "status",
  "assignee",
  "created_by",
  "notes",
  "completed_at",
  "carried_over",
];
const ACTIVITY_HEADERS = ["time", "person", "project", "action", "todo", "from", "to", "day", "description"];
const PEOPLE_HEADERS = ["person", "assigned", "done", "didnt_finish", "open", "completion_percent"];

function DaySummary({ todos, byId }: { todos: TeamTodos; byId: Members["byId"] }) {
  const [open, setOpen] = useState<string | null>(null);
  const days = useMemo(() => {
    const map = new Map<string, TeamTodos>();
    for (const t of todos) map.set(t.date, [...(map.get(t.date) ?? []), t]);
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [todos]);

  const totals = emptyStatusCounts();
  for (const t of todos) totals[t.status]++;

  if (days.length === 0)
    return <Empty title="No hay tareas en este período" body="Prueba un período más amplio u otros filtros." />;

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        <span>
          <span className="font-semibold text-fg">{todos.length}</span> tareas
        </span>
        {STATUSES.map((s) => (
          <span key={s}>
            <span className="font-semibold text-fg">{totals[s]}</span> {STATUS_META[s].label.toLowerCase()}
          </span>
        ))}
        <span>
          <span className="font-semibold text-fg">{Math.round((totals.done / todos.length) * 100)}%</span> completado
        </span>
      </div>
      <ul className="divide-y divide-line card">
        {days.map(([day, items]) => {
          const c = emptyStatusCounts();
          for (const t of items) c[t.status]++;
          const expanded = open === day;
          return (
            <li key={day}>
              <button
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : day)}
              >
                <span className="w-28 shrink-0 text-sm font-medium sm:w-36">{fmt(day, "EEE, MMM d")}</span>
                <span className="flex h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
                  {STATUSES.map((s) =>
                    c[s] ? (
                      <span
                        key={s}
                        className={STATUS_META[s].dot}
                        style={{ width: `${(c[s] / items.length) * 100}%` }}
                      />
                    ) : null,
                  )}
                </span>
                <span className="w-14 shrink-0 text-right text-xs text-muted tabular-nums">
                  {c.done}/{items.length}
                </span>
                <ChevronDown
                  className={clsx("size-4 shrink-0 text-muted transition-transform", expanded && "rotate-180")}
                />
              </button>
              {expanded && (
                <ul className="space-y-1.5 px-4 pb-3">
                  {items.map((t) => (
                    <li key={t._id} className="flex flex-wrap items-center gap-2 text-sm">
                      <StatusPill status={t.status} />
                      <span className="min-w-0 flex-1 break-words">{t.title}</span>
                      <span className="inline-flex items-center gap-1 text-xs text-muted">
                        <span className="size-2 rounded-full" style={{ background: t.projectColor }} /> {t.projectName}
                      </span>
                      {t.assigneeId && <Avatar member={byId.get(t.assigneeId)} size={18} />}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function PeopleSummary({ people }: { people: PersonStats[] }) {
  if (people.length === 0)
    return <Empty title="No hay personas para mostrar" body="Prueba quitar el filtro de responsables." />;

  // The person column stays pinned while the numbers scroll sideways on phones.
  return (
    <div className="overflow-x-auto card">
      <table className="w-full min-w-120 text-left text-sm">
        <thead className="border-b border-line bg-surface-2/60 text-xs font-medium tracking-wide text-muted uppercase">
          <tr>
            <th className="sticky left-0 bg-surface px-4 py-2.5">Persona</th>
            <th className="px-3 py-2.5 text-right">Asignadas</th>
            <th className="px-3 py-2.5 text-right">Hechas</th>
            <th className="px-3 py-2.5 text-right">Sin terminar</th>
            <th className="px-3 py-2.5 text-right">Pendientes</th>
            <th className="px-4 py-2.5 text-right">Completado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {people.map((person) => (
            <tr key={person.id ?? "unassigned"}>
              <td className={clsx("sticky left-0 bg-surface px-4 py-3 font-medium", !person.id && "text-muted italic")}>
                {person.name}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">{person.assigned}</td>
              <td className="px-3 py-3 text-right tabular-nums">{person.done}</td>
              <td className="px-3 py-3 text-right tabular-nums">{person.notDone}</td>
              <td className="px-3 py-3 text-right tabular-nums">{person.open}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {completion(person) === null ? "—" : `${completion(person)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivityLog({
  projectId,
  projectDeleted,
  actorId,
  byId,
  nameOf,
}: {
  projectId?: Id<"projects">;
  projectDeleted: boolean;
  actorId?: string;
  byId: Members["byId"];
  nameOf: Members["nameOf"];
}) {
  // The server only filters by projects that still exist; a deleted one is filtered here instead.
  const {
    results: all,
    status,
    loadMore,
  } = usePaginatedQuery(
    api.activity.list,
    { projectId: projectDeleted ? undefined : projectId, actorId },
    { initialNumItems: 40 },
  );
  const results = useMemo(
    () => (projectDeleted ? all.filter((a) => a.projectId === projectId) : all),
    [all, projectDeleted, projectId],
  );

  if (status === "LoadingFirstPage") return <Skeleton className="h-60" />;
  if (results.length === 0 && status === "Exhausted") return <Empty title="Todavía no hay actividad" />;

  return (
    <div>
      {results.length === 0 ? (
        <p className="card p-4 text-sm text-muted">
          No hay actividad que coincida en las entradas recientes. Carga más para buscar entradas anteriores.
        </p>
      ) : (
        <ul className="divide-y divide-line card">
          {results.map((a, i) => {
            const day = format(a._creationTime, "yyyy-MM-dd");
            const header = i === 0 || day !== format(results[i - 1]._creationTime, "yyyy-MM-dd");
            return (
              <li key={a._id}>
                {header && (
                  <p className="bg-surface-2/60 px-4 py-1.5 text-xs font-medium text-muted">
                    {fmt(day, "EEEE, MMMM d, yyyy")}
                  </p>
                )}
                <div className="flex items-start gap-3 px-4 py-2.5 text-sm">
                  <Avatar member={byId.get(a.actorId)} size={22} />
                  <p className="min-w-0 flex-1">
                    <span className="font-medium">{nameOf(a.actorId)}</span> {describe(a)}
                    {!a.action.startsWith("project_") && <span className="text-muted"> · {a.projectName}</span>}
                  </p>
                  <time
                    className="shrink-0 text-xs text-muted"
                    dateTime={new Date(a._creationTime).toISOString()}
                    title={new Date(a._creationTime).toLocaleString("es")}
                  >
                    {formatDistanceToNow(a._creationTime, { addSuffix: true, locale: es })}
                  </time>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {status !== "Exhausted" && (
        <div className="mt-4 flex justify-center">
          <button className="btn-outline" disabled={status === "LoadingMore"} onClick={() => loadMore(60)}>
            {status === "LoadingMore" ? "Cargando…" : "Cargar más"}
          </button>
        </div>
      )}
    </div>
  );
}

function ExportMenu({
  disabled,
  from,
  to,
  projectId,
  projectDeleted,
  memberId,
  todos,
  people,
  nameOf,
}: {
  disabled: boolean;
  from: string;
  to: string;
  projectId?: Id<"projects">;
  projectDeleted: boolean;
  memberId: string;
  todos: TeamTodos;
  people: PersonStats[];
  nameOf: Members["nameOf"];
}) {
  const convex = useConvex();
  // Activity is filtered by timestamp, so day boundaries use the team's zone (#21).
  const timeZone = useTeamTimeZone();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stamp = `${from}_to_${to}`;

  const todoRows = () =>
    todos.map((t) => ({
      date: t.date,
      project: t.projectName,
      title: t.title,
      status: STATUS_META[t.status].label,
      assignee: nameOf(t.assigneeId),
      created_by: nameOf(t.createdBy),
      notes: t.notes ?? "",
      completed_at: t.completedAt ? new Date(t.completedAt).toISOString() : "",
      carried_over: t.carriedFrom ? "sí" : "",
    }));

  const peopleRows = () =>
    people.map((person) => ({
      person: person.name,
      assigned: person.assigned,
      done: person.done,
      didnt_finish: person.notDone,
      open: person.open,
      completion_percent: completion(person) ?? "",
    }));

  async function activityRows() {
    // Pages through every row on the server (filtered by index), so nothing is silently dropped (#15).
    const rows = await collectPages((cursor) =>
      convex.query(api.activity.exportPage, {
        fromMs: dayStartMs(from, timeZone),
        toMs: dayStartMs(shiftDays(to, 1), timeZone) - 1,
        // The server only filters by projects that still exist; a deleted one is filtered below.
        projectId: projectDeleted ? undefined : projectId,
        actorId: memberId || undefined,
        paginationOpts: { numItems: MAX_EXPORT_PAGE_SIZE, cursor },
      }),
    );
    return rows
      .filter((a) => !projectDeleted || a.projectId === projectId)
      .map((a) => ({
        time: new Date(a._creationTime).toISOString(),
        person: nameOf(a.actorId),
        project: a.projectName,
        action: a.action,
        todo: a.todoTitle ?? "",
        from: a.from ?? "",
        to: a.to ?? "",
        day: a.date ?? "",
        description: `${nameOf(a.actorId)} ${describe(a)}`,
      }));
  }

  async function run(kind: "todos-csv" | "people-csv" | "activity-csv" | "excel" | "json") {
    setBusy(true);
    setError(null);
    try {
      if (kind === "todos-csv")
        download(`todos_${stamp}.csv`, toCsv(todoRows(), TODO_HEADERS), "text/csv;charset=utf-8");
      if (kind === "people-csv")
        download(`people_${stamp}.csv`, toCsv(peopleRows(), PEOPLE_HEADERS), "text/csv;charset=utf-8");
      if (kind === "activity-csv")
        download(`activity_${stamp}.csv`, toCsv(await activityRows(), ACTIVITY_HEADERS), "text/csv;charset=utf-8");
      if (kind === "excel") {
        await downloadXlsx(`lcftodos_${stamp}.xlsx`, [
          { name: "Tareas", rows: todoRows(), headers: TODO_HEADERS },
          { name: "Actividad", rows: await activityRows(), headers: ACTIVITY_HEADERS },
          { name: "Personas", rows: peopleRows(), headers: PEOPLE_HEADERS },
        ]);
      }
      if (kind === "json") {
        const data = {
          exportedAt: new Date().toISOString(),
          from,
          to,
          timeZone: timeZone ?? browserTimeZone(),
          todos: todoRows(),
          people: peopleRows(),
          activity: await activityRows(),
        };
        download(`lcftodos_${stamp}.json`, JSON.stringify(data, null, 2), "application/json");
      }
    } catch (caught) {
      setError(errorMessage(caught, "No se pudo exportar este período. Prueba uno más corto."));
    } finally {
      setBusy(false);
    }
  }

  if (disabled)
    return (
      <button className="btn-outline" disabled>
        Export
      </button>
    );

  return (
    <div className="relative">
      <Menu
        label={
          <>
            <Download className="size-4" /> {busy ? "Exportando…" : "Exportar"}
          </>
        }
        disabled={busy}
        triggerClassName="btn-outline aria-disabled:cursor-progress aria-disabled:opacity-60"
        menuClassName="w-56"
      >
        <MenuItem onSelect={() => void run("todos-csv")}>Tareas (CSV)</MenuItem>
        <MenuItem onSelect={() => void run("people-csv")}>Personas (CSV)</MenuItem>
        <MenuItem onSelect={() => void run("activity-csv")}>Actividad (CSV)</MenuItem>
        <MenuItem onSelect={() => void run("excel")}>Excel (.xlsx)</MenuItem>
        <MenuItem onSelect={() => void run("json")}>Todo (JSON)</MenuItem>
        <p className="px-3 pt-1 pb-1.5 text-[11px] text-muted">Usa el período y los filtros actuales.</p>
      </Menu>
      {error && (
        <p
          className="absolute top-full right-0 z-10 mt-2 w-72 rounded-lg border border-danger/30 bg-surface px-3 py-2 text-sm text-danger shadow-lg"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
