"use client";

import { useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Pencil, Trash2 } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { errorMessage } from "@/lib/errors";
import { LIMITS } from "@/lib/status";
import { Avatar } from "./Avatar";
import { showToast } from "./ToastViewport";
import { useMembers } from "./useMembers";

type Comment = NonNullable<ReturnType<typeof useQuery<typeof api.comments.list>>>[number];

// Realtime comment thread for a todo (#24). Rendered outside the todo form (no nested forms).
export function CommentThread({ todoId, readOnly }: { todoId: Id<"todos">; readOnly: boolean }) {
  const comments = useQuery(api.comments.list, { todoId });
  const { byId, nameOf } = useMembers(comments?.map((c) => c.authorId) ?? []);
  const add = useMutation(api.comments.add);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await add({ todoId, body });
      setBody("");
    } catch (err) {
      setError(errorMessage(err, "No se pudo publicar el comentario."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-t border-line pt-4" aria-labelledby="comments-heading">
      <h3 id="comments-heading" className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
        Comentarios{comments && comments.length > 0 ? ` (${comments.length})` : ""}
      </h3>
      {comments === undefined ? (
        <p className="text-sm text-muted">Cargando…</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted">Todavía no hay comentarios.</p>
      ) : (
        <ul className="max-h-64 space-y-3 overflow-y-auto text-sm">
          {comments.map((c) => (
            <CommentRow key={c._id} comment={c} author={byId.get(c.authorId)} authorName={nameOf(c.authorId)} />
          ))}
        </ul>
      )}
      {!readOnly && (
        <form onSubmit={submit} className="mt-3 space-y-2">
          <label htmlFor={`comment-${todoId}`} className="sr-only">
            Añadir comentario
          </label>
          <textarea
            id={`comment-${todoId}`}
            className="min-h-16 input"
            placeholder="Añade un comentario… (⌘/Ctrl + Enter para enviar)"
            value={body}
            maxLength={LIMITS.comment}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => submitOnModEnter(e, () => void submit())}
          />
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <button type="submit" className="btn-primary" disabled={busy || !body.trim()}>
              Comentar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function submitOnModEnter(e: KeyboardEvent, submit: () => void) {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    submit();
  }
}

function CommentRow({
  comment,
  author,
  authorName,
}: {
  comment: Comment;
  author?: Parameters<typeof Avatar>[0]["member"];
  authorName: string;
}) {
  const edit = useMutation(api.comments.edit);
  const remove = useMutation(api.comments.remove);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    try {
      await fn();
      return true;
    } catch (err) {
      showToast(errorMessage(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft.trim() || busy) return;
    if (await run(() => edit({ commentId: comment._id, body: draft }), "No se pudo guardar el comentario."))
      setEditing(false);
  }

  return (
    <li className="flex gap-2">
      <span className="mt-0.5">
        <Avatar member={author} size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{authorName}</span>
          <span className="text-xs text-muted">
            {formatDistanceToNow(comment._creationTime, { addSuffix: true, locale: es })}
            {comment.editedAt && " · editado"}
          </span>
          {!editing && (comment.canEdit || comment.canDelete) && (
            <span className="ml-auto flex gap-0.5">
              {comment.canEdit && (
                <button
                  type="button"
                  className="btn-ghost min-h-0 px-1 py-0.5"
                  aria-label="Editar comentario"
                  onClick={() => {
                    setDraft(comment.body);
                    setEditing(true);
                  }}
                >
                  <Pencil className="size-3.5" />
                </button>
              )}
              {comment.canDelete && (
                <button
                  type="button"
                  className="btn-ghost min-h-0 px-1 py-0.5 text-danger"
                  aria-label="Eliminar comentario"
                  disabled={busy}
                  onClick={() =>
                    void run(() => remove({ commentId: comment._id }), "No se pudo eliminar el comentario.")
                  }
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </span>
          )}
        </div>
        {editing ? (
          <div className="mt-1 space-y-1.5">
            <label htmlFor={`edit-${comment._id}`} className="sr-only">
              Editar comentario
            </label>
            <textarea
              id={`edit-${comment._id}`}
              autoFocus
              className="min-h-16 input"
              value={draft}
              maxLength={LIMITS.comment}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  // Cancel the edit instead of closing the whole <dialog>.
                  e.preventDefault();
                  setEditing(false);
                }
                submitOnModEnter(e, () => void save());
              }}
            />
            <div className="flex justify-end gap-1">
              <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setEditing(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary py-1 text-xs"
                disabled={busy || !draft.trim()}
                onClick={() => void save()}
              >
                Guardar
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-0.5 break-words whitespace-pre-wrap">{comment.body}</p>
        )}
      </div>
    </li>
  );
}
