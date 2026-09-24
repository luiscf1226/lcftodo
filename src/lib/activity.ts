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
      return `added${t} for ${day(a.date)}`;
    case "updated":
      return a.from && a.to ? `renamed “${a.from}” to “${a.to}”` : `edited${t}`;
    case "status":
      return `marked${t} ${statusLabel(a.to)}${a.from ? ` (was ${statusLabel(a.from)})` : ""}`;
    case "moved":
      return `moved${t} from ${day(a.from)} to ${day(a.to)}`;
    case "carried_over":
      return `carried${t} over from ${day(a.from)} to ${day(a.to)}`;
    case "deleted":
      return `deleted${t}`;
    case "commented":
      return withTitle && a.todoTitle ? `commented on${t}` : "commented";
    case "project_created":
      return `created project ${a.projectName}`;
    case "project_updated":
      return a.from && a.to ? `renamed project “${a.from}” to “${a.to}”` : `edited project ${a.projectName}`;
    case "project_archived":
      return `archived project ${a.projectName}`;
    case "project_restored":
      return `restored project ${a.projectName}`;
    case "project_deleted":
      return `deleted project ${a.projectName}`;
    default:
      // Adding an action to ACTIONS without describing it here is a type error.
      return unreachable(a.action);
  }
}

function unreachable(action: never): string {
  return String(action);
}
