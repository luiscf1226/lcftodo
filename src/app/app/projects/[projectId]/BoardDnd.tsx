"use client";

// Drag & drop for the week board (#13): drag a todo between day columns or
// reorder it within a day. Pointer (mouse/touch) dragging uses the grip handle;
// keyboard users can pick the handle up with Space/Enter and use the arrow keys,
// or use the "Move" menu next to it (up / down / previous day / next day).

import clsx from "clsx";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation } from "convex/react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, GripVertical } from "lucide-react";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { api } from "../../../../../convex/_generated/api";
import { orderAt, orderBetween } from "../../../../../convex/lib/ordering";
import { Menu, MenuItem } from "@/components/Menu";
import { showToast } from "@/components/ToastViewport";
import { fmt, shiftDays } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";

type Todo = Doc<"todos">;
type Columns = Map<string, Todo[]>;
type MoveArgs = { todoId: Id<"todos">; date: string; order: number };

const DAY_PREFIX = "day:";
const dayName = (day: string) => fmt(day, "EEEE");

/** `todos.move` with an optimistic update, so the board reorders instantly. Convex rolls it back on error. */
export function useMoveTodo() {
  const move = useMutation(api.todos.move).withOptimisticUpdate((store, { todoId, date, order }) => {
    for (const { args, value } of store.getAllQueries(api.todos.listForProject)) {
      const todo = value?.find((t) => t._id === todoId);
      if (!value || !todo) continue;
      const rest = value.filter((t) => t._id !== todoId);
      const next = date >= args.from && date <= args.to ? [...rest, { ...todo, date, order }] : rest;
      store.setQuery(api.todos.listForProject, args, next.sort((a, b) => a.order - b.order));
    }
    for (const { args, value } of store.getAllQueries(api.todos.listForTeam)) {
      const todo = value?.find((t) => t._id === todoId);
      if (!value || !todo) continue;
      const rest = value.filter((t) => t._id !== todoId);
      const next = date >= args.from && date <= args.to ? [...rest, { ...todo, date, order }] : rest;
      store.setQuery(api.todos.listForTeam, args, next.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order));
    }
  });
  /** Resolves to whether the move was saved; failures are shown as a toast. */
  return async (args: MoveArgs) => {
    try {
      await move(args);
      return true;
    } catch (error) {
      showToast(errorMessage(error, "Couldn't move the todo."));
      return false;
    }
  };
}

// Screen-reader announcements for moves made from the "Move" menu.
const AnnounceContext = createContext<(message: string) => void>(() => {});

function locate(columns: Columns, id: UniqueIdentifier): { day: string; index: number } | null {
  const key = String(id);
  if (key.startsWith(DAY_PREFIX)) {
    const day = key.slice(DAY_PREFIX.length);
    return columns.has(day) ? { day, index: columns.get(day)!.length } : null;
  }
  for (const [day, list] of columns) {
    const index = list.findIndex((t) => t._id === key);
    if (index >= 0) return { day, index };
  }
  return null;
}

/**
 * Wraps the board's columns. `children` receives the columns to render: the
 * server's `byDay` normally, or the in-progress arrangement while dragging.
 */
export function BoardDnd({
  byDay,
  disabled,
  children,
}: {
  byDay: Columns;
  disabled?: boolean;
  children: (columns: Columns) => ReactNode;
}) {
  const move = useMoveTodo();
  // The arrangement while a drag is in progress; null otherwise.
  const [dragging, setDragging] = useState<{ todo: Todo; columns: Columns } | null>(null);
  const columns = dragging?.columns ?? byDay;
  const [announcement, setAnnouncement] = useState("");

  const sensors = useSensors(
    // A small distance lets a plain click/tap on the handle through; the handle
    // is `touch-action: none` so touch drags start from it without scrolling.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const titleOf = (id: UniqueIdentifier) =>
    [...byDay.values()].flat().find((t) => t._id === id)?.title ?? "todo";

  const describe = (over: { id: UniqueIdentifier } | null) => {
    if (!over || !dragging) return undefined;
    const at = locate(dragging.columns, over.id);
    if (!at) return undefined;
    const size = dragging.columns.get(at.day)?.length ?? 0;
    return `${dayName(at.day)}, position ${Math.min(at.index + 1, Math.max(size, 1))} of ${Math.max(size, 1)}`;
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}.`,
    onDragOver: ({ active, over }) => {
      const where = describe(over);
      return where ? `${titleOf(active.id)} is over ${where}.` : `${titleOf(active.id)} is no longer over a day.`;
    },
    onDragEnd: ({ active, over }) => {
      const where = describe(over);
      return where ? `Dropped ${titleOf(active.id)} on ${where}.` : `Dropped ${titleOf(active.id)}.`;
    },
    onDragCancel: ({ active }) => `Moving ${titleOf(active.id)} was cancelled.`,
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    const todo = [...byDay.values()].flat().find((t) => t._id === active.id);
    if (todo) setDragging({ todo, columns: new Map([...byDay].map(([d, list]) => [d, [...list]])) });
  };

  // Move the item into the column it's hovering so the target column opens a gap.
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    setDragging((current) => {
      if (!current) return current;
      const from = locate(current.columns, active.id);
      const to = locate(current.columns, over.id);
      if (!from || !to || from.day === to.day) return current;
      const next = new Map(current.columns);
      const source = [...next.get(from.day)!];
      const [item] = source.splice(from.index, 1);
      const target = [...next.get(to.day)!];
      target.splice(Math.min(to.index, target.length), 0, item);
      next.set(from.day, source);
      next.set(to.day, target);
      return { ...current, columns: next };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const state = dragging;
    setDragging(null);
    if (!over || !state) return;
    const from = locate(state.columns, active.id);
    const to = locate(state.columns, over.id);
    if (!from || !to) return;
    const source = state.columns.get(from.day)!;
    // Usually onDragOver already put the item in the target column; this only
    // reorders within it (or finishes a cross-column move if that was skipped).
    let list: Todo[];
    if (from.day === to.day) {
      list = to.index < source.length ? arrayMove(source, from.index, to.index) : source;
    } else {
      list = [...state.columns.get(to.day)!];
      list.splice(to.index, 0, source[from.index]);
    }
    const index = list.findIndex((t) => t._id === active.id);

    const original = byDay.get(state.todo.date) ?? [];
    if (to.day === state.todo.date && original[index]?._id === state.todo._id) return;
    const rest = list.filter((t) => t._id !== active.id);
    void move({ todoId: state.todo._id, date: to.day, order: orderAt(rest, index) });
  };

  return (
    <DndContext
      id="week-board"
      sensors={disabled ? [] : sensors}
      collisionDetection={closestCorners}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "To move a todo, press Space or Enter on its handle, then use the arrow keys to move it within a day or to another day. Press Space or Enter again to drop it, or Escape to cancel. The Move menu next to the handle offers the same moves.",
        },
      }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <AnnounceContext value={setAnnouncement}>{children(columns)}</AnnounceContext>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      <DragOverlay>
        {dragging && (
          <div className="rounded-lg border border-accent/60 bg-surface px-3 py-2 text-sm shadow-lg">
            {dragging.todo.title}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** A day's list: a sortable context plus a drop target so empty days accept drops. */
export function DayList({ day, items, children }: { day: string; items: Todo[]; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${DAY_PREFIX}${day}` });
  const ids = useMemo(() => items.map((t) => t._id), [items]);
  return (
    <SortableContext id={day} items={ids} strategy={verticalListSortingStrategy}>
      <div ref={setNodeRef} className={clsx("flex min-h-8 flex-col gap-1.5 rounded-lg", isOver && items.length === 0 && "bg-accent/10")}>
        {children}
      </div>
    </SortableContext>
  );
}

/**
 * A draggable todo with its grip handle and keyboard "Move" menu. `columns` is
 * what the board currently shows, used to work out neighbours for each move.
 */
export function SortableTodo({
  todo,
  day,
  columns,
  readOnly,
  children,
}: {
  todo: Todo;
  day: string;
  columns: Columns;
  readOnly?: boolean;
  children: ReactNode;
}) {
  const move = useMoveTodo();
  const announce = useContext(AnnounceContext);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: todo._id,
    disabled: readOnly,
  });

  if (readOnly) return <>{children}</>;

  const list = columns.get(day) ?? [];
  const index = list.findIndex((t) => t._id === todo._id);
  const rest = list.filter((t) => t._id !== todo._id);
  const moveWithin = async (to: number) => {
    if (await move({ todoId: todo._id, date: day, order: orderAt(rest, to) })) {
      announce(`Moved ${todo.title} to position ${to + 1} of ${list.length} on ${dayName(day)}.`);
    }
  };
  const moveToDay = async (target: string) => {
    const other = columns.get(target);
    // Append to the end of the target day. Outside this week we can't see its
    // todos, and a timestamp sorts after every existing order.
    const order = other ? orderBetween(other.at(-1)?.order, undefined) : Date.now();
    if (await move({ todoId: todo._id, date: target, order })) {
      announce(`Moved ${todo.title} to ${fmt(target, "EEEE, MMM d")}.`);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={clsx("flex items-start gap-0.5", isDragging && "opacity-40")}
    >
      <div className="flex shrink-0 flex-col items-center pt-1.5">
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="grid h-7 w-5 cursor-grab touch-none place-items-center rounded text-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-accent active:cursor-grabbing"
          aria-label={`Drag ${todo.title}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <Menu
          label={<span aria-hidden className="text-[10px] leading-none">•••</span>}
          aria-label={`Move ${todo.title}`}
          triggerClassName="grid h-5 w-5 place-items-center rounded text-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
          menuClassName="left-0 right-auto! w-44"
        >
          <MenuItem disabled={index <= 0} onSelect={() => void moveWithin(index - 1)}>
            <ArrowUp className="size-4" /> Move up
          </MenuItem>
          <MenuItem disabled={index < 0 || index >= list.length - 1} onSelect={() => void moveWithin(index + 1)}>
            <ArrowDown className="size-4" /> Move down
          </MenuItem>
          <MenuItem onSelect={() => void moveToDay(shiftDays(day, -1))}>
            <ArrowLeft className="size-4" /> Previous day
          </MenuItem>
          <MenuItem onSelect={() => void moveToDay(shiftDays(day, 1))}>
            <ArrowRight className="size-4" /> Next day
          </MenuItem>
        </Menu>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
