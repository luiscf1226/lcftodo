"use client";

import { useMutation } from "convex/react";
import { Plus, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { errorMessage } from "@/lib/errors";
import { isQuickAddShortcut, splitTitles } from "@/lib/quickAdd";
import { LIMITS } from "@/lib/status";
import { showToast } from "./ToastViewport";

type Props = {
  date: string;
  projects: Array<{ _id: Id<"projects">; name: string; color: string }>;
  projectId: Id<"projects">;
  onProjectIdChange: (projectId: Id<"projects">) => void;
  onMore: () => void;
};

/**
 * Always-visible "type and press Enter" bar for today's todos. The input stays
 * focused after each add, a pasted multi-line list becomes one todo per line,
 * and "/" or "n" jumps here from anywhere on the page.
 */
export function TodayQuickAdd({ date, projects, projectId, onProjectIdChange, onMore }: Props) {
  const create = useMutation(api.todos.create);
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const project = projects.find((p) => p._id === projectId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isQuickAddShortcut(e)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function add(raw: string) {
    const titles = splitTitles(raw);
    if (!titles.length || busy) return;
    setBusy(true);
    let added = 0;
    try {
      // Sequential so pasted lists keep their order on the board.
      for (const t of titles) {
        await create({ projectId, date, title: t });
        added++;
      }
      setTitle("");
    } catch (error) {
      // Keep the todo that failed in the input so it can be retried.
      setTitle(titles[added]);
      const message = errorMessage(error, "Couldn't add the todo.");
      showToast(added ? `Added ${added} of ${titles.length}. ${message}` : message);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (splitTitles(text).length < 2) return;
    e.preventDefault();
    void add(`${title}${text}`);
  };

  return (
    <form
      className="card mb-6 flex items-center gap-2 p-2 focus-within:border-accent"
      onSubmit={(e) => {
        e.preventDefault();
        void add(title);
      }}
    >
      <span className="size-2.5 shrink-0 rounded-full ml-1.5" style={{ background: project?.color }} aria-hidden />
      <input
        ref={inputRef}
        className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-muted"
        placeholder="Add a todo for today… press Enter"
        aria-label="New todo for today"
        aria-keyshortcuts="/ n"
        value={title}
        maxLength={LIMITS.todoTitle}
        enterKeyHint="done"
        onChange={(e) => setTitle(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setTitle("");
            e.currentTarget.blur();
          }
        }}
      />
      {projects.length > 1 && (
        <select
          className="max-w-36 truncate rounded-md bg-transparent px-1.5 py-1 text-xs text-muted hover:bg-surface-2"
          aria-label="Project"
          value={projectId}
          onChange={(e) => onProjectIdChange(e.target.value as Id<"projects">)}
        >
          {projects.map((p) => (
            <option key={p._id} value={p._id}>{p.name}</option>
          ))}
        </select>
      )}
      <button type="button" className="btn-ghost px-2 text-muted" onClick={onMore} aria-label="More options" title="More options (day, assignee, notes)">
        <SlidersHorizontal className="size-4" />
      </button>
      <button type="submit" className="btn-primary px-2.5" disabled={busy || !title.trim()} aria-label="Add todo">
        <Plus className="size-4" />
      </button>
    </form>
  );
}
