"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";

type Toast = { id: number; message: string };
const EVENT = "lcf-todos:toast";

/** Show a brief, non-blocking message from any client component. */
export function showToast(message: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: message }));
}

export function ToastViewport() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const onToast = (event: Event) => {
      const message = (event as CustomEvent<string>).detail;
      if (!message) return;
      const toast = { id: Date.now() + Math.random(), message };
      setToasts((current) => [...current, toast].slice(-3));
      window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== toast.id)), 5000);
    };

    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:left-auto sm:w-96"
      aria-live="polite"
      aria-atomic="true"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className="pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-danger/30 bg-surface p-3 text-sm shadow-lg"
        >
          <p className="min-w-0 flex-1">{toast.message}</p>
          <button
            type="button"
            className="btn-ghost -m-1 shrink-0 p-1"
            aria-label="Dismiss message"
            onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
