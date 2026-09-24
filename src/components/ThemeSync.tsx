"use client";

import { useLayoutEffect } from "react";
import { THEME_CHANGE_EVENT, THEME_STORAGE_KEY, applyThemePreference, readThemePreference } from "@/lib/theme";

/**
 * Keeps <html> in sync with the stored theme on every page (not just where the toggle is shown):
 * re-applies after React's dev Strict Mode remount resets <html> attributes, follows OS changes
 * while on "system", and picks up changes made in other tabs.
 */
export function ThemeSync() {
  useLayoutEffect(() => {
    const sync = () => applyThemePreference(readThemePreference());
    sync();

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      sync();
      window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
    };
    media.addEventListener("change", sync);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return null;
}
