// Email and Slack message bodies for notifications (#25). All user-provided text is escaped.
import { escapeHtml } from "./email";
import { DIGEST_SECTION_LIMIT, type Digest, type DigestItem } from "./notify";
import { slackEscape } from "./slack";

type Rendered = { subject: string; html: string; text: string };

const STATUS_LABEL: Record<DigestItem["status"], string> = {
  todo: "To do", doing: "In progress", done: "Done", not_done: "Didn't finish",
};

function footer(links: { app: string | null; unsubscribe: string | null }, what: string) {
  const html: string[] = [];
  const text: string[] = [];
  if (links.app) {
    html.push(`<a href="${escapeHtml(links.app)}">Open LCF Todos</a>`);
    text.push(`Open LCF Todos: ${links.app}`);
  }
  if (links.unsubscribe) {
    html.push(`<a href="${escapeHtml(links.unsubscribe)}">Unsubscribe from ${what}</a>`);
    text.push(`Unsubscribe from ${what}: ${links.unsubscribe}`);
  } else {
    html.push(`You can turn off ${what} in Notifications settings.`);
    text.push(`You can turn off ${what} in Notifications settings.`);
  }
  return {
    html: `<p style="margin-top:24px;font-size:12px;color:#64748b">${html.join(" · ")}</p>`,
    text: `\n--\n${text.join("\n")}`,
  };
}

function section(title: string, items: DigestItem[], showDate: boolean) {
  if (items.length === 0) return { html: "", text: "" };
  const shown = items.slice(0, DIGEST_SECTION_LIMIT);
  const more = items.length - shown.length;
  const line = (i: DigestItem) =>
    `${i.title} — ${i.project}${showDate ? ` (${i.date})` : ""}${i.status === "doing" ? ` [${STATUS_LABEL.doing}]` : ""}`;
  const html =
    `<h3 style="margin:20px 0 6px;font-size:15px">${escapeHtml(title)} (${items.length})</h3><ul style="margin:0;padding-left:20px">` +
    shown.map((i) => `<li>${escapeHtml(line(i))}</li>`).join("") +
    (more > 0 ? `<li>+${more} more</li>` : "") +
    `</ul>`;
  const text = `\n${title} (${items.length})\n` + shown.map((i) => `- ${line(i)}`).join("\n") + (more > 0 ? `\n- +${more} more` : "") + "\n";
  return { html, text };
}

export function renderDigestEmail(
  name: string,
  date: string,
  digest: Digest,
  links: { app: string | null; unsubscribe: string | null },
): Rendered {
  const parts = [
    section("Today", digest.today, false),
    section("Overdue", digest.overdue, true),
    section("Didn't finish yesterday", digest.didntFinish, false),
  ];
  const foot = footer(links, "the daily digest");
  const greeting = `Good morning${name ? `, ${name}` : ""}! Here is your plan for ${date}.`;
  return {
    subject: `Your todos for ${date}: ${digest.today.length} today${digest.overdue.length ? `, ${digest.overdue.length} overdue` : ""}`,
    html:
      `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;color:#0f172a">` +
      `<p>${escapeHtml(greeting)}</p>${parts.map((p) => p.html).join("")}${foot.html}</div>`,
    text: `${greeting}\n${parts.map((p) => p.text).join("")}${foot.text}`,
  };
}

export function renderAssignmentEmail(
  actor: string,
  todo: { title: string; project: string; date: string },
  links: { app: string | null; unsubscribe: string | null },
): Rendered {
  const summary = `${actor} assigned you "${todo.title}" in ${todo.project} (due ${todo.date}).`;
  const foot = footer(links, "assignment emails");
  return {
    subject: `${actor} assigned you: ${todo.title}`.slice(0, 200),
    html:
      `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;color:#0f172a">` +
      `<p>${escapeHtml(summary)}</p>${foot.html}</div>`,
    text: `${summary}${foot.text}`,
  };
}

export function slackAssignmentText(actor: string, assignee: string, todo: { title: string; project: string; date: string }) {
  return `${slackEscape(actor)} assigned *${slackEscape(todo.title)}* to ${slackEscape(assignee)} in ${slackEscape(todo.project)} (due ${todo.date}).`;
}

export function slackSummaryText(date: string, counts: { today: number; open: number; done: number; overdue: number; didntFinish: number }) {
  return (
    `*Daily summary for ${date}*\n` +
    `• Today: ${counts.today} todos (${counts.open} open, ${counts.done} done)\n` +
    `• Overdue: ${counts.overdue}\n` +
    `• Didn't finish yesterday: ${counts.didntFinish}`
  );
}
