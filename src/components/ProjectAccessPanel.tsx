"use client";

import clsx from "clsx";
import { useAction, useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Lock, LockOpen, Mail, RefreshCw, Send, UserMinus, X } from "lucide-react";
import { useId, useMemo, useState, type FormEvent } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { errorMessage } from "@/lib/errors";
import { Avatar } from "./Avatar";
import { Modal } from "./Modal";
import { showToast } from "./ToastViewport";
import { useMembers, type Member } from "./useMembers";

type Overview = NonNullable<ReturnType<typeof useQuery<typeof api.projectAccess.overview>>>;
type Invitation = Overview["invitations"][number];
type ProjectLite = { _id: Id<"projects">; name: string; color: string; archived: boolean };

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900",
  accepted:
    "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900",
  revoked: "bg-surface-2 text-muted ring-line",
  expired: "bg-surface-2 text-muted ring-line",
};

/** Pending invitations past their expiry are shown as expired even before Clerk is re-checked. */
const displayStatus = (i: Invitation) =>
  i.status === "pending" && i.expiresAt !== null && i.expiresAt < Date.now() ? "expired" : i.status;

/** Admin-only project access: policy toggle, invitations to selected projects, per-member grants (#46). */
export function ProjectAccessPanel() {
  const overview = useQuery(api.projectAccess.overview, {});
  const projects = useQuery(api.projects.list, {});

  if (overview === undefined || projects === undefined) {
    return <div className="h-40 animate-pulse card bg-surface-2" />;
  }
  if (overview === null) return null;

  return (
    <div className="space-y-5">
      <PolicyCard restricted={overview.restricted} syncReady={overview.membershipSyncReady} />
      <InviteForm projects={projects} restricted={overview.restricted} />
      <Invitations invitations={overview.invitations} projects={projects} />
      <MemberAccess grantsByUser={overview.grantsByUser} projects={projects} restricted={overview.restricted} />
    </div>
  );
}

function PolicyCard({ restricted, syncReady }: { restricted: boolean; syncReady: boolean }) {
  const setRestricted = useMutation(api.projectAccess.setRestricted);
  const backfill = useAction(api.memberships.backfill);
  const [confirming, setConfirming] = useState(false);
  const [seed, setSeed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seedId = useId();

  async function apply(enabled: boolean) {
    setBusy(true);
    setError(null);
    try {
      // Removal from the team is only enforced from synced memberships, so sync once first.
      if (enabled && !syncReady) await backfill();
      const { seeded } = await setRestricted({ enabled, seedFromWork: enabled && seed });
      setConfirming(false);
      showToast(
        enabled
          ? `El acceso a proyectos está restringido${seeded ? ` · se añadieron ${seeded} ${seeded === 1 ? "permiso" : "permisos"} a partir del trabajo existente` : ""}.`
          : "Todos los miembros pueden ver todos los proyectos.",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const Icon = restricted ? Lock : LockOpen;
  return (
    <section className="card p-4" aria-labelledby="access-policy">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-accent" aria-hidden>
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 id="access-policy" className="font-medium">
              {restricted ? "Acceso restringido a proyectos" : "Acceso abierto a proyectos"}
            </h2>
            <p className="text-sm text-muted">
              {restricted
                ? "Los miembros solo ven los proyectos autorizados. Los administradores ven todos."
                : "Todos los miembros ven todos los proyectos. Restringe el acceso para elegir quién ve cada uno."}
            </p>
          </div>
        </div>
        {restricted ? (
          <button type="button" className="btn-outline" disabled={busy} onClick={() => void apply(false)}>
            Abrir a todos
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={() => setConfirming(true)}>
            <Lock className="size-4" /> Restringir acceso
          </button>
        )}
      </div>
      {error && !confirming && (
        <p className="mt-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      <Modal open={confirming} onClose={() => setConfirming(false)} title="¿Restringir acceso a proyectos?">
        <div className="space-y-4 text-sm">
          <p className="text-muted">
            Los miembros solo verán los proyectos autorizados en Proyectos, Hoy, los tableros, el historial y las
            exportaciones. Los administradores conservarán el acceso completo. Puedes deshacerlo cuando quieras.
          </p>
          <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
            <input
              id={seedId}
              type="checkbox"
              className="mt-0.5 size-4 accent-accent"
              checked={seed}
              onChange={(e) => setSeed(e.target.checked)}
            />
            <label htmlFor={seedId} className="text-fg">
              Mantener visible el trabajo actual: dar acceso a cada miembro a los proyectos que creó o donde tiene
              tareas
            </label>
          </div>
          {error && (
            <p className="text-danger" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-outline" onClick={() => setConfirming(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void apply(true)}
              data-autofocus
            >
              {busy ? "Restringiendo…" : "Restringir acceso"}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function ProjectPicker({
  projects,
  selected,
  onToggle,
  legend,
}: {
  projects: ProjectLite[];
  selected: Set<Id<"projects">>;
  onToggle: (id: Id<"projects">) => void;
  legend: string;
}) {
  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      {projects.length === 0 ? (
        <p className="text-sm text-muted">Crea un proyecto antes de dar acceso.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {projects.map((p) => (
            <label
              key={p._id}
              className={clsx(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm has-focus-visible:outline-2 has-focus-visible:outline-accent",
                selected.has(p._id) ? "border-accent bg-surface-2 text-fg" : "border-line text-muted hover:text-fg",
              )}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={selected.has(p._id)}
                onChange={() => onToggle(p._id)}
              />
              <span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden />
              {p.name}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

function InviteForm({ projects, restricted }: { projects: ProjectLite[]; restricted: boolean }) {
  const invite = useAction(api.invitations.invite);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"org:member" | "org:admin">("org:member");
  const [selected, setSelected] = useState<Set<Id<"projects">>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = projects.filter((p) => !p.archived);

  const toggle = (id: Id<"projects">) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { outcome } = await invite({ email, role, projectIds: [...selected] });
      showToast(
        outcome === "granted"
          ? `${email.trim()} ya forma parte del equipo y recibió acceso de inmediato.`
          : outcome === "merged"
            ? `Se añadieron los proyectos a la invitación pendiente de ${email.trim()}.`
            : `Invitación enviada a ${email.trim()}.`,
      );
      setEmail("");
      setSelected(new Set());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-4" aria-labelledby="invite-heading">
      <h2 id="invite-heading" className="flex items-center gap-2 font-medium">
        <Mail className="size-4" /> Invitar personas
      </h2>
      <p className="mb-3 text-sm text-muted">
        Recibirán un correo de Clerk para crear su propia cuenta. No tendrás acceso a su contraseña.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <div>
            <label className="label" htmlFor="invite-email">
              Correo electrónico
            </label>
            <input
              id="invite-email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              autoComplete="off"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="invite-role">
              Rol
            </label>
            <select
              id="invite-role"
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
            >
              <option value="org:member">Miembro</option>
              <option value="org:admin">Administrador (todos los proyectos)</option>
            </select>
          </div>
        </div>
        {role === "org:member" && (
          <ProjectPicker projects={live} selected={selected} onToggle={toggle} legend="Proyectos que pueden ver" />
        )}
        {role === "org:member" && !restricted && selected.size > 0 && (
          <p className="text-xs text-muted">
            El acceso está abierto ahora, así que verán todos los proyectos hasta que lo restrinjas arriba.
          </p>
        )}
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={busy || !email.trim()}>
            <Send className="size-4" /> {busy ? "Enviando…" : "Enviar invitación"}
          </button>
        </div>
      </form>
    </section>
  );
}

function Invitations({ invitations, projects }: { invitations: Invitation[]; projects: ProjectLite[] }) {
  const refresh = useAction(api.invitations.refresh);
  const [refreshing, setRefreshing] = useState(false);
  const names = useMemo(() => new Map(projects.map((p) => [p._id, p.name])), [projects]);

  async function doRefresh() {
    setRefreshing(true);
    try {
      await refresh();
    } catch (e) {
      showToast(errorMessage(e));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="card p-4" aria-labelledby="invitations-heading">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="invitations-heading" className="font-medium">
          Invitaciones
        </h2>
        {invitations.some((i) => i.status === "pending") && (
          <button type="button" className="btn-ghost text-muted" onClick={() => void doRefresh()} disabled={refreshing}>
            <RefreshCw className={clsx("size-4", refreshing && "animate-spin")} /> Actualizar estado
          </button>
        )}
      </div>
      {invitations.length === 0 ? (
        <p className="text-sm text-muted">Todavía no hay invitaciones.</p>
      ) : (
        <ul className="divide-y divide-line">
          {invitations.map((i) => (
            <InvitationRow key={i._id} invitation={i} names={names} />
          ))}
        </ul>
      )}
    </section>
  );
}

function InvitationRow({ invitation: i, names }: { invitation: Invitation; names: Map<Id<"projects">, string> }) {
  const resend = useAction(api.invitations.resend);
  const revoke = useAction(api.invitations.revoke);
  const [busy, setBusy] = useState(false);
  const status = displayStatus(i);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await fn();
      showToast(done);
    } catch (e) {
      showToast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="truncate font-medium">{i.email}</span>
          <span
            className={clsx("rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", STATUS_STYLE[status])}
          >
            {{ pending: "Pendiente", accepted: "Aceptada", revoked: "Revocada", expired: "Vencida" }[status] ?? status}
          </span>
          {i.role === "org:admin" && <span className="text-xs text-muted">Administrador</span>}
        </p>
        <p className="truncate text-xs text-muted">
          {i.role === "org:admin"
            ? "Todos los proyectos"
            : i.projectIds.length
              ? i.projectIds.map((id) => names.get(id) ?? "Proyecto archivado").join(", ")
              : "Sin proyectos"}
          {" · "}invitado {formatDistanceToNow(i.createdAt, { addSuffix: true, locale: es })}
        </p>
      </div>
      {status !== "accepted" && (
        <div className="flex gap-1">
          <button
            type="button"
            className="btn-ghost px-2 text-sm"
            disabled={busy}
            onClick={() => void run(() => resend({ id: i._id }), `Invitación reenviada a ${i.email}.`)}
          >
            <Send className="size-4" /> Reenviar
          </button>
          {status === "pending" && (
            <button
              type="button"
              className="btn-ghost px-2 text-sm text-danger"
              disabled={busy}
              onClick={() => void run(() => revoke({ id: i._id }), `Invitación a ${i.email} revocada.`)}
            >
              <X className="size-4" /> Revocar
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function MemberAccess({
  grantsByUser,
  projects,
  restricted,
}: {
  grantsByUser: Record<string, Id<"projects">[]>;
  projects: ProjectLite[];
  restricted: boolean;
}) {
  const { members } = useMembers();
  const me = useQuery(api.projectAccess.me, {});
  const [removing, setRemoving] = useState<Member | null>(null);

  return (
    <section className="card p-4" aria-labelledby="members-access-heading">
      <h2 id="members-access-heading" className="font-medium">
        Acceso de los miembros
      </h2>
      <p className="mb-2 text-sm text-muted">
        {restricted
          ? "Elige los proyectos que cada miembro puede ver y donde puede recibir tareas."
          : "Los permisos se aplicarán cuando restrinjas el acceso."}
      </p>
      <ul className="divide-y divide-line">
        {members.map((m) => (
          <MemberRow
            key={m.id}
            member={m}
            granted={new Set(grantsByUser[m.id] ?? [])}
            projects={projects.filter((p) => !p.archived)}
            onRemove={me && me.userId !== m.id ? () => setRemoving(m) : undefined}
          />
        ))}
      </ul>
      {removing && <RemoveMember member={removing} onClose={() => setRemoving(null)} />}
    </section>
  );
}

function MemberRow({
  member,
  granted,
  projects,
  onRemove,
}: {
  member: Member;
  granted: Set<Id<"projects">>;
  projects: ProjectLite[];
  // Absent for the signed-in admin: leaving a team is done from the team switcher.
  onRemove?: () => void;
}) {
  const grant = useMutation(api.projectAccess.grant);
  const revoke = useMutation(api.projectAccess.revoke);
  const isAdmin = member.role === "org:admin";

  async function toggle(projectId: Id<"projects">) {
    const project = projects.find((p) => p._id === projectId);
    try {
      if (granted.has(projectId)) {
        const { openAssigned } = await revoke({ projectId, userId: member.id });
        if (openAssigned > 0) {
          showToast(
            `${openAssigned} ${openAssigned === 1 ? "tarea pendiente sigue asignada" : "tareas pendientes siguen asignadas"} a ${member.name} en ${project?.name}. Reasígnalas desde el tablero.`,
          );
        }
      } else {
        await grant({ projectId, userId: member.id });
      }
    } catch (e) {
      showToast(errorMessage(e));
    }
  }

  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
      <div className="flex min-w-0 items-center gap-2 sm:w-48 sm:shrink-0">
        <Avatar member={member} size={24} />
        <span className="truncate text-sm font-medium">{member.name}</span>
      </div>
      <div className="min-w-0 flex-1">
        {isAdmin ? (
          <p className="text-sm text-muted">Administrador · todos los proyectos</p>
        ) : (
          <ProjectPicker
            projects={projects}
            selected={granted}
            onToggle={(id) => void toggle(id)}
            legend={`Proyectos de ${member.name}`}
          />
        )}
      </div>
      {onRemove && (
        <button type="button" className="btn-ghost self-start px-2 text-sm text-danger" onClick={onRemove}>
          <UserMinus className="size-4" /> Quitar
        </button>
      )}
    </li>
  );
}

function RemoveMember({ member, onClose }: { member: Member; onClose: () => void }) {
  const remove = useAction(api.invitations.removeMember);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await remove({ userId: member.id });
      showToast(`${member.name} fue eliminado del equipo.`);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`¿Quitar a ${member.name}?`}>
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          Perderá acceso a todos los proyectos de inmediato. Seguirá figurando como antiguo responsable de sus tareas
          para conservar el historial. Reasigna las tareas pendientes desde cada tablero.
        </p>
        {error && (
          <p className="text-danger" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-outline" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn-danger" disabled={busy} onClick={() => void confirm()}>
            {busy ? "Quitando…" : "Quitar del equipo"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
