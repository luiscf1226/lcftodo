"use client";

import clsx from "clsx";
import { useConvex, usePaginatedQuery, useQuery } from "convex/react";
import { differenceInCalendarDays, format, formatDistanceToNow, isValid } from "date-fns";
import { ChevronDown, Download } from "lucide-react";
import { useMemo, useState } from "react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import { Avatar } from "@/components/Avatar";
import { Empty, PageHeader, Skeleton } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusSelect";
import { useDismissibleMenu } from "@/components/useDismissibleMenu";
import { useMembers } from "@/components/useMembers";
import { describe } from "@/lib/activity";
import { download, toCsv } from "@/lib/csv";
import { fmt, fromKey, shiftDays, todayKey } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { completion, peopleStats, type PersonStats } from "@/lib/peopleStats";
import { STATUS_META, STATUSES } from "@/lib/status";
import { downloadXlsx } from "@/lib/xlsx";

export default function HistoryPage() {
  const today = todayKey();
  const [from, setFrom] = useState(shiftDays(today, -29));
  const [to, setTo] = useState(today);
  const [projectId, setProjectId] = useState<Id<"projects"> | "">("");
  const [memberId, setMemberId] = useState("");
  const [tab, setTab] = useState<"days" | "people" | "activity">("days");
  const validDates = Boolean(from && to) && isValid(fromKey(from)) && isValid(fromKey(to));
  const validRange = validDates && from <= to;
  const rangeDays = validRange ? differenceInCalendarDays(fromKey(to), fromKey(from)) + 1 : 0;
  const rangeTooLarge = rangeDays > 366;
  const canViewRange = validRange && !rangeTooLarge;
  const memberFilterLabel = tab === "activity" ? "Changed by" : "Assigned to";

  const projects = useQuery(api.projects.list, { includeArchived: true });
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
        title="History"
        subtitle="Everything your team planned, finished and missed."
        actions={<ExportMenu disabled={!canViewRange} from={from} to={to} projectId={projectId || undefined} memberId={memberId} todos={filtered} people={people} nameOf={nameOf} />}
      />

      <div className="card mb-5 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor="h-from">From</label>
          <input id="h-from" type="date" className="input" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="h-to">To</label>
          <input id="h-to" type="date" className="input" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="h-project">Project</label>
          <select id="h-project" className="input" value={projectId} onChange={(e) => setProjectId(e.target.value as Id<"projects"> | "")}>
            <option value="">All projects</option>
            {projects?.map((p) => <option key={p._id} value={p._id}>{p.name}{p.archived ? " (archived)" : ""}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="h-member">{memberFilterLabel}</label>
          <select id="h-member" className="input" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">Everyone</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      </div>

      {!validDates ? (
        <p className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
          Select valid start and end dates to view or export History.
        </p>
      ) : !validRange && (
        <p className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
          The start date must be on or before the end date. Adjust either date to view or export History.
        </p>
      )}
      {rangeTooLarge && (
        <p className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
          History supports ranges up to 366 days. Select a shorter range to view or export it.
        </p>
      )}

      <div className="mb-4 flex gap-1 border-b border-line" role="tablist">
        {(["days", "people", "activity"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={clsx("-mb-px border-b-2 px-3 py-2 text-sm", tab === t ? "border-accent font-medium" : "border-transparent text-muted hover:text-fg")}
          >
            {t === "days" ? "Day by day" : t === "people" ? "People" : "Activity log"}
          </button>
        ))}
      </div>

      {!canViewRange ? null : tab === "days" ? (
        todos === undefined ? <Skeleton className="h-60" /> : <DaySummary todos={filtered} byId={byId} />
      ) : tab === "people" ? (
        todos === undefined ? <Skeleton className="h-60" /> : <PeopleSummary people={people} />
      ) : (
        <ActivityLog projectId={projectId || undefined} actorId={memberId || undefined} byId={byId} nameOf={nameOf} />
      )}
    </div>
  );
}

type TeamTodos = NonNullable<ReturnType<typeof useQuery<typeof api.todos.listForTeam>>>;
type Members = ReturnType<typeof useMembers>;

// Fixed export columns, so empty sheets/CSVs still carry their headers.
const TODO_HEADERS = ["date", "project", "title", "status", "assignee", "created_by", "notes", "completed_at", "carried_over"];
const ACTIVITY_HEADERS = ["time", "person", "project", "action", "todo", "from", "to", "day", "description"];
const PEOPLE_HEADERS = ["person", "assigned", "done", "didnt_finish", "open", "completion_percent"];

function DaySummary({ todos, byId }: { todos: TeamTodos; byId: Members["byId"] }) {
  const [open, setOpen] = useState<string | null>(null);
  const days = useMemo(() => {
    const map = new Map<string, TeamTodos>();
    for (const t of todos) map.set(t.date, [...(map.get(t.date) ?? []), t]);
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [todos]);

  const totals = { todo: 0, doing: 0, done: 0, not_done: 0 };
  for (const t of todos) totals[t.status]++;

  if (days.length === 0) return <Empty title="No todos in this range" body="Try a wider date range or different filters." />;

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        <span><span className="font-semibold text-fg">{todos.length}</span> todos</span>
        {STATUSES.map((s) => (
          <span key={s}><span className="font-semibold text-fg">{totals[s]}</span> {STATUS_META[s].label.toLowerCase()}</span>
        ))}
        <span><span className="font-semibold text-fg">{Math.round((totals.done / todos.length) * 100)}%</span> completion</span>
      </div>
      <ul className="card divide-y divide-line">
        {days.map(([day, items]) => {
          const c = { todo: 0, doing: 0, done: 0, not_done: 0 };
          for (const t of items) c[t.status]++;
          const expanded = open === day;
          return (
            <li key={day}>
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : day)}>
                <span className="w-28 shrink-0 text-sm font-medium sm:w-36">{fmt(day, "EEE, MMM d")}</span>
                <span className="flex h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
                  {STATUSES.map((s) => (c[s] ? <span key={s} className={STATUS_META[s].dot} style={{ width: `${(c[s] / items.length) * 100}%` }} /> : null))}
                </span>
                <span className="w-14 shrink-0 text-right text-xs text-muted tabular-nums">{c.done}/{items.length}</span>
                <ChevronDown className={clsx("size-4 shrink-0 text-muted transition-transform", expanded && "rotate-180")} />
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
  if (people.length === 0) return <Empty title="No people to show" body="Try clearing the Assigned to filter." />;

  // The person column stays pinned while the numbers scroll sideways on phones.
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-120 text-left text-sm">
        <thead className="border-b border-line bg-surface-2/60 text-xs font-medium tracking-wide text-muted uppercase">
          <tr>
            <th className="sticky left-0 bg-surface px-4 py-2.5">Person</th>
            <th className="px-3 py-2.5 text-right">Assigned</th>
            <th className="px-3 py-2.5 text-right">Done</th>
            <th className="px-3 py-2.5 text-right">Didn&apos;t finish</th>
            <th className="px-3 py-2.5 text-right">Open</th>
            <th className="px-4 py-2.5 text-right">Completion</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {people.map((person) => (
            <tr key={person.id ?? "unassigned"}>
              <td className={clsx("sticky left-0 bg-surface px-4 py-3 font-medium", !person.id && "text-muted italic")}>{person.name}</td>
              <td className="px-3 py-3 text-right tabular-nums">{person.assigned}</td>
              <td className="px-3 py-3 text-right tabular-nums">{person.done}</td>
              <td className="px-3 py-3 text-right tabular-nums">{person.notDone}</td>
              <td className="px-3 py-3 text-right tabular-nums">{person.open}</td>
              <td className="px-4 py-3 text-right tabular-nums">{completion(person) === null ? "—" : `${completion(person)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivityLog({
  projectId,
  actorId,
  byId,
  nameOf,
}: {
  projectId?: Id<"projects">;
  actorId?: string;
  byId: Members["byId"];
  nameOf: Members["nameOf"];
}) {
  const { results, status, loadMore } = usePaginatedQuery(api.activity.list, { projectId, actorId }, { initialNumItems: 40 });

  if (status === "LoadingFirstPage") return <Skeleton className="h-60" />;
  if (results.length === 0) return <Empty title="No activity yet" />;

  return (
    <div>
      <ul className="card divide-y divide-line">
        {results.map((a, i) => {
          const day = format(a._creationTime, "yyyy-MM-dd");
          const header = i === 0 || day !== format(results[i - 1]._creationTime, "yyyy-MM-dd");
          return (
            <li key={a._id}>
              {header && <p className="bg-surface-2/60 px-4 py-1.5 text-xs font-medium text-muted">{fmt(day, "EEEE, MMMM d, yyyy")}</p>}
              <div className="flex items-start gap-3 px-4 py-2.5 text-sm">
                <Avatar member={byId.get(a.actorId)} size={22} />
                <p className="min-w-0 flex-1">
                  <span className="font-medium">{nameOf(a.actorId)}</span> {describe(a)}
                  {!a.action.startsWith("project_") && <span className="text-muted"> · {a.projectName}</span>}
                </p>
                <time className="shrink-0 text-xs text-muted" dateTime={new Date(a._creationTime).toISOString()} title={new Date(a._creationTime).toLocaleString()}>
                  {formatDistanceToNow(a._creationTime, { addSuffix: true })}
                </time>
              </div>
            </li>
          );
        })}
      </ul>
      {status !== "Exhausted" && (
        <div className="mt-4 flex justify-center">
          <button className="btn-outline" disabled={status === "LoadingMore"} onClick={() => loadMore(60)}>
            {status === "LoadingMore" ? "Loading…" : "Load more"}
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
  memberId,
  todos,
  people,
  nameOf,
}: {
  disabled: boolean;
  from: string;
  to: string;
  projectId?: Id<"projects">;
  memberId: string;
  todos: TeamTodos;
  people: PersonStats[];
  nameOf: Members["nameOf"];
}) {
  const convex = useConvex();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { open, setOpen, close, containerRef, triggerRef } = useDismissibleMenu();
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
      carried_over: t.carriedFrom ? "yes" : "",
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
    const rows = await convex.query(api.activity.exportRange, {
      fromMs: fromKey(from).getTime(),
      toMs: fromKey(shiftDays(to, 1)).getTime() - 1,
      projectId,
    });
    return rows
      .filter((a) => !memberId || a.actorId === memberId)
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
      if (kind === "todos-csv") download(`todos_${stamp}.csv`, toCsv(todoRows(), TODO_HEADERS), "text/csv;charset=utf-8");
      if (kind === "people-csv") download(`people_${stamp}.csv`, toCsv(peopleRows(), PEOPLE_HEADERS), "text/csv;charset=utf-8");
      if (kind === "activity-csv") download(`activity_${stamp}.csv`, toCsv(await activityRows(), ACTIVITY_HEADERS), "text/csv;charset=utf-8");
      if (kind === "excel") {
        await downloadXlsx(`lcftodos_${stamp}.xlsx`, [
          { name: "Todos", rows: todoRows(), headers: TODO_HEADERS },
          { name: "Activity", rows: await activityRows(), headers: ACTIVITY_HEADERS },
          { name: "People", rows: peopleRows(), headers: PEOPLE_HEADERS },
        ]);
      }
      if (kind === "json") {
        const data = { exportedAt: new Date().toISOString(), from, to, todos: todoRows(), people: peopleRows(), activity: await activityRows() };
        download(`lcftodos_${stamp}.json`, JSON.stringify(data, null, 2), "application/json");
      }
    } catch (caught) {
      setError(errorMessage(caught, "Couldn’t export this range. Please try a shorter range."));
    } finally {
      setBusy(false);
      close();
    }
  }

  if (disabled) return <button className="btn-outline" disabled>Export</button>;

  return (
    <div ref={containerRef} className="relative">
      <button ref={triggerRef} type="button" className="btn-outline" aria-expanded={open} aria-haspopup="menu" disabled={busy} onClick={() => setOpen((value) => !value)}>
        <Download className="size-4" /> {busy ? "Exporting…" : "Export"}
      </button>
      {open && <div role="menu" className="absolute right-0 z-10 mt-1 w-56 rounded-xl border border-line bg-surface p-1 shadow-lg">
        <button role="menuitem" className="btn-ghost w-full justify-start" disabled={busy} onClick={() => void run("todos-csv")}>Todos (CSV)</button>
        <button role="menuitem" className="btn-ghost w-full justify-start" disabled={busy} onClick={() => void run("people-csv")}>People (CSV)</button>
        <button role="menuitem" className="btn-ghost w-full justify-start" disabled={busy} onClick={() => void run("activity-csv")}>Activity log (CSV)</button>
        <button role="menuitem" className="btn-ghost w-full justify-start" disabled={busy} onClick={() => void run("excel")}>Excel (.xlsx)</button>
        <button role="menuitem" className="btn-ghost w-full justify-start" disabled={busy} onClick={() => void run("json")}>Everything (JSON)</button>
        <p className="px-3 pt-1 pb-1.5 text-[11px] text-muted">Uses the current date range and filters.</p>
      </div>}
      {error && <p className="absolute right-0 top-full z-10 mt-2 w-72 rounded-lg border border-danger/30 bg-surface px-3 py-2 text-sm text-danger shadow-lg" role="alert">{error}</p>}
    </div>
  );
}
