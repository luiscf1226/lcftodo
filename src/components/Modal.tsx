"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // showModal focuses the first focusable element (the close button); content can opt a
      // better starting point in with data-autofocus.
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-line bg-surface p-0 text-fg shadow-xl backdrop:bg-black/40 backdrop:backdrop-blur-[2px]"
    >
      {open && (
        <div className="p-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
            <button type="button" onClick={onClose} className="btn-ghost -mr-2 p-1.5" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
