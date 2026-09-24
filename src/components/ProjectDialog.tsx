"use client";

import clsx from "clsx";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { Doc } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { errorMessage } from "@/lib/errors";
import { LIMITS, PROJECT_COLORS } from "@/lib/status";
import { Modal } from "./Modal";

export function ProjectDialog({
  open,
  onClose,
  project,
}: {
  open: boolean;
  onClose: () => void;
  project?: Doc<"projects">;
}) {
  return (
    <Modal open={open} onClose={onClose} title={project ? "Editar proyecto" : "Nuevo proyecto"}>
      <ProjectForm key={project?._id ?? "new"} onClose={onClose} project={project} />
    </Modal>
  );
}

function ProjectForm({ onClose, project }: { onClose: () => void; project?: Doc<"projects"> }) {
  const router = useRouter();
  const create = useMutation(api.projects.create);
  const update = useMutation(api.projects.update);
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [color, setColor] = useState(project?.color ?? PROJECT_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (project) {
        await update({ projectId: project._id, name, description, color });
        onClose();
      } else {
        const id = await create({ name, description, color });
        onClose();
        router.push(`/app/projects/${id}`);
      }
    } catch (caught) {
      // Server validation messages (length, color) are meant to be shown as-is.
      setError(errorMessage(caught, "No se pudo guardar el proyecto. Inténtalo de nuevo."));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor="project-name">
          Nombre
        </label>
        <input
          id="project-name"
          autoFocus
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={LIMITS.projectName}
          required
          placeholder="Ej.: Rediseño del sitio web"
        />
      </div>
      <div>
        <label className="label" htmlFor="project-desc">
          Descripción
        </label>
        <textarea
          id="project-desc"
          className="min-h-16 input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={LIMITS.projectDescription}
          placeholder="Opcional"
        />
      </div>
      <fieldset>
        <legend className="label">Color</legend>
        <div className="flex flex-wrap gap-2">
          {PROJECT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className={clsx(
                "size-7 rounded-full ring-offset-2 ring-offset-surface transition",
                color === c && "ring-2 ring-fg",
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      </fieldset>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-outline" onClick={onClose}>
          Cancelar
        </button>
        <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
          {project ? "Guardar" : "Crear proyecto"}
        </button>
      </div>
    </form>
  );
}
