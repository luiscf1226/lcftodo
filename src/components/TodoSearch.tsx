"use client";

import clsx from "clsx";
import { useQuery } from "convex/react";
import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { api } from "../../convex/_generated/api";
import { Modal } from "@/components/Modal";
import { StatusPill } from "@/components/StatusSelect";
import { fmt, weekStart } from "@/lib/dates";
import { INBOX_PATH } from "@/lib/routes";

// Title search across the team's projects and weeks (#26). One <TodoSearch /> is mounted in the
// app shell; it opens on ⌘K / Ctrl+K or when any <SearchButton /> fires the open event.
const OPEN_EVENT = "lcf:open-search";

export const openSearch = () => window.dispatchEvent(new Event(OPEN_EVENT));

type Result = NonNullable<ReturnType<typeof useQuery<typeof api.search.todos>>>[number];

// Personal todos (no project) live on the inbox calendar.
export const resultHref = (r: Pick<Result, "projectId" | "date">) =>
  `${r.projectId ? `/app/projects/${r.projectId}` : INBOX_PATH}?week=${weekStart(r.date)}`;

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// "⌘K" on Apple devices, "Ctrl K" elsewhere; server render assumes ⌘ until hydrated.
function useShortcutLabel() {
  return useSyncExternalStore(
    () => () => {},
    () => (isMac() ? "⌘K" : "Ctrl K"),
    () => "⌘K",
  );
}

export function SearchButton({ compact = false }: { compact?: boolean }) {
  const shortcut = useShortcutLabel();
  if (compact) {
    return (
      <button
        type="button"
        onClick={openSearch}
        className="btn-ghost p-1.5 text-muted"
        aria-label="Buscar tareas"
        title={`Buscar (${shortcut})`}
      >
        <Search className="size-5" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={openSearch}
      className="flex w-full items-center gap-2.5 rounded-lg border border-line px-2.5 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
    >
      <Search className="size-4" /> <span className="flex-1 text-left">Buscar</span>
      <kbd className="rounded border border-line px-1 font-sans text-[11px]">{shortcut}</kbd>
    </button>
  );
}

export function TodoSearch() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((value) => !value);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Buscar tareas">
      {/* Only mounted while open, so every open starts with a blank query. */}
      <SearchBody onDone={() => setOpen(false)} />
    </Modal>
  );
}

function SearchBody({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const listId = useId();
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);

  // Debounce keystrokes so we query once the user pauses typing.
  useEffect(() => {
    const id = setTimeout(() => setTerm(text.trim()), 150);
    return () => clearTimeout(id);
  }, [text]);

  const results = useQuery(api.search.todos, term ? { query: term } : "skip");
  const pending = text.trim() !== term || (term !== "" && results === undefined);
  const count = results?.length ?? 0;
  const current = Math.min(active, Math.max(count - 1, 0));

  function onKeyDown(e: ReactKeyboardEvent) {
    if (!results?.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((current + (e.key === "ArrowDown" ? 1 : count - 1)) % count);
    } else if (e.key === "Enter") {
      e.preventDefault();
      router.push(resultHref(results[current]));
      onDone();
    }
  }

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <input
          data-autofocus
          type="search"
          className="input pl-9"
          placeholder="Buscar por título…"
          aria-label="Buscar tareas por título"
          role="combobox"
          aria-expanded={count > 0}
          aria-controls={listId}
          aria-activedescendant={count ? `${listId}-${current}` : undefined}
          autoComplete="off"
          enterKeyHint="search"
          maxLength={100}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>

      <div className="mt-3 max-h-[60dvh] overflow-y-auto" aria-live="polite">
        {!text.trim() ? (
          <p className="px-1 py-6 text-center text-sm text-muted">
            Busca una tarea por título en cualquier proyecto y semana.
          </p>
        ) : pending && !results ? (
          <p className="px-1 py-6 text-center text-sm text-muted">Buscando…</p>
        ) : count === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-muted">No hay tareas que coincidan con “{term}”.</p>
        ) : (
          <ul
            id={listId}
            role="listbox"
            aria-label="Resultados de búsqueda"
            className={clsx("space-y-0.5", pending && "opacity-60")}
          >
            {results!.map((r, i) => (
              <li key={r._id} id={`${listId}-${i}`} role="option" aria-selected={i === current}>
                <Link
                  href={resultHref(r)}
                  onClick={onDone}
                  onMouseMove={() => setActive(i)}
                  className={clsx(
                    "flex flex-col gap-1 rounded-lg px-3 py-2 text-sm",
                    i === current ? "bg-surface-2" : "hover:bg-surface-2",
                  )}
                >
                  <span className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 font-medium break-words">{r.title}</span>
                    <StatusPill status={r.status} />
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <span className="inline-flex items-center gap-1">
                      <span className="size-2 rounded-full" style={{ background: r.projectColor }} /> {r.projectName}
                      {r.projectArchived && " (archivado)"}
                    </span>
                    <span>·</span>
                    <time dateTime={r.date}>{fmt(r.date, "EEE, MMM d, yyyy")}</time>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-2 hidden text-[11px] text-muted sm:block">
        ↑↓ para moverte · Enter para abrir la semana · Esc para cerrar
      </p>
    </div>
  );
}
