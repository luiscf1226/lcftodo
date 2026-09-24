// Signed, login-free unsubscribe tokens (#25): base64url(payload).base64url(HMAC-SHA256).
// Signed with NOTIFICATIONS_SIGNING_SECRET; without it no unsubscribe links are issued.

export const EMAIL_KINDS = ["digest", "assigned"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export const UNSUBSCRIBE_PATH = "/notifications/unsubscribe";

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function key(secret: string, usage: "sign" | "verify") {
  return await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

function signingSecret(): string | null {
  const secret = process.env.NOTIFICATIONS_SIGNING_SECRET;
  return secret && secret.length >= 16 ? secret : null;
}

export async function signUnsubscribeToken(userId: string, kind: EmailKind, secret = signingSecret()): Promise<string | null> {
  if (!secret) return null;
  const payload = encoder.encode(JSON.stringify({ u: userId, k: kind }));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret, "sign"), payload));
  return `${toBase64Url(payload)}.${toBase64Url(signature)}`;
}

export async function verifyUnsubscribeToken(
  token: string,
  secret = signingSecret(),
): Promise<{ userId: string; kind: EmailKind } | null> {
  if (!secret || token.length > 1000) return null;
  const [rawPayload, rawSignature, extra] = token.split(".");
  if (!rawPayload || !rawSignature || extra !== undefined) return null;
  const payload = fromBase64Url(rawPayload);
  const signature = fromBase64Url(rawSignature);
  if (!payload || !signature) return null;
  const valid = await crypto.subtle.verify("HMAC", await key(secret, "verify"), signature, payload);
  if (!valid) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(payload)) as { u?: unknown; k?: unknown };
    if (typeof data.u !== "string" || !data.u) return null;
    if (!(EMAIL_KINDS as readonly unknown[]).includes(data.k)) return null;
    return { userId: data.u, kind: data.k as EmailKind };
  } catch {
    return null;
  }
}

/** Absolute unsubscribe URL served by this deployment's HTTP actions, or null if unavailable. */
export async function unsubscribeUrl(userId: string, kind: EmailKind): Promise<string | null> {
  const site = process.env.CONVEX_SITE_URL;
  if (!site) return null;
  const token = await signUnsubscribeToken(userId, kind);
  if (!token) return null;
  return `${site.replace(/\/+$/, "")}${UNSUBSCRIBE_PATH}?token=${encodeURIComponent(token)}`;
}
