// Theme preference shared by the pre-paint inline script (root layout), ThemeSync and ThemeToggle.
// The script is a string, so it cannot import this module: it is built from these constants below.

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "lcf-todos:theme";
export const THEME_CHANGE_EVENT = "lcf-todos:theme-change";
export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

/** Browser UI color (status bar / title bar) per resolved theme; matches `--bg` in globals.css. */
export const THEME_COLORS: Record<ResolvedTheme, string> = { light: "#f7f7f8", dark: "#0c0c10" };

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

export function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

const systemPrefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

/** Reflects a preference on <html> (data-theme + .dark class) and the theme-color meta tags. */
export function applyThemePreference(preference: ThemePreference) {
  const root = document.documentElement;
  const resolved = resolveTheme(preference, systemPrefersDark());
  root.dataset.theme = preference;
  root.classList.toggle("dark", resolved === "dark");
  // An explicit choice must win over the OS-driven `media` theme-color tags from the viewport export.
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.content =
      preference === "system" ? THEME_COLORS[meta.media.includes("dark") ? "dark" : "light"] : THEME_COLORS[resolved];
  });
}

export function saveThemePreference(preference: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable (private mode, quota); the choice still applies to this page.
  }
  applyThemePreference(preference);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

/**
 * Runs synchronously in <head> before first paint so the stored theme never flashes.
 * Keep in sync with applyThemePreference (it cannot be imported into a string).
 */
export const themeInitScript = `(function(){try{var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(p!=="light"&&p!=="dark")p="system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.dataset.theme=p;r.classList.toggle("dark",d);}catch(e){document.documentElement.dataset.theme="system";}})();`;
