"use client";

import { useMutation, useQuery } from "convex/react";
import { useMemo, useState, type FormEvent } from "react";
import { api } from "../../convex/_generated/api";
import { browserTimeZone } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { Skeleton } from "./PageHeader";
import { showToast } from "./ToastViewport";

type Settings = { timeZone: string | null; autoCarryOver: boolean; canEdit: boolean };

// Team time zone (#21) and nightly carry-over (#22). Admins edit; members see the values.
export function TeamSettings() {
  const settings = useQuery(api.teams.settings, {});
  if (settings === undefined) return <Skeleton className="mb-6 h-40" />;
  if (settings === null) return null;
  return <TeamSettingsForm key={`${settings.timeZone}:${settings.autoCarryOver}`} settings={settings} />;
}

function TeamSettingsForm({ settings }: { settings: Settings }) {
  const update = useMutation(api.teams.updateSettings);
  // Default to the admin's own browser zone until the team has one.
  const [timeZone, setTimeZone] = useState(() => settings.timeZone ?? browserTimeZone());
  const [autoCarryOver, setAutoCarryOver] = useState(settings.autoCarryOver);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(() => {
    const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return all.includes(timeZone) ? all : [timeZone, ...all];
  }, [timeZone]);
  const dirty = timeZone !== settings.timeZone || autoCarryOver !== settings.autoCarryOver;
  const disabled = !settings.canEdit || busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!dirty || disabled) return;
    setBusy(true);
    setError(null);
    try {
      await update({ timeZone, autoCarryOver });
      showToast("Configuración del equipo guardada.");
    } catch (caught) {
      setError(errorMessage(caught, "No se pudo guardar la configuración. Inténtalo de nuevo."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-6 space-y-4 card p-4">
      <div>
        <h2 className="text-sm font-semibold">Configuración del equipo</h2>
        <p className="text-xs text-muted">
          {settings.canEdit ? "Se aplica a todo el equipo." : "Solo los administradores pueden cambiar esto."}
        </p>
      </div>
      <div className="max-w-sm">
        <label className="label" htmlFor="team-tz">
          Zona horaria
        </label>
        <select
          id="team-tz"
          className="input"
          value={timeZone}
          disabled={disabled}
          onChange={(e) => setTimeZone(e.target.value)}
        >
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted">
          {settings.timeZone
            ? "La vista de hoy, el tablero semanal, el historial y las exportaciones usan esta zona."
            : "Sin configurar: cada persona ve los días según la zona horaria de su navegador."}
        </p>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-[var(--accent)]"
          checked={autoCarryOver}
          disabled={disabled}
          onChange={(e) => setAutoCarryOver(e.target.checked)}
        />
        <span>
          Pasar las tareas pendientes al día siguiente automáticamente
          <span className="block text-xs text-muted">
            Poco después de la medianoche en la zona horaria del equipo, las tareas pendientes pasan al día siguiente y
            las originales se marcan como &ldquo;sin terminar&rdquo;. Se omiten los proyectos archivados. En el
            historial aparece como &ldquo;Sistema&rdquo;.
          </span>
        </span>
      </label>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {settings.canEdit && (
        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={!dirty || busy}>
            {busy ? "Guardando…" : "Guardar configuración"}
          </button>
        </div>
      )}
    </form>
  );
}
