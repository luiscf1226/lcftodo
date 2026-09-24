// Slack incoming webhooks (#25). The webhook URL is a secret: never log it and
// never return it to clients.

/** True only for https://hooks.slack.com/services/... URLs (no credentials, no custom port). */
export function isSlackWebhookUrl(value: string): boolean {
  if (!value || value.length > 500) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.hostname === "hooks.slack.com" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    /^\/services\/[A-Za-z0-9_/-]+$/.test(url.pathname)
  );
}

/** Escapes the three characters Slack's mrkdwn treats as control characters. */
export function slackEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Posts a plain-text message. Returns false (and logs without the URL) on failure. */
export async function postToSlack(webhookUrl: string, text: string, logTag: string): Promise<boolean> {
  if (!isSlackWebhookUrl(webhookUrl)) {
    console.warn(`[slack] skipped ${logTag}: stored webhook URL is not valid`);
    return false;
  }
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error(`[slack] ${logTag} failed with status ${res.status}`);
      return false;
    }
    return true;
  } catch {
    console.error(`[slack] ${logTag} request failed`);
    return false;
  }
}
