import type { Status } from "./status";

export type PersonStats = {
  id?: string;
  name: string;
  assigned: number;
  done: number;
  notDone: number;
  open: number;
};

export const UNASSIGNED = "Unassigned";

// Whole-number completion %, or null when nobody was assigned anything.
export const completion = (p: Pick<PersonStats, "assigned" | "done">) =>
  p.assigned ? Math.round((p.done / p.assigned) * 100) : null;

/**
 * Per-person totals for the History "People" tab and exports (#10).
 * Every current member gets a row (even with nothing assigned), plus an
 * Unassigned bucket; former members show up only when they have todos.
 * "Open" is anything not yet done or marked didn't-finish (to do + doing).
 */
export function peopleStats(
  todos: readonly { assigneeId?: string; status: Status }[],
  members: readonly { id: string; name: string }[],
  nameOf: (id: string) => string,
): PersonStats[] {
  const empty = (id: string | undefined, name: string): PersonStats => ({
    id,
    name,
    assigned: 0,
    done: 0,
    notDone: 0,
    open: 0,
  });
  const byPerson = new Map<string | undefined, PersonStats>();
  for (const member of members) byPerson.set(member.id, empty(member.id, member.name));
  byPerson.set(undefined, empty(undefined, UNASSIGNED));
  for (const todo of todos) {
    const id = todo.assigneeId || undefined;
    let person = byPerson.get(id);
    if (!person) byPerson.set(id, (person = empty(id, nameOf(id!))));
    person.assigned++;
    if (todo.status === "done") person.done++;
    else if (todo.status === "not_done") person.notDone++;
    else person.open++;
  }
  // Busiest first; Unassigned sorts with everyone else by count.
  return [...byPerson.values()].sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name));
}
