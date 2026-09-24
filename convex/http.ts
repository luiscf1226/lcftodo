import { httpRouter } from "convex/server";
import { Webhook } from "svix";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

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
        "svix-id": id, "svix-timestamp": timestamp, "svix-signature": signature,
      });
      event = JSON.parse(raw);
    } catch {
      return new Response("Invalid webhook signature.", { status: 400 });
    }
    if (!event || typeof event !== "object" || !("type" in event) || !("data" in event)) {
      return new Response("Invalid webhook event.", { status: 400 });
    }
    const { type, data } = event;
    const eventAt = Number(timestamp) * 1000;
    if (!Number.isFinite(eventAt)) return new Response("Invalid webhook timestamp.", { status: 400 });

    if (type === "organizationMembership.created" || type === "organizationMembership.updated" || type === "organizationMembership.deleted") {
      if (!data || typeof data !== "object" || !("organization" in data) || !("public_user_data" in data) || !("role" in data)) {
        return new Response("Invalid membership event.", { status: 400 });
      }
      const org = data.organization;
      const user = data.public_user_data;
      if (!org || typeof org !== "object" || !("id" in org) || typeof org.id !== "string" ||
          !user || typeof user !== "object" || !("user_id" in user) || typeof user.user_id !== "string" ||
          typeof data.role !== "string") return new Response("Invalid membership event.", { status: 400 });
      await ctx.runMutation(internal.memberships.applyWebhook, {
        orgId: org.id, userId: user.user_id, role: data.role,
        active: type !== "organizationMembership.deleted", eventAt,
      });
    } else if (type === "user.created" || type === "user.updated") {
      if (!data || typeof data !== "object" || !("id" in data) || typeof data.id !== "string") {
        return new Response("Invalid user event.", { status: 400 });
      }
      const first = "first_name" in data && typeof data.first_name === "string" ? data.first_name : "";
      const last = "last_name" in data && typeof data.last_name === "string" ? data.last_name : "";
      const username = "username" in data && typeof data.username === "string" ? data.username : "";
      const name = `${first} ${last}`.trim() || username || "Unknown";
      const emailAddresses = "email_addresses" in data && Array.isArray(data.email_addresses) ? data.email_addresses : [];
      const primaryEmailId = "primary_email_address_id" in data ? data.primary_email_address_id : undefined;
      const primary = emailAddresses.find((entry) => entry && typeof entry === "object" && "id" in entry && entry.id === primaryEmailId);
      const email = primary && "email_address" in primary && typeof primary.email_address === "string" ? primary.email_address : undefined;
      const imageUrl = "image_url" in data && typeof data.image_url === "string" ? data.image_url : undefined;
      await ctx.runMutation(internal.users.upsertFromWebhook, { clerkId: data.id, name, email, imageUrl });
    } else if (type === "user.deleted") {
      if (!data || typeof data !== "object" || !("id" in data) || typeof data.id !== "string") {
        return new Response("Invalid user event.", { status: 400 });
      }
      await ctx.runMutation(internal.users.deleteFromWebhook, { clerkId: data.id, eventAt });
    }
    return new Response("OK");
  }),
});

export default http;
