"use client";

import { useQuery } from "convex/react";
import { Archive, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Empty, PageHeader, Skeleton } from "@/components/PageHeader";
import { ProjectDialog } from "@/components/ProjectDialog";
import { useToday } from "@/components/useToday";
import { shiftDays, weekStart } from "@/lib/dates";
import { STATUS_META, STATUSES } from "@/lib/status";

export default function ProjectsPage() {
  const [creating, setCreating] = useState(false);
  const from = weekStart(useToday());
  const projects = useQuery(api.projects.listWithStats, { from, to: shiftDays(from, 6) });
  const access = useQuery(api.projectAccess.me, {});
  // A member of a restricted team only sees projects an admin granted them (#46).
  const awaitingAccess = access?.restricted === true && !access.isAdmin;
  const active = projects?.filter((p) => !p.archived) ?? [];
  const archived = projects?.filter((p) => p.archived) ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Proyectos"
        subtitle="Progreso de esta semana."
        actions={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Nuevo proyecto
          </button>
        }
      />

      {projects === undefined ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : active.length === 0 && archived.length === 0 ? (
        <Empty
          title={awaitingAccess ? "Todavía no tienes acceso a ningún proyecto" : "Aún no hay proyectos"}
          body={
            awaitingAccess
              ? "Un administrador puede darte acceso a proyectos existentes. También puedes crear uno."
              : "Los proyectos agrupan las tareas del equipo. Crea uno para planificar la semana."
          }
          action={
            <button className="btn-primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> Nuevo proyecto
            </button>
          }
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((p) => (
              <ProjectCard key={p._id} project={p} />
            ))}
          </div>
          {archived.length > 0 && (
            <details className="mt-8">
              <summary className="flex cursor-pointer items-center gap-1.5 text-sm text-muted">
                <Archive className="size-4" /> Archivados ({archived.length})
              </summary>
              <div className="mt-3 grid gap-3 opacity-75 sm:grid-cols-2 lg:grid-cols-3">
                {archived.map((p) => (
                  <ProjectCard key={p._id} project={p} />
                ))}
              </div>
            </details>
          )}
        </>
      )}

      <ProjectDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

type ProjectWithStats = NonNullable<ReturnType<typeof useQuery<typeof api.projects.listWithStats>>>[number];

function ProjectCard({ project: p }: { project: ProjectWithStats }) {
  const pct = p.total ? Math.round((p.counts.done / p.total) * 100) : 0;
  return (
    <Link
      href={`/app/projects/${p._id}`}
      className="group flex flex-col card p-4 transition-colors hover:border-muted/40"
    >
      <div className="flex items-center gap-2">
        <span className="size-3 shrink-0 rounded-full" style={{ background: p.color }} />
        <h2 className="truncate font-medium">{p.name}</h2>
      </div>
      {p.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{p.description}</p>}
      <div className="mt-auto pt-4">
        <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-2">
          {STATUSES.map((s) =>
            p.counts[s] ? (
              <span key={s} className={STATUS_META[s].dot} style={{ width: `${(p.counts[s] / p.total) * 100}%` }} />
            ) : null,
          )}
        </div>
        <p className="mt-2 text-xs text-muted">
          {p.total === 0 ? "Sin tareas esta semana" : `${p.counts.done}/${p.total} completadas · ${pct}%`}
        </p>
      </div>
    </Link>
  );
}
