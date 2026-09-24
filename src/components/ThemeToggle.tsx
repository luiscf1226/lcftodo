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

/** Light / dark / system segmented control. The choice persists in localStorage (see lib/theme). */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, readThemePreference, () => "system" as const);

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
