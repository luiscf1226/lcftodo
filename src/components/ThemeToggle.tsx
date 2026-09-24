"use client";

import { useEffect, useSyncExternalStore } from "react";

const EVENT = "lcf-todos:theme-change";
type Theme = "light" | "dark" | "system";

function getTheme(): Theme {
  const value = window.localStorage.getItem("lcf-todos:theme");
  return value === "light" || value === "dark" ? value : "system";
}

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches));
}

function setTheme(theme: Theme) {
  window.localStorage.setItem("lcf-todos:theme", theme);
  applyTheme(theme);
  window.dispatchEvent(new Event(EVENT));
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getTheme, () => "system");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => applyTheme(getTheme());
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return (
    <label className="flex items-center gap-2 px-1 text-xs text-muted">
      <span>Theme</span>
      <select
        aria-label="Theme"
        className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs text-fg focus:outline-2 focus:outline-accent"
        value={theme}
        onChange={(event) => setTheme(event.target.value as Theme)}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
