import type { Doc } from "../../convex/_generated/dataModel";
import { fmt } from "./dates";
import { STATUS_META, type Status } from "./status";

const statusLabel = (s?: string) => (s && s in STATUS_META ? STATUS_META[s as Status].label : (s ?? ""));
const day = (d?: string) => (d ? fmt(d, "EEE, MMM d") : "");

// Human sentence for an activity entry, without the actor's name.
export function describe(a: Doc<"activity">, { withTitle = true } = {}) {
  const t = withTitle && a.todoTitle ? ` “${a.todoTitle}”` : "";
  switch (a.action) {
    case "created":
      return `añadió${t} para el ${day(a.date)}`;
    case "updated":
      return a.from && a.to ? `cambió el nombre de “${a.from}” a “${a.to}”` : `editó${t}`;
    case "status":
      return `marcó${t} como ${statusLabel(a.to)}${a.from ? ` (antes: ${statusLabel(a.from)})` : ""}`;
    case "moved":
      return `movió${t} del ${day(a.from)} al ${day(a.to)}`;
    case "project_changed":
      return a.from
        ? `movió${t} del proyecto “${a.from}” a “${a.to}”`
        : `movió${t} de sus tareas sin proyecto al proyecto “${a.to}”`;
    case "carried_over":
      return `pasó${t} del ${day(a.from)} al ${day(a.to)}`;
    case "deleted":
      return `eliminó${t}`;
    case "commented":
      return withTitle && a.todoTitle ? `comentó en${t}` : "comentó";
    case "project_created":
      return `creó el proyecto ${a.projectName}`;
    case "project_updated":
      return a.from && a.to
        ? `cambió el nombre del proyecto “${a.from}” a “${a.to}”`
        : `editó el proyecto ${a.projectName}`;
    case "project_archived":
      return `archivó el proyecto ${a.projectName}`;
    case "project_restored":
      return `restauró el proyecto ${a.projectName}`;
    case "project_deleted":
      return `eliminó el proyecto ${a.projectName}`;
    default:
      // Adding an action to ACTIONS without describing it here is a type error.
      return unreachable(a.action);
  }
}

function unreachable(action: never): string {
  return String(action);
}
