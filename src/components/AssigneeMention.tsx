"use client";

import clsx from "clsx";
import { X } from "lucide-react";
import { useId, useState, type KeyboardEvent, type RefObject } from "react";
import { matchMembers, mentionQuery, stripMention } from "@/lib/quickAdd";
import { Avatar } from "./Avatar";
import type { Id } from "../../convex/_generated/dataModel";
import { useAssignableMembers, type Member } from "./useMembers";

/**
 * "@name" assigning for quick-add inputs: typing "@" suggests team members, and picking one sets
 * the assignee and removes the mention from the title. Spread `inputProps` on the input, call
 * `onKeyDown` first from the input's key handler (it returns true when it handled the key), and
 * render <MentionSuggestions> in a relatively positioned wrapper around the input.
 */
export function useAssigneeMention(
  title: string,
  setTitle: (title: string) => void,
  inputRef: RefObject<HTMLInputElement | null>,
  // Only suggest people who can access this project (#46).
  projectId?: Id<"projects">,
) {
  const { members } = useAssignableMembers(projectId);
  const listId = useId();
  const [assigneeId, setAssigneeId] = useState<string>();
  // The highlighted suggestion, remembered per query so typing resets it to the top match.
  const [active, setActive] = useState({ query: "", index: 0 });
  // Esc hides the suggestions until the title changes again.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  const query = mentionQuery(title);
  const suggestions = query === undefined || dismissedFor === title ? [] : matchMembers(members, query);
  const open = suggestions.length > 0;
  const activeIndex = active.query === query ? Math.min(active.index, suggestions.length - 1) : 0;
  const optionId = (index: number) => `${listId}-${index}`;

  const select = (member: Member) => {
    setAssigneeId(member.id);
    setTitle(stripMention(title));
  };

  const onKeyDown = (e: KeyboardEvent): boolean => {
    if (!open) return false;
    const move = (by: number) =>
      setActive({ query: query ?? "", index: (activeIndex + by + suggestions.length) % suggestions.length });
    if (e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowUp") move(-1);
    else if (e.key === "Enter" || e.key === "Tab") select(suggestions[activeIndex]);
    else if (e.key === "Escape") setDismissedFor(title);
    else return false;
    e.preventDefault();
    return true;
  };

  return {
    assigneeId,
    assignee: members.find((m) => m.id === assigneeId),
    clearAssignee: () => {
      setAssigneeId(undefined);
      inputRef.current?.focus();
    },
    onKeyDown,
    inputProps: {
      role: "combobox",
      "aria-autocomplete": "list",
      "aria-expanded": open,
      "aria-controls": open ? listId : undefined,
      "aria-activedescendant": open ? optionId(activeIndex) : undefined,
    } as const,
    list: { id: listId, suggestions, activeIndex, optionId, select },
  };
}

type Mention = ReturnType<typeof useAssigneeMention>;

export function MentionSuggestions({ mention, className }: { mention: Mention; className?: string }) {
  const { id, suggestions, activeIndex, optionId, select } = mention.list;
  if (!suggestions.length) return null;
  return (
    <div
      id={id}
      role="listbox"
      aria-label="Asignar a"
      className={clsx(
        "absolute left-0 z-20 mt-1 w-full min-w-52 overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-lg",
        className,
      )}
    >
      {suggestions.map((member, index) => (
        <div
          key={member.id}
          id={optionId(index)}
          role="option"
          aria-selected={index === activeIndex}
          className={clsx(
            "flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm hover:bg-surface-2",
            index === activeIndex && "bg-surface-2",
          )}
          // Keep focus (and the on-screen keyboard) in the input when tapping a suggestion.
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => select(member)}
        >
          <Avatar member={member} size={20} />
          <span className="truncate">{member.name}</span>
        </div>
      ))}
    </div>
  );
}

/** Shows who the todo will be assigned to, with a button to undo it. */
export function AssigneeChip({ mention, className }: { mention: Mention; className?: string }) {
  const { assignee, clearAssignee } = mention;
  if (!assignee) return null;
  return (
    <span
      className={clsx(
        "inline-flex min-w-0 items-center gap-1 rounded-full bg-surface-2 py-0.5 pr-0.5 pl-1 text-xs text-muted",
        className,
      )}
    >
      <Avatar member={assignee} size={16} />
      <span className="truncate" title={`Asignada a ${assignee.name}`}>
        <span className="sr-only">Asignada a </span>
        {assignee.name.split(" ")[0]}
      </span>
      <button
        type="button"
        className="grid size-6 shrink-0 place-items-center rounded-full hover:bg-surface hover:text-fg"
        aria-label={`Quitar a ${assignee.name} como responsable`}
        onPointerDown={(e) => e.preventDefault()}
        onClick={clearAssignee}
      >
        <X className="size-3.5" />
      </button>
    </span>
  );
}
