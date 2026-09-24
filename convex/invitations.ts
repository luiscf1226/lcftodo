import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireMember } from "./lib/auth";
import { INVITE_ROLES, MAX_INVITE_PROJECTS } from "./lib/constants";
import { tombstone } from "./lib/tombstones";
import { normalizeEmail } from "./lib/validate";
import { grantProject, revokeAllGrants } from "./projectAccess";

// Invite people by email to selected projects (#46).
//
// Flow: an admin calls `invite` → Convex re-checks the admin role and every project id, then
// creates a Clerk organization invitation with the server-side CLERK_SECRET_KEY and stores the
// project grants in `projectInvitations`, keyed by Clerk's invitation id and the normalized
// email. The invitee creates/uses their own Clerk account to accept. The grants are applied
// exactly once, when the Clerk webhook reports `organizationInvitation.accepted` (with the
// user id) or, as a fallback, `organizationMembership.created` for the same email.
// Nothing the client sends (email, role, project ids) is trusted for authorization.

const OPEN = ["pending", "accepted"] as const;

// ---------------------------------------------------------------------------
// Grant application (webhooks)
// ---------------------------------------------------------------------------

async function applyGrants(ctx: MutationCtx, row: Doc<"projectInvitations">, userId: string) {
  if (row.appliedAt !== undefined || !(OPEN as readonly string[]).includes(row.status)) return false;
  for (const projectId of row.projectIds) {
    const project = await ctx.db.get(projectId);
    if (!project || project.orgId !== row.orgId || project.deleting) continue;
    await grantProject(ctx, project, userId, row.invitedBy);
  }
  const now = Date.now();
  await ctx.db.patch(row._id, { status: "accepted", appliedAt: now, acceptedUserId: userId, updatedAt: now });
  return true;
}

/** Applies any unapplied invitation grants for these emails in a team. */
export async function applyPendingForEmails(ctx: MutationCtx, orgId: string, userId: string, emails: string[]) {
  const seen = new Set<string>();
  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const rows = await ctx.db.query("projectInvitations")
      .withIndex("by_org_email", (q) => q.eq("orgId", orgId).eq("email", email)).collect();
    for (const row of rows) await applyGrants(ctx, row, userId);
  }
}

/** Webhook: `organizationInvitation.accepted`. */
export const applyAccepted = internalMutation({
  args: { invitationId: v.string(), orgId: v.string(), userId: v.string() },
  handler: async (ctx, { invitationId, orgId, userId }) => {
    const row = await ctx.db.query("projectInvitations")
      .withIndex("by_invitation", (q) => q.eq("invitationId", invitationId)).unique();
    if (!row || row.orgId !== orgId) return;
    await applyGrants(ctx, row, userId);
  },
});

/** Webhook: `organizationInvitation.revoked`. Invitations already applied are left alone. */
export const markRevoked = internalMutation({
  args: { invitationId: v.string() },
  handler: async (ctx, { invitationId }) => {
    const row = await ctx.db.query("projectInvitations")
      .withIndex("by_invitation", (q) => q.eq("invitationId", invitationId)).unique();
    if (!row || row.appliedAt !== undefined || row.status === "revoked") return;
    await ctx.db.patch(row._id, { status: "revoked", updatedAt: Date.now() });
  },
});

// ---------------------------------------------------------------------------
// Admin actions
// ---------------------------------------------------------------------------

type Prepared = {
  orgId: string;
  inviterId: string;
  email: string;
  role: string;
  projectIds: Id<"projects">[];
  // The invitee is already an active member of this team: grant directly, no invitation needed.
  existingUserId: string | null;
  // An open invitation for this email already exists: merge the projects into it.
  pendingId: Id<"projectInvitations"> | null;
};

async function requireAdmin(ctx: QueryCtx) {
  const member = await requireMember(ctx);
  if (!member.isAdmin) throw new Error("Only team admins can invite people or manage invitations.");
  return member;
}

export const prepareInvite = internalQuery({
  args: { email: v.string(), role: v.string(), projectIds: v.array(v.id("projects")) },
  handler: async (ctx, args): Promise<Prepared> => {
    const member = await requireAdmin(ctx);
    const email = normalizeEmail(args.email);
    if (!(INVITE_ROLES as readonly string[]).includes(args.role)) throw new Error("Invalid role.");
    const projectIds = [...new Set(args.projectIds)];
    if (projectIds.length > MAX_INVITE_PROJECTS) throw new Error(`Pick at most ${MAX_INVITE_PROJECTS} projects.`);
    for (const id of projectIds) {
      const project = await ctx.db.get(id);
      if (!project || project.orgId !== member.orgId || project.deleting) throw new Error("Project not found.");
    }
    let existingUserId: string | null = null;
    const users = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", email)).take(5);
    for (const u of users) {
      const membership = await ctx.db.query("memberships")
        .withIndex("by_org_user", (q) => q.eq("orgId", member.orgId).eq("userId", u.clerkId)).unique();
      if (membership?.active) existingUserId = u.clerkId;
    }
    const open = await ctx.db.query("projectInvitations")
      .withIndex("by_org_email", (q) => q.eq("orgId", member.orgId).eq("email", email)).collect();
    const pending = open.find((r) => r.status === "pending" && r.appliedAt === undefined && (r.expiresAt ?? Infinity) > Date.now());
    return {
      orgId: member.orgId, inviterId: member.userId, email, role: args.role, projectIds,
      existingUserId, pendingId: pending?._id ?? null,
    };
  },
});

export const grantExisting = internalMutation({
  args: { orgId: v.string(), userId: v.string(), grantedBy: v.string(), projectIds: v.array(v.id("projects")) },
  handler: async (ctx, { orgId, userId, grantedBy, projectIds }) => {
    for (const id of projectIds) {
      const project = await ctx.db.get(id);
      if (project && project.orgId === orgId && !project.deleting) await grantProject(ctx, project, userId, grantedBy);
    }
  },
});

export const mergePending = internalMutation({
  args: { id: v.id("projectInvitations"), projectIds: v.array(v.id("projects")) },
  handler: async (ctx, { id, projectIds }) => {
    const row = await ctx.db.get(id);
    if (!row || row.appliedAt !== undefined) throw new Error("That invitation is no longer pending.");
    const merged = [...new Set([...row.projectIds, ...projectIds])].slice(0, MAX_INVITE_PROJECTS);
    await ctx.db.patch(id, { projectIds: merged, updatedAt: Date.now() });
  },
});

export const record = internalMutation({
  args: {
    orgId: v.string(), invitationId: v.string(), email: v.string(), role: v.string(),
    projectIds: v.array(v.id("projects")), invitedBy: v.string(), expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db.query("projectInvitations")
      .withIndex("by_invitation", (q) => q.eq("invitationId", args.invitationId)).unique();
    if (existing) return existing._id;
    return await ctx.db.insert("projectInvitations", { ...args, status: "pending", createdAt: now, updatedAt: now });
  },
});

type InviteResult = { outcome: "invited" | "merged" | "granted" };

/**
 * Invites someone by email to the team and the selected projects. If they're already an
 * active member, the projects are granted right away; if an invitation is already pending,
 * the projects are added to it.
 */
export const invite = action({
  args: { email: v.string(), role: v.string(), projectIds: v.array(v.id("projects")) },
  handler: async (ctx, args): Promise<InviteResult> => {
    const prepared: Prepared = await ctx.runQuery(internal.invitations.prepareInvite, args);
    if (prepared.existingUserId) {
      await ctx.runMutation(internal.invitations.grantExisting, {
        orgId: prepared.orgId, userId: prepared.existingUserId, grantedBy: prepared.inviterId,
        projectIds: prepared.projectIds,
      });
      return { outcome: "granted" };
    }
    if (prepared.pendingId) {
      await ctx.runMutation(internal.invitations.mergePending, { id: prepared.pendingId, projectIds: prepared.projectIds });
      return { outcome: "merged" };
    }
    const created = await clerk.createInvitation(prepared.orgId, prepared.email, prepared.role, prepared.inviterId);
    await ctx.runMutation(internal.invitations.record, {
      orgId: prepared.orgId, invitationId: created.id, email: prepared.email, role: prepared.role,
      projectIds: prepared.projectIds, invitedBy: prepared.inviterId, expiresAt: created.expiresAt,
    });
    return { outcome: "invited" };
  },
});

export const loadForAdmin = internalQuery({
  args: { id: v.id("projectInvitations") },
  handler: async (ctx, { id }) => {
    const member = await requireAdmin(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== member.orgId) throw new Error("Invitation not found.");
    return { row, adminId: member.userId };
  },
});

export const setStatus = internalMutation({
  args: {
    id: v.id("projectInvitations"),
    status: v.union(v.literal("pending"), v.literal("revoked"), v.literal("expired")),
    invitationId: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, { id, status, invitationId, expiresAt }) => {
    const row = await ctx.db.get(id);
    if (!row || row.appliedAt !== undefined) return;
    await ctx.db.patch(id, {
      status, updatedAt: Date.now(),
      ...(invitationId ? { invitationId } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    });
  },
});

/** Revokes a pending invitation in Clerk; its project grants will never be applied. */
export const revoke = action({
  args: { id: v.id("projectInvitations") },
  handler: async (ctx, { id }) => {
    const { row, adminId } = await ctx.runQuery(internal.invitations.loadForAdmin, { id });
    if (row.status !== "pending" || row.appliedAt !== undefined) throw new Error("Only pending invitations can be revoked.");
    await clerk.revokeInvitation(row.orgId, row.invitationId, adminId);
    await ctx.runMutation(internal.invitations.setStatus, { id, status: "revoked" });
  },
});

/**
 * Sends a fresh invitation email. Clerk has no "resend" endpoint, so the old invitation is
 * revoked (if still pending) and a new one is created; the stored project grants carry over.
 */
export const resend = action({
  args: { id: v.id("projectInvitations") },
  handler: async (ctx, { id }) => {
    const { row, adminId } = await ctx.runQuery(internal.invitations.loadForAdmin, { id });
    if (row.appliedAt !== undefined || row.status === "accepted") throw new Error("This invitation was already accepted.");
    if (row.status === "pending") await clerk.revokeInvitation(row.orgId, row.invitationId, adminId, { ignoreGone: true });
    const created = await clerk.createInvitation(row.orgId, row.email, row.role, adminId);
    await ctx.runMutation(internal.invitations.setStatus, {
      id, status: "pending", invitationId: created.id, expiresAt: created.expiresAt,
    });
  },
});

export const pendingForOrg = internalQuery({
  args: {},
  handler: async (ctx) => {
    const member = await requireAdmin(ctx);
    const rows = await ctx.db.query("projectInvitations")
      .withIndex("by_org", (q) => q.eq("orgId", member.orgId)).order("desc").take(200);
    return {
      orgId: member.orgId,
      rows: rows.filter((r) => r.status === "pending" && r.appliedAt === undefined)
        .map((r) => ({ id: r._id, invitationId: r.invitationId, email: r.email })),
    };
  },
});

export const syncStatus = internalMutation({
  args: { id: v.id("projectInvitations"), status: v.string(), expiresAt: v.optional(v.number()) },
  handler: async (ctx, { id, status, expiresAt }) => {
    const row = await ctx.db.get(id);
    if (!row || row.appliedAt !== undefined) return;
    const now = Date.now();
    if (status === "revoked" || status === "expired") {
      await ctx.db.patch(id, { status, updatedAt: now });
    } else if (status === "accepted") {
      // No webhook user id here: apply to the active member with this email, if already synced.
      const users = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", row.email)).take(5);
      for (const u of users) {
        const membership = await ctx.db.query("memberships")
          .withIndex("by_org_user", (q) => q.eq("orgId", row.orgId).eq("userId", u.clerkId)).unique();
        if (membership?.active) {
          await applyPendingForEmails(ctx, row.orgId, u.clerkId, [row.email]);
          return;
        }
      }
      await ctx.db.patch(id, { status: "accepted", updatedAt: now });
    } else if (expiresAt !== undefined && expiresAt !== row.expiresAt) {
      await ctx.db.patch(id, { expiresAt, updatedAt: now });
    }
  },
});

/** Pulls the latest status of pending invitations from Clerk (expiry isn't sent as a webhook). */
export const refresh = action({
  args: {},
  handler: async (ctx): Promise<number> => {
    const { orgId, rows } = await ctx.runQuery(internal.invitations.pendingForOrg, {});
    for (const r of rows.slice(0, 50)) {
      const current = await clerk.getInvitation(orgId, r.invitationId);
      await ctx.runMutation(internal.invitations.syncStatus, {
        id: r.id, status: current?.status ?? "revoked", expiresAt: current?.expiresAt,
      });
    }
    return rows.length;
  },
});

// ---------------------------------------------------------------------------
// Team removal
// ---------------------------------------------------------------------------

export const prepareRemoval = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const member = await requireAdmin(ctx);
    if (userId === member.userId) throw new Error("You can't remove yourself. Leave the team from the team menu instead.");
    return { orgId: member.orgId };
  },
});

/** Applies a removal locally right away instead of waiting for Clerk's webhook. */
export const afterRemoval = internalMutation({
  args: { orgId: v.string(), userId: v.string() },
  handler: async (ctx, { orgId, userId }) => {
    const membership = await ctx.db.query("memberships")
      .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", userId)).unique();
    if (membership) {
      // Terminal, like a delivered `organizationMembership.deleted`: late events can't revive it.
      if (membership.membershipId) await tombstone(ctx, "membership", membership.membershipId);
      if (membership.active) await ctx.db.patch(membership._id, { active: false, updatedAt: Date.now() });
    }
    await revokeAllGrants(ctx, orgId, userId);
  },
});

/** Removes a person from the team (Clerk membership + every project grant). Admin only. */
export const removeMember = action({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const { orgId } = await ctx.runQuery(internal.invitations.prepareRemoval, { userId });
    await clerk.deleteMembership(orgId, userId);
    await ctx.runMutation(internal.invitations.afterRemoval, { orgId, userId });
  },
});

// ---------------------------------------------------------------------------
// Clerk Backend API (https://clerk.com/docs/reference/backend-api)
// ---------------------------------------------------------------------------

function secret(): string {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("CLERK_SECRET_KEY is not configured in Convex.");
  return key;
}

async function clerkFetch(path: string, init: { method: string; body?: unknown }) {
  const response = await fetch(`https://api.clerk.com/v1${path}`, {
    method: init.method,
    headers: { Authorization: `Bearer ${secret()}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: response.ok, status: response.status, body };
}

/** A user-facing message from a Clerk error response. */
function clerkError(status: number, body: Record<string, unknown> | null, fallback: string): Error {
  const errors = body && Array.isArray(body.errors) ? (body.errors as Array<Record<string, unknown>>) : [];
  const first = errors[0];
  const message = first && (typeof first.long_message === "string" ? first.long_message : first.message);
  return new Error(typeof message === "string" && message ? message : `${fallback} (${status}).`);
}

type ClerkInvitation = { id: string; status: string; expiresAt?: number };

function parseInvitation(body: Record<string, unknown> | null): ClerkInvitation {
  if (!body || typeof body.id !== "string" || !body.id) throw new Error("Unexpected Clerk invitation response.");
  return {
    id: body.id,
    status: typeof body.status === "string" ? body.status : "pending",
    expiresAt: typeof body.expires_at === "number" ? body.expires_at : undefined,
  };
}

const org = (orgId: string) => `/organizations/${encodeURIComponent(orgId)}`;

const clerk = {
  async createInvitation(orgId: string, email: string, role: string, inviterId: string): Promise<ClerkInvitation> {
    const appUrl = process.env.APP_URL?.replace(/\/+$/, "");
    const res = await clerkFetch(`${org(orgId)}/invitations`, {
      method: "POST",
      body: {
        email_address: email,
        role,
        inviter_user_id: inviterId,
        ...(appUrl ? { redirect_url: `${appUrl}/sign-up` } : {}),
      },
    });
    if (!res.ok) throw clerkError(res.status, res.body, "Couldn't create the invitation");
    return parseInvitation(res.body);
  },

  async revokeInvitation(orgId: string, invitationId: string, requesterId: string, opts: { ignoreGone?: boolean } = {}) {
    const res = await clerkFetch(`${org(orgId)}/invitations/${encodeURIComponent(invitationId)}/revoke`, {
      method: "POST",
      body: { requesting_user_id: requesterId },
    });
    if (!res.ok && !(opts.ignoreGone && (res.status === 404 || res.status === 400))) {
      throw clerkError(res.status, res.body, "Couldn't revoke the invitation");
    }
  },

  async getInvitation(orgId: string, invitationId: string): Promise<ClerkInvitation | null> {
    const res = await clerkFetch(`${org(orgId)}/invitations/${encodeURIComponent(invitationId)}`, { method: "GET" });
    if (res.status === 404) return null;
    if (!res.ok) throw clerkError(res.status, res.body, "Couldn't load the invitation");
    return parseInvitation(res.body);
  },

  async deleteMembership(orgId: string, userId: string) {
    const res = await clerkFetch(`${org(orgId)}/memberships/${encodeURIComponent(userId)}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw clerkError(res.status, res.body, "Couldn't remove the member");
  },
};
