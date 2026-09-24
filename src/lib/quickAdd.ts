/** One title per non-empty line, so pasting a list creates one todo per line. */
export function splitTitles(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ xX]?\])\s+/, "").trim())
    .filter(Boolean);
}

/** True when a key press should jump to the quick-add input ("/" or "n" outside a text field). */
export function isQuickAddShortcut(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "target">) {
  if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== "/" && e.key !== "n")) return false;
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  return !(t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? ""));
}
