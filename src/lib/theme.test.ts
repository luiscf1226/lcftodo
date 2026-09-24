import { describe, expect, it } from "vitest";
import tokens from "../../design-tokens.json";
import { THEME_COLORS, THEME_STORAGE_KEY, parseThemePreference, resolveTheme, themeInitScript } from "./theme";

function runInitScript(stored: string | null, systemDark: boolean, storageThrows = false) {
  const classes = new Set<string>();
  const root = {
    dataset: {} as Record<string, string>,
    classList: { toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)) },
  };
  const localStorage = {
    getItem: (key: string) => {
      if (storageThrows) throw new Error("SecurityError");
      return key === THEME_STORAGE_KEY ? stored : null;
    },
  };
  const matchMedia = () => ({ matches: systemDark });
  new Function("localStorage", "matchMedia", "document", themeInitScript)(localStorage, matchMedia, { documentElement: root });
  return { theme: root.dataset.theme, dark: classes.has("dark") };
}

describe("theme preference", () => {
  it("parses stored values, defaulting to system", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
    expect(parseThemePreference("purple")).toBe("system");
  });

  it("resolves system against the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("keeps browser UI colors in sync with the design tokens", () => {
    expect(THEME_COLORS.light).toBe(tokens.color.light.background);
    expect(THEME_COLORS.dark).toBe(tokens.color.dark.background);
  });
});

describe("pre-paint theme script", () => {
  it("applies an explicit choice regardless of the OS", () => {
    expect(runInitScript("dark", false)).toEqual({ theme: "dark", dark: true });
    expect(runInitScript("light", true)).toEqual({ theme: "light", dark: false });
  });

  it("follows the OS when nothing (or garbage) is stored", () => {
    expect(runInitScript(null, true)).toEqual({ theme: "system", dark: true });
    expect(runInitScript("nope", false)).toEqual({ theme: "system", dark: false });
  });

  it("falls back to system when storage is unavailable", () => {
    expect(runInitScript(null, false, true)).toEqual({ theme: "system", dark: false });
  });
});
