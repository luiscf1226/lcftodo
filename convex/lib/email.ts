// Email delivery through Resend's REST API (#25).
// Without RESEND_API_KEY every send is a logged no-op so dev and preview
// deployments work without an email provider. Logs carry user ids only.

export const DEFAULT_FROM = "LCF Todos <onboarding@resend.dev>";
const RESEND_URL = "https://api.resend.com/emails";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Resend de-duplicates requests with the same key for 24 hours. */
  idempotencyKey: string;
  headers?: Record<string, string>;
};

export type SendResult = "sent" | "disabled" | "failed";

export async function sendEmail(message: EmailMessage, logTag: string): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[email] RESEND_API_KEY is not set; skipped ${logTag}`);
    return "disabled";
  }
  const from = process.env.NOTIFICATIONS_FROM?.trim() || DEFAULT_FROM;
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": message.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: message.headers,
      }),
    });
    if (!res.ok) {
      console.error(`[email] Resend returned ${res.status} for ${logTag}`);
      return "failed";
    }
    return "sent";
  } catch {
    console.error(`[email] Resend request failed for ${logTag}`);
    return "failed";
  }
}

/** Escapes text for safe interpolation into HTML (element content and quoted attributes). */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The public web app URL for links in emails, if configured (APP_URL). */
export function appUrl(path = ""): string | null {
  const base = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (!base || !/^https?:\/\//.test(base)) return null;
  return `${base}${path}`;
}
