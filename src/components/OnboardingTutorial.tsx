"use client";

import clsx from "clsx";
import { useMutation } from "convex/react";
import {
  ArrowLeft,
  ArrowRight,
  CircleHelp,
  CornerDownRight,
  FolderKanban,
  History,
  LayoutDashboard,
  Palette,
  Sparkles,
  SquarePen,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import { errorMessage } from "@/lib/errors";
import { STATUS_META, STATUSES } from "@/lib/status";
import { Modal } from "./Modal";

const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="rounded border border-line bg-surface-2 px-1 py-px font-mono text-[11px] text-fg">{children}</kbd>
);

type Step = { title: string; icon: LucideIcon; body: ReactNode };

const STEPS: Step[] = [
  {
    title: "Bienvenido a LCF Todos",
    icon: Sparkles,
    body: (
      <>
        <p>
          Planifica el trabajo del equipo día a día, revisa los avances y pasa las tareas pendientes al día siguiente.
        </p>
        <p>Este recorrido dura alrededor de un minuto y te muestra las funciones principales.</p>
      </>
    ),
  },
  {
    title: "Hoy",
    icon: LayoutDashboard,
    body: (
      <>
        <p>
          <strong>Hoy</strong> es tu pantalla principal: muestra las tareas de hoy, las pendientes y un resumen de esta
          semana por estado.
        </p>
        <p>
          Cambia entre <strong>Mis tareas</strong> y <strong>Todo el equipo</strong> arriba. Abre cualquier tarea para
          editar el título, las notas, el día o el responsable.
        </p>
      </>
    ),
  },
  {
    title: "Añadir tareas rápidamente",
    icon: SquarePen,
    body: (
      <>
        <p>
          Escribe en la barra de la parte superior de Hoy y pulsa <Kbd>Enter</Kbd>. El campo conserva el foco para que
          puedas añadir varias tareas seguidas.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Pega una lista de varias líneas para crear una tarea por línea.</li>
          <li>
            Pulsa <Kbd>/</Kbd> o <Kbd>n</Kbd> en Hoy para ir a la barra.
          </li>
          <li>Elige el proyecto junto al campo o abre más opciones para el día, el responsable y las notas.</li>
          <li>
            No hace falta un proyecto: una tarea sin proyecto es solo tuya y vive en la <strong>Bandeja</strong>, un
            calendario semanal donde también puedes crear y arrastrar tareas. Muévela a un proyecto cuando quieras desde
            su ventana de edición.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: "Proyectos y tablero semanal",
    icon: FolderKanban,
    body: (
      <>
        <p>
          Agrupa el trabajo en <strong>Proyectos</strong> identificados por color. Cada uno tiene un{" "}
          <strong>tablero semanal</strong>
          con una columna por día, de lunes a domingo.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Cambia de semana con las flechas o ve a una fecha.</li>
          <li>Añade tareas a un día y filtra el tablero por responsable.</li>
          <li>Edita, archiva o elimina un proyecto desde su menú.</li>
        </ul>
      </>
    ),
  },
  {
    title: "Estados y tareas pendientes",
    icon: CornerDownRight,
    body: (
      <>
        <p>Cada tarea tiene un estado. Puedes cambiarlo desde la etiqueta de la tarea.</p>
        <ul className="flex flex-wrap gap-2" aria-label="Estados">
          {STATUSES.map((s) => (
            <li
              key={s}
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                STATUS_META[s].pill,
              )}
            >
              <span className={clsx("size-1.5 rounded-full", STATUS_META[s].dot)} aria-hidden />
              {STATUS_META[s].label}
            </li>
          ))}
        </ul>
        <p>
          Al final del día, <strong>Pasar</strong> mueve las tareas pendientes al día siguiente y marca las originales
          como sin terminar.
        </p>
      </>
    ),
  },
  {
    title: "Historial",
    icon: History,
    body: (
      <>
        <p>
          <strong>Historial</strong> muestra lo que el equipo planificó, terminó y dejó pendiente. Filtra por fechas,
          proyecto o persona, y cambia entre Día a día, Personas y Actividad.
        </p>
        <p>
          Usa <strong>Exportar</strong> para descargar la vista actual como CSV, Excel o JSON.
        </p>
      </>
    ),
  },
  {
    title: "Tu equipo",
    icon: Users,
    body: (
      <>
        <p>
          Todo lo que ves pertenece al equipo actual. Cambia de equipo o crea uno nuevo desde el selector en la parte
          superior de la barra lateral.
        </p>
        <p>
          Abre <strong>Equipo</strong> para invitar compañeros por correo, administrar roles y editar la configuración.
        </p>
        <p>
          Los administradores pueden invitar personas a proyectos concretos y restringir el acceso. Los nuevos
          administradores verán una lista de configuración en <strong>Hoy</strong>.
        </p>
      </>
    ),
  },
  {
    title: "A tu gusto",
    icon: Palette,
    body: (
      <>
        <p>
          Usa el selector <strong>Tema</strong> para elegir Claro, Oscuro o Sistema, que sigue la configuración de tu
          dispositivo.
        </p>
        <p>
          Puedes volver a abrir este recorrido desde <strong>Tutorial</strong> en la barra lateral o con el botón{" "}
          <CircleHelp className="inline size-3.5 align-[-2px]" aria-label="ayuda" /> en el móvil.
        </p>
      </>
    ),
  },
];

/**
 * First-run tour. Only a Finish with the checkbox ticked persists completion (in Convex, so it
 * follows the user across devices). Closing or skipping just hides it until the next visit.
 */
export function OnboardingTutorial({
  open,
  completed,
  onClose,
}: {
  open: boolean;
  completed: boolean;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Primeros pasos">
      <Tutorial completed={completed} onClose={onClose} />
    </Modal>
  );
}

function Tutorial({ completed, onClose }: { completed: boolean; onClose: () => void }) {
  const completeOnboarding = useMutation(api.users.completeOnboarding);
  const [index, setIndex] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const checkboxId = useId();
  const stepLabelId = useId();

  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;
  const Icon = step.icon;

  // Move focus to the new step's heading so keyboard and screen reader users follow along.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [index]);

  async function finish() {
    if (!dontShowAgain || completed) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await completeOnboarding();
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, "No se pudo guardar. Inténtalo de nuevo."));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p id={stepLabelId} className="text-xs font-medium text-muted" aria-live="polite">
        Paso {index + 1} de {STEPS.length}
      </p>
      <ol className="flex gap-1.5" aria-labelledby={stepLabelId}>
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            aria-current={i === index ? "step" : undefined}
            className={clsx("h-1.5 flex-1 rounded-full transition-colors", i <= index ? "bg-accent" : "bg-surface-2")}
          >
            <span className="sr-only">
              {s.title}
              {i < index ? " (visto)" : ""}
            </span>
          </li>
        ))}
      </ol>

      <section className="min-h-52 space-y-3 text-sm leading-relaxed text-muted [&_strong]:font-medium [&_strong]:text-fg">
        <h3
          ref={headingRef}
          tabIndex={-1}
          className="flex items-center gap-2 text-base font-semibold text-fg outline-none"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-accent" aria-hidden>
            <Icon className="size-4" />
          </span>
          {step.title}
        </h3>
        {step.body}
      </section>

      {isLast && !completed && (
        <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
          <input
            id={checkboxId}
            type="checkbox"
            className="mt-0.5 size-4 accent-accent"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
          />
          <label htmlFor={checkboxId} className="text-sm text-fg">
            Terminé el tutorial. No volver a mostrarlo.
          </label>
        </div>
      )}
      {isLast && completed && (
        <p className="text-sm text-muted">Ya terminaste el tutorial. Puedes volver a abrirlo cuando quieras.</p>
      )}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        {index === 0 ? (
          <button type="button" className="btn-ghost text-muted" onClick={onClose}>
            Omitir por ahora
          </button>
        ) : (
          <button type="button" className="btn-ghost" onClick={() => setIndex(index - 1)} disabled={busy}>
            <ArrowLeft className="size-4" /> Atrás
          </button>
        )}
        {isLast ? (
          <button type="button" className="btn-primary" onClick={() => void finish()} disabled={busy}>
            {busy ? "Guardando…" : "Terminar"}
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={() => setIndex(index + 1)} data-autofocus>
            Siguiente <ArrowRight className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
