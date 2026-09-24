// Email and Slack message bodies for notifications (#25). All user-provided text is escaped.
import { escapeHtml } from "./email";
import { DIGEST_SECTION_LIMIT, type Digest, type DigestItem } from "./notify";
import { slackEscape } from "./slack";

type Rendered = { subject: string; html: string; text: string };

const STATUS_LABEL: Record<DigestItem["status"], string> = {
  todo: "Por hacer",
  doing: "En progreso",
  done: "Hecho",
  not_done: "Sin terminar",
};

function footer(links: { app: string | null; unsubscribe: string | null }, what: string) {
  const html: string[] = [];
  const text: string[] = [];
  if (links.app) {
    html.push(`<a href="${escapeHtml(links.app)}">Abrir LCF Todos</a>`);
    text.push(`Abrir LCF Todos: ${links.app}`);
  }
  if (links.unsubscribe) {
    html.push(`<a href="${escapeHtml(links.unsubscribe)}">Dejar de recibir ${what}</a>`);
    text.push(`Dejar de recibir ${what}: ${links.unsubscribe}`);
  } else {
    html.push(`Puedes desactivar ${what} en la configuración de Notificaciones.`);
    text.push(`Puedes desactivar ${what} en la configuración de Notificaciones.`);
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
    (more > 0 ? `<li>+${more} más</li>` : "") +
    `</ul>`;
  const text =
    `\n${title} (${items.length})\n` +
    shown.map((i) => `- ${line(i)}`).join("\n") +
    (more > 0 ? `\n- +${more} más` : "") +
    "\n";
  return { html, text };
}

export function renderDigestEmail(
  name: string,
  date: string,
  digest: Digest,
  links: { app: string | null; unsubscribe: string | null },
): Rendered {
  const parts = [
    section("Hoy", digest.today, false),
    section("Atrasadas", digest.overdue, true),
    section("Sin terminar ayer", digest.didntFinish, false),
  ];
  const foot = footer(links, "el resumen diario");
  const greeting = `¡Buenos días${name ? `, ${name}` : ""}! Este es tu plan para el ${date}.`;
  return {
    subject: `Tus tareas para el ${date}: ${digest.today.length} para hoy${digest.overdue.length ? `, ${digest.overdue.length} atrasadas` : ""}`,
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
  const summary = `${actor} te asignó "${todo.title}" en ${todo.project} (vence el ${todo.date}).`;
  const foot = footer(links, "los correos de asignaciones");
  return {
    subject: `${actor} te asignó: ${todo.title}`.slice(0, 200),
    html:
      `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;color:#0f172a">` +
      `<p>${escapeHtml(summary)}</p>${foot.html}</div>`,
    text: `${summary}${foot.text}`,
  };
}

export function slackAssignmentText(
  actor: string,
  assignee: string,
  todo: { title: string; project: string; date: string },
) {
  return `${slackEscape(actor)} asignó *${slackEscape(todo.title)}* a ${slackEscape(assignee)} en ${slackEscape(todo.project)} (vence el ${todo.date}).`;
}

export function slackSummaryText(
  date: string,
  counts: { today: number; open: number; done: number; overdue: number; didntFinish: number },
) {
  return (
    `*Resumen diario del ${date}*\n` +
    `• Hoy: ${counts.today} tareas (${counts.open} pendientes, ${counts.done} hechas)\n` +
    `• Atrasadas: ${counts.overdue}\n` +
    `• Sin terminar ayer: ${counts.didntFinish}`
  );
}
