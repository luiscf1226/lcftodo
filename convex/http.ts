import { httpRouter } from "convex/server";
import { Webhook } from "svix";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { escapeHtml } from "./lib/email";
import { UNSUBSCRIBE_PATH, verifyUnsubscribeToken } from "./lib/unsubscribe";

const http = httpRouter();

http.route({
  path: "/clerk-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.CLERK_WEBHOOK_SECRET;
    if (!secret) return new Response("Webhook is not configured.", { status: 503 });
    const id = request.headers.get("svix-id");
    const timestamp = request.headers.get("svix-timestamp");
    const signature = request.headers.get("svix-signature");
    if (!id || !timestamp || !signature) return new Response("Invalid webhook.", { status: 400 });
    const raw = await request.text();
    if (raw.length > 1_000_000) return new Response("Webhook too large.", { status: 413 });

    let event: unknown;
    try {
      new Webhook(secret).verify(raw, {
        "svix-id": id,
        "svix-timestamp": timestamp,
        "svix-signature": signature,
      });
      event = JSON.parse(raw);
    } catch {
      return new Response("Invalid webhook signature.", { status: 400 });
    }
    if (!event || typeof event !== "object" || !("type" in event) || !("data" in event)) {
      return new Response("Invalid webhook event.", { status: 400 });
    }
    // Order by Clerk's payload timestamps: svix-timestamp is re-signed on every delivery attempt.
    const { type, data } = event;

    if (
      type === "organizationMembership.created" ||
      type === "organizationMembership.updated" ||
      type === "organizationMembership.deleted"
    ) {
      if (
        !data ||
        typeof data !== "object" ||
        !("id" in data) ||
        !("organization" in data) ||
        !("public_user_data" in data) ||
        !("role" in data) ||
        !("created_at" in data) ||
        !("updated_at" in data)
      ) {
        return new Response("Invalid membership event.", { status: 400 });
      }
      const org = data.organization;
      const user = data.public_user_data;
      if (
        !org ||
        typeof org !== "object" ||
        !("id" in org) ||
        typeof org.id !== "string" ||
        !user ||
        typeof user !== "object" ||
        !("user_id" in user) ||
        typeof user.user_id !== "string" ||
        typeof data.id !== "string" ||
        !data.id ||
        typeof data.role !== "string" ||
        typeof data.created_at !== "number" ||
        !Number.isFinite(data.created_at) ||
        typeof data.updated_at !== "number" ||
        !Number.isFinite(data.updated_at)
      ) {
        return new Response("Invalid membership event.", { status: 400 });
      }
      const identifier = "identifier" in user && typeof user.identifier === "string" ? user.identifier : undefined;
      await ctx.runMutation(internal.memberships.applyWebhook, {
        orgId: org.id,
        userId: user.user_id,
        membershipId: data.id,
        role: data.role,
        active: type !== "organizationMembership.deleted",
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        identifier,
      });
    } else if (type === "organizationInvitation.accepted" || type === "organizationInvitation.revoked") {
      // Project grants stored with an invitation (#46) are keyed by Clerk's invitation id.
      if (!data || typeof data !== "object" || !("id" in data) || typeof data.id !== "string" || !data.id) {
        return new Response("Invalid invitation event.", { status: 400 });
      }
      if (type === "organizationInvitation.revoked") {
        await ctx.runMutation(internal.invitations.markRevoked, { invitationId: data.id });
      } else {
        if (
          !("organization_id" in data) ||
          typeof data.organization_id !== "string" ||
          !("user_id" in data) ||
          typeof data.user_id !== "string" ||
          !data.user_id
        ) {
          return new Response("Invalid invitation event.", { status: 400 });
        }
        await ctx.runMutation(internal.invitations.applyAccepted, {
          invitationId: data.id,
          orgId: data.organization_id,
          userId: data.user_id,
        });
      }
    } else if (type === "user.created" || type === "user.updated") {
      if (
        !data ||
        typeof data !== "object" ||
        !("id" in data) ||
        typeof data.id !== "string" ||
        !("updated_at" in data) ||
        typeof data.updated_at !== "number" ||
        !Number.isFinite(data.updated_at)
      ) {
        return new Response("Invalid user event.", { status: 400 });
      }
      const first = "first_name" in data && typeof data.first_name === "string" ? data.first_name : "";
      const last = "last_name" in data && typeof data.last_name === "string" ? data.last_name : "";
      const username = "username" in data && typeof data.username === "string" ? data.username : "";
      const name = `${first} ${last}`.trim() || username || "Unknown";
      const emailAddresses =
        "email_addresses" in data && Array.isArray(data.email_addresses) ? data.email_addresses : [];
      const primaryEmailId = "primary_email_address_id" in data ? data.primary_email_address_id : undefined;
      const primary = emailAddresses.find(
        (entry) => entry && typeof entry === "object" && "id" in entry && entry.id === primaryEmailId,
      );
      const email =
        primary && "email_address" in primary && typeof primary.email_address === "string"
          ? primary.email_address
          : undefined;
      const imageUrl = "image_url" in data && typeof data.image_url === "string" ? data.image_url : undefined;
      await ctx.runMutation(internal.users.upsertFromWebhook, {
        clerkId: data.id,
        name,
        email,
        imageUrl,
        updatedAt: data.updated_at,
      });
    } else if (type === "user.deleted") {
      if (!data || typeof data !== "object" || !("id" in data) || typeof data.id !== "string") {
        return new Response("Invalid user event.", { status: 400 });
      }
      await ctx.runMutation(internal.users.deleteFromWebhook, { clerkId: data.id });
    }
    return new Response("OK");
  }),
});

// Login-free unsubscribe (#25). GET shows a confirmation form so link scanners
// can't unsubscribe anyone; POST (the form, or RFC 8058 one-click) applies it.
function page(title: string, body: string, status = 200) {
  const html =
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head>` +
    `<body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#0f172a">` +
    `<h1 style="font-size:1.25rem">${escapeHtml(title)}</h1>${body}</body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
    },
  });
}

const KIND_LABEL = { digest: "el resumen diario", assigned: "los correos de asignaciones" } as const;
const invalidLink = () =>
  page(
    "Enlace no válido",
    "<p>Este enlace para cancelar la suscripción no es válido. Puedes cambiar la configuración de correo en Notificaciones de LCF Todos.</p>",
    400,
  );

http.route({
  path: UNSUBSCRIBE_PATH,
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const token = new URL(request.url).searchParams.get("token") ?? "";
    const target = await verifyUnsubscribeToken(token);
    if (!target) return invalidLink();
    const action = `${UNSUBSCRIBE_PATH}?token=${encodeURIComponent(token)}`;
    return page(
      "Cancelar suscripción",
      `<p>¿Dejar de recibir ${KIND_LABEL[target.kind]} de LCF Todos?</p>` +
        `<form method="post" action="${escapeHtml(action)}"><button type="submit" style="padding:.5rem 1rem;font:inherit">Dejar de recibir</button></form>`,
    );
  }),
});

http.route({
  path: UNSUBSCRIBE_PATH,
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const target = await verifyUnsubscribeToken(new URL(request.url).searchParams.get("token") ?? "");
    if (!target) return invalidLink();
    await ctx.runMutation(internal.notifications.unsubscribe, target);
    return page(
      "Suscripción cancelada",
      `<p>Ya no recibirás ${KIND_LABEL[target.kind]}. Puedes volver a activar estos correos en Notificaciones de LCF Todos.</p>`,
    );
  }),
});

export default http;
