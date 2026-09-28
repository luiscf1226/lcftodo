"use client";

import clsx from "clsx";
import { useAction, useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Copy, KeyRound, Link2, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatInviteCode, INVITE_CODE_EXPIRY_DAYS } from "../../convex/lib/inviteCode";
import { errorMessage } from "@/lib/errors";
import { ONBOARDING_PATH } from "@/lib/routes";
import { ProjectPicker, type ProjectLite } from "./ProjectPicker";
import { showToast } from "./ToastViewport";

type Code = NonNullable<ReturnType<typeof useQuery<typeof api.inviteCodes.list>>>[number];

const USE_LIMITS = [1, 5, 25] as const;

const EXPIRY_LABEL: Record<(typeof INVITE_CODE_EXPIRY_DAYS)[number], string> = {
  1: "1 día",
  7: "7 días",
  30: "30 días",
};

const codeStatus = (c: Code) =>
  c.revoked
    ? "revoked"
    : c.expiresAt <= Date.now()
      ? "expired"
      : c.maxUses !== null && c.uses >= c.maxUses
        ? "used"
        : "active";

const STATUS_LABEL = { active: "Activo", revoked: "Revocado", expired: "Vencido", used: "Agotado" } as const;

const joinLink = (code: string) => `${window.location.origin}${ONBOARDING_PATH}?code=${formatInviteCode(code)}`;

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(done);
  } catch {
    showToast("No se pudo copiar. Selecciona el texto y cópialo manualmente.");
  }
}

/** Admin-only: shareable codes to join the team and projects when an invitation email fails. */
export function InviteCodes({ projects, restricted }: { projects: ProjectLite[]; restricted: boolean }) {
  const codes = useQuery(api.inviteCodes.list, {});
  const create = useAction(api.inviteCodes.create);
  const [selected, setSelected] = useState<Set<Id<"projects">>>(new Set());
  const [days, setDays] = useState<(typeof INVITE_CODE_EXPIRY_DAYS)[number]>(7);
  const [maxUses, setMaxUses] = useState<string>("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = projects.filter((p) => !p.archived);
  const names = useMemo(() => new Map(projects.map((p) => [p._id, p.name])), [projects]);

  const toggle = (id: Id<"projects">) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { code } = await create({
        projectIds: [...selected],
        expiresInDays: days,
        maxUses: maxUses === "unlimited" ? undefined : Number(maxUses),
      });
      setSelected(new Set());
      await copy(joinLink(code), `Código ${formatInviteCode(code)} creado. Enlace copiado.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-4" aria-labelledby="invite-codes-heading">
      <h2 id="invite-codes-heading" className="flex items-center gap-2 font-medium">
        <KeyRound className="size-4" /> Códigos de invitación
      </h2>
      <p className="mb-3 text-sm text-muted">
        ¿No llegó el correo? Crea un código y compártelo por otro medio. Quien lo use con su cuenta se une al equipo
        como miembro y recibe acceso a los proyectos elegidos.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <ProjectPicker projects={live} selected={selected} onToggle={toggle} legend="Proyectos que pueden ver" />
        {!restricted && selected.size > 0 && (
          <p className="text-xs text-muted">
            El acceso está abierto ahora, así que verán todos los proyectos hasta que lo restrinjas arriba.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="code-expiry">
              Vence en
            </label>
            <select
              id="code-expiry"
              className="input"
              value={days}
              onChange={(e) => setDays(Number(e.target.value) as typeof days)}
            >
              {INVITE_CODE_EXPIRY_DAYS.map((d) => (
                <option key={d} value={d}>
                  {EXPIRY_LABEL[d]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="code-uses">
              Usos
            </label>
            <select id="code-uses" className="input" value={maxUses} onChange={(e) => setMaxUses(e.target.value)}>
              {USE_LIMITS.map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "1 persona" : `Hasta ${n} personas`}
                </option>
              ))}
              <option value="unlimited">Sin límite</option>
            </select>
          </div>
        </div>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={busy}>
            <KeyRound className="size-4" /> {busy ? "Creando…" : "Crear código"}
          </button>
        </div>
      </form>

      {codes && codes.length > 0 && (
        <ul className="mt-4 divide-y divide-line border-t border-line">
          {codes.map((c) => (
            <CodeRow key={c._id} code={c} names={names} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CodeRow({ code: c, names }: { code: Code; names: Map<Id<"projects">, string> }) {
  const revoke = useMutation(api.inviteCodes.revoke);
  const [busy, setBusy] = useState(false);
  const status = codeStatus(c);
  const formatted = formatInviteCode(c.code);

  async function doRevoke() {
    setBusy(true);
    try {
      await revoke({ id: c._id });
      showToast(`Código ${formatted} revocado.`);
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
          <code
            className={clsx("font-mono font-medium tracking-wider", status !== "active" && "text-muted line-through")}
          >
            {formatted}
          </code>
          <span
            className={clsx(
              "rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
              status === "active"
                ? "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900"
                : "bg-surface-2 text-muted ring-line",
            )}
          >
            {STATUS_LABEL[status]}
          </span>
          <span className="text-xs text-muted">
            {c.uses}/{c.maxUses ?? "∞"} usos
          </span>
        </p>
        <p className="truncate text-xs text-muted">
          {c.projectIds.length
            ? c.projectIds.map((id) => names.get(id) ?? "Proyecto eliminado").join(", ")
            : "Sin proyectos"}
          {" · "}
          {status === "active"
            ? `vence ${formatDistanceToNow(c.expiresAt, { addSuffix: true, locale: es })}`
            : `creado ${formatDistanceToNow(c.createdAt, { addSuffix: true, locale: es })}`}
        </p>
      </div>
      {status === "active" && (
        <div className="flex gap-1">
          <button
            type="button"
            className="btn-ghost px-2 text-sm"
            onClick={() => void copy(formatted, `Código ${formatted} copiado.`)}
          >
            <Copy className="size-4" /> Código
          </button>
          <button
            type="button"
            className="btn-ghost px-2 text-sm"
            onClick={() => void copy(joinLink(c.code), "Enlace copiado.")}
          >
            <Link2 className="size-4" /> Enlace
          </button>
          <button
            type="button"
            className="btn-ghost px-2 text-sm text-danger"
            disabled={busy}
            onClick={() => void doRevoke()}
          >
            <X className="size-4" /> Revocar
          </button>
        </div>
      )}
    </li>
  );
}
