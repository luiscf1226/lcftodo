const SERVER_MESSAGES: Record<string, string> = {
  "Assignee doesn't have access to this project.": "El responsable no tiene acceso a este proyecto.",
  "Assignee is not an active member of this team.": "El responsable ya no forma parte de este equipo.",
  "Comment not found.": "Comentario no encontrado.",
  "Enter a Slack incoming webhook URL (https://hooks.slack.com/services/...).":
    "Introduce una URL de webhook de Slack válida (https://hooks.slack.com/services/...).",
  "Enter a valid email address.": "Introduce una dirección de correo válida.",
  "Invalid date.": "Fecha no válida.",
  "Invalid date range.": "Período no válido.",
  "Invalid date range: the start must be before the end.": "La fecha de inicio debe ser anterior a la de fin.",
  "Invalid day of the week.": "Día de la semana no válido.",
  "Invalid project color.": "Color de proyecto no válido.",
  "Invalid position.": "Posición no válida.",
  "Invalid range: the start date is after the end date.": "La fecha de inicio debe ser anterior a la fecha de fin.",
  "Invalid role.": "Rol no válido.",
  "Invitation not found.": "Invitación no encontrada.",
  "Not signed in.": "Debes iniciar sesión.",
  "Notification not found.": "Notificación no encontrada.",
  "Only pending invitations can be revoked.": "Solo se pueden revocar invitaciones pendientes.",
  "Only team admins can archive or restore projects.":
    "Solo los administradores pueden archivar o restaurar proyectos.",
  "Only team admins can change team settings.": "Solo los administradores pueden cambiar la configuración del equipo.",
  "Only team admins can change the Slack integration.":
    "Solo los administradores pueden cambiar la integración de Slack.",
  "Only team admins can delete projects.": "Solo los administradores pueden eliminar proyectos.",
  "Only team admins can export all team data.": "Solo los administradores pueden exportar todos los datos del equipo.",
  "Only team admins can invite people or manage invitations.":
    "Solo los administradores pueden gestionar invitaciones.",
  "Only team admins can manage project access.": "Solo los administradores pueden gestionar el acceso a proyectos.",
  "Only team admins can backfill memberships.": "Solo los administradores pueden actualizar los miembros.",
  "Only the author or a team admin can delete this comment.":
    "Solo el autor o un administrador puede eliminar este comentario.",
  "Pick at least one day of the week.": "Elige al menos un día de la semana.",
  "Project not found.": "Proyecto no encontrado.",
  "Recurring todo not found.": "Tarea recurrente no encontrada.",
  "That invitation is no longer pending.": "Esta invitación ya no está pendiente.",
  "That person isn't an active member of this team yet.": "Esta persona aún no es miembro activo del equipo.",
  "This account was deleted.": "Esta cuenta fue eliminada.",
  "This invitation was already accepted.": "Esta invitación ya fue aceptada.",
  "This project is archived. Restore it to make changes.":
    "Este proyecto está archivado. Restáuralo para hacer cambios.",
  "This project is being deleted.": "Este proyecto se está eliminando.",
  "This recurring todo has been stopped.": "Esta tarea recurrente se detuvo.",
  "Todo not found.": "Tarea no encontrada.",
  "Unknown time zone.": "Zona horaria desconocida.",
  "You must be signed in to a team.": "Debes iniciar sesión en un equipo.",
  "You can only edit your own comments.": "Solo puedes editar tus comentarios.",
  "You can't remove yourself. Leave the team from the team menu instead.":
    "No puedes quitarte a ti mismo. Sal del equipo desde su menú.",
};

const FIELD_LABELS: Record<string, string> = {
  Title: "El título",
  Notes: "Las notas",
  "Project name": "El nombre del proyecto",
  Description: "La descripción",
  Comment: "El comentario",
};

export function errorMessage(error: unknown, fallback = "Ocurrió un error. Inténtalo de nuevo.") {
  if (!(error instanceof Error) || !error.message) return fallback;

  const message = error.message.replace(/^.*Uncaught Error: /, "").split("\n")[0];
  if (!message) return fallback;
  if (SERVER_MESSAGES[message]) return SERVER_MESSAGES[message];
  const required = /^(Title|Notes|Project name|Description|Comment) is required\.$/.exec(message);
  if (required) return `${FIELD_LABELS[required[1]]} es obligatorio.`;
  const length = /^(Title|Notes|Project name|Description|Comment) must be at most ([\d,]+) characters\.$/.exec(message);
  if (length) return `${FIELD_LABELS[length[1]]} debe tener como máximo ${length[2]} caracteres.`;
  const range = /^Date range too large: pick at most (\d+) days\.$/.exec(message);
  if (range) return `El período es demasiado largo. Elige como máximo ${range[1]} días.`;
  const activityRange = /^This range has more than ([\d,]+) activity rows\./.exec(message);
  if (activityRange)
    return `Este período tiene más de ${activityRange[1]} entradas de actividad. Reduce el período o ajusta los filtros.`;
  return message;
}
