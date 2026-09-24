"use client";

import clsx from "clsx";
import { useMutation, useQuery } from "convex/react";
import { CheckCheck } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { api } from "../../../../convex/_generated/api";
import { Empty, PageHeader, Skeleton } from "@/components/PageHeader";
import { showToast } from "@/components/ToastViewport";
import { useMembers } from "@/components/useMembers";
import { errorMessage } from "@/lib/errors";

export default function NotificationsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader title="Notificaciones" subtitle="Tus tareas asignadas y cómo recibes avisos." />
      <Inbox />
      <EmailSettings />
      <SlackSettings />
    </div>
  );
}

function Inbox() {
  const items = useQuery(api.notifications.list, {});
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const actorIds = useMemo(() => (items ?? []).map((n) => n.actorId), [items]);
  const { nameOf } = useMembers(actorIds);
  const unread = items?.filter((n) => !n.read).length ?? 0;

  return (
    <section aria-labelledby="inbox-heading">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="inbox-heading" className="font-medium">
          Bandeja de entrada
        </h2>
        {unread > 0 && (
          <button className="btn-ghost text-sm" onClick={() => markAllRead().catch((e) => showToast(errorMessage(e)))}>
            <CheckCheck className="size-4" /> Marcar todo como leído
          </button>
        )}
      </div>
      {items === undefined ? (
        <Skeleton className="h-24" />
      ) : items.length === 0 ? (
        <Empty title="Todavía no hay nada" body="Verás una notificación cuando un compañero te asigne una tarea." />
      ) : (
        <ul className="divide-y divide-line card">
          {items.map((n) => (
            <li key={n._id} className={clsx("flex items-start gap-3 px-4 py-3 text-sm", n.read && "text-muted")}>
              <span
                aria-hidden
                className={clsx("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-accent")}
              />
              <div className="min-w-0 flex-1">
                <p>
                  <span className="font-medium">{nameOf(n.actorId) || "Un compañero"}</span> te asignó{" "}
                  <span className="font-medium">{n.todoTitle}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {n.projectName} · vence el {n.date}
                </p>
              </div>
              {!n.read && (
                <button
                  className="btn-ghost shrink-0 px-2 py-1 text-xs"
                  onClick={() => markRead({ notificationId: n._id }).catch((e) => showToast(errorMessage(e)))}
                >
                  Marcar como leído<span className="sr-only">: {n.todoTitle}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-2">
      <input
        type="checkbox"
        className="mt-1 size-4 accent-[var(--accent)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  );
}

function EmailSettings() {
  const prefs = useQuery(api.notifications.myPrefs, {});
  const update = useMutation(api.notifications.updateMyPrefs);
  const save = (change: { emailDigest?: boolean; emailAssigned?: boolean }) =>
    update(change).catch((e) => showToast(errorMessage(e)));

  return (
    <section aria-labelledby="email-heading">
      <h2 id="email-heading" className="mb-2 font-medium">
        Correo electrónico
      </h2>
      {prefs === undefined ? (
        <Skeleton className="h-24" />
      ) : prefs === null ? null : (
        <div className="card px-4 py-2">
          {!prefs.hasEmail && (
            <p className="py-2 text-xs text-muted">
              Aún no tenemos tu dirección de correo, así que no recibirás mensajes.
            </p>
          )}
          <Toggle
            label="Resumen diario"
            hint="Cada mañana, según la hora del equipo: tareas de hoy, pendientes y tareas sin terminar ayer."
            checked={prefs.emailDigest}
            onChange={(emailDigest) => save({ emailDigest })}
          />
          <Toggle
            label="Tareas que me asignan"
            hint="Recibe un correo cuando un compañero te asigne una tarea. También aparecerá en la bandeja de entrada."
            checked={prefs.emailAssigned}
            onChange={(emailAssigned) => save({ emailAssigned })}
          />
        </div>
      )}
    </section>
  );
}

function SlackSettings() {
  const settings = useQuery(api.notifications.slackSettings, {});
  const update = useMutation(api.notifications.updateSlack);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  if (settings === undefined) return <Skeleton className="h-24" />;
  if (settings === null) return null;

  const save = async (change: { webhookUrl?: string; postAssignments?: boolean; postDigest?: boolean }) => {
    setSaving(true);
    try {
      await update({
        postAssignments: change.postAssignments ?? settings.postAssignments,
        postDigest: change.postDigest ?? settings.postDigest,
        ...(change.webhookUrl !== undefined ? { webhookUrl: change.webhookUrl } : {}),
      });
      if (change.webhookUrl !== undefined) {
        setUrl("");
        showToast(change.webhookUrl ? "Webhook de Slack guardado." : "Webhook de Slack eliminado.");
      }
    } catch (e) {
      showToast(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim()) void save({ webhookUrl: url.trim() });
  };

  return (
    <section aria-labelledby="slack-heading">
      <h2 id="slack-heading" className="mb-2 font-medium">
        Slack
      </h2>
      <div className="space-y-3 card px-4 py-3">
        <p className="text-sm text-muted">
          {settings.configured
            ? "Este equipo publica en un canal de Slack mediante un webhook."
            : "Publica las novedades del equipo en un canal de Slack mediante un webhook."}
          {!settings.canEdit && " Solo los administradores del equipo pueden cambiar esto."}
        </p>
        {settings.canEdit && (
          <>
            <form onSubmit={onSubmit} className="flex flex-wrap gap-2">
              <label htmlFor="slack-url" className="sr-only">
                URL del webhook de Slack
              </label>
              <input
                id="slack-url"
                className="input min-w-0 flex-1"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  settings.configured
                    ? "Webhook guardado: pega otra URL para reemplazarlo"
                    : "https://hooks.slack.com/services/..."
                }
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <button type="submit" className="btn-primary" disabled={saving || !url.trim()}>
                Guardar
              </button>
              {settings.configured && (
                <button
                  type="button"
                  className="btn-outline"
                  disabled={saving}
                  onClick={() => void save({ webhookUrl: "" })}
                >
                  Eliminar
                </button>
              )}
            </form>
            <div>
              <Toggle
                label="Asignaciones"
                hint="Publicar cuando alguien asigne una tarea a un compañero."
                checked={settings.postAssignments}
                disabled={saving}
                onChange={(postAssignments) => void save({ postAssignments })}
              />
              <Toggle
                label="Resumen diario"
                hint="Publicar cada mañana el resumen de tareas del equipo."
                checked={settings.postDigest}
                disabled={saving}
                onChange={(postDigest) => void save({ postDigest })}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
