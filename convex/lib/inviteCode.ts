// Invite code format, shared by Convex and the UI. Keep free of server-only imports.

// No 0/O or 1/I/L, so codes survive being read aloud or copied by hand.
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 10;

// Choices offered to admins when creating a code.
export const INVITE_CODE_EXPIRY_DAYS = [1, 7, 30] as const;
export const MAX_INVITE_CODE_USES = 100;

/** Upper-cases and strips spaces and dashes, so "abcde-fghjk" and "ABCDE FGHJK" match. */
export function normalizeInviteCode(value: string): string {
  return value.toUpperCase().replace(/[\s-]+/g, "");
}

export function isInviteCode(value: string): boolean {
  return value.length === INVITE_CODE_LENGTH && [...value].every((c) => INVITE_CODE_ALPHABET.includes(c));
}

/** "ABCDEFGHJK" → "ABCDE-FGHJK". */
export function formatInviteCode(code: string): string {
  const half = Math.ceil(code.length / 2);
  return `${code.slice(0, half)}-${code.slice(half)}`;
}
