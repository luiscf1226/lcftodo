"use client";

import clsx from "clsx";
import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { THEME_CHANGE_EVENT, readThemePreference, saveThemePreference, type ThemePreference } from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

function subscribe(callback: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, callback);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, callback);
}

/**
 * Light / dark / system switch; the choice persists in localStorage (see lib/theme).
 * `compact` renders one icon button that cycles System → Light → Dark (for tight mobile headers).
 */
export function ThemeToggle({ className, compact = false }: { className?: string; compact?: boolean }) {
  const theme = useSyncExternalStore(subscribe, readThemePreference, () => "system" as const);

  if (compact) {
    const index = OPTIONS.findIndex((option) => option.value === theme);
    const { label, icon: Icon } = OPTIONS[index];
    const next = OPTIONS[(index + 1) % OPTIONS.length];
    return (
      <button
        type="button"
        onClick={() => saveThemePreference(next.value)}
        className={clsx("btn-ghost p-1.5 text-muted", className)}
        aria-label={`Theme: ${label}. Switch to ${next.label.toLowerCase()}`}
        title={`Theme: ${label}`}
      >
        <Icon className="size-5" aria-hidden />
      </button>
    );
  }

  return (
    <div role="group" aria-label="Theme" className={clsx("inline-flex rounded-lg border border-line bg-surface-2 p-0.5", className)}>
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const checked = theme === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={checked}
            aria-label={`${label} theme`}
            title={`${label} theme`}
            onClick={() => saveThemePreference(value)}
            className={clsx(
              "grid size-7 place-items-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-accent",
              checked ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
