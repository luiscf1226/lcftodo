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

// An "@name" being typed at the end of the input (at the start or after a space, so emails don't match).
const MENTION = /(^|\s)@([^\s@]*)$/;

/** The text typed after a trailing "@", or undefined when the input doesn't end in a mention. */
export function mentionQuery(title: string): string | undefined {
  return title.match(MENTION)?.[2];
}

/** Removes the trailing "@mention" once someone has been picked from it. */
export function stripMention(title: string): string {
  return title.replace(MENTION, "$1").trimEnd();
}

/** Members whose name matches the mention, best matches (name or a word starts with it) first. */
export function matchMembers<M extends { name: string }>(members: M[], query: string, limit = 5): M[] {
  const q = query.toLocaleLowerCase();
  const rank = (name: string) => {
    const n = name.toLocaleLowerCase();
    if (n.startsWith(q)) return 0;
    if (n.split(/\s+/).some((word) => word.startsWith(q))) return 1;
    return n.includes(q) ? 2 : -1;
  };
  return members
    .map((member) => ({ member, rank: rank(member.name) }))
    .filter((m) => m.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((m) => m.member);
}
