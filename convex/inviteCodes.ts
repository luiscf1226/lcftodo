import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { clerk } from "./invitations";
import { getMember, requireMember } from "./lib/auth";
import { MAX_INVITE_PROJECTS } from "./lib/constants";
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_EXPIRY_DAYS,
  INVITE_CODE_LENGTH,
  isInviteCode,
  MAX_INVITE_CODE_USES,
  normalizeInviteCode,
} from "./lib/inviteCode";
import { applyMembershipEvent } from "./memberships";
import { grantProject } from "./projectAccess";

// Invite codes: a fallback for email invitations (#46) that never arrive.
//
// Flow: an admin creates a code (projects, expiry, optional use limit) and shares it by any channel.
// The invitee signs in with their own account and enters it. `redeem` reserves one use in a
// transaction, adds them to the Clerk organization as a member with the server-side
// CLERK_SECRET_KEY, mirrors the membership locally so access works before the webhook lands, and
// grants the code's projects. Someone already in the team only receives the project grants.
// Codes only ever grant the member role, so a leaked code can't create admins.

const CODE_ROLE = "org:member";

async function requireAdmin(ctx: QueryCtx) {
  const member = await requireMember(ctx);
  if (!member.isAdmin) throw new Error("Only team admins can manage invite codes.");
  return member;
}

const invalidCode = () => new Error("This invite code is invalid or has expired.");

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const list = query({
  args: {},
  handler: async (ctx) => {
    const member = await getMember(ctx);
    if (!member?.isAdmin) return null;
    const rows = await ctx.db
      .query("inviteCodes")
      .withIndex("by_org", (q) => q.eq("orgId", member.orgId))
      .order("desc")
      .take(100);
    return rows.map((r) => ({
      _id: r._id,
      code: r.code,
      projectIds: r.projectIds,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      maxUses: r.maxUses ?? null,
      uses: r.uses,
      revoked: r.revokedAt !== undefined,
    }));
  },
});

export const prepareCreate = internalQuery({
  args: { projectIds: v.array(v.id("projects")), expiresInDays: v.number(), maxUses: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const member = await requireAdmin(ctx);
    if (!(INVITE_CODE_EXPIRY_DAYS as readonly number[]).includes(args.expiresInDays)) {
      throw new Error("Invalid expiry.");
    }
    if (
      args.maxUses !== undefined &&
      (!Number.isInteger(args.maxUses) || args.maxUses < 1 || args.maxUses > MAX_INVITE_CODE_USES)
    ) {
      throw new Error("Invalid number of uses.");
    }
    const projectIds = [...new Set(args.projectIds)];
    if (projectIds.length > MAX_INVITE_PROJECTS) throw new Error(`Pick at most ${MAX_INVITE_PROJECTS} projects.`);
    for (const id of projectIds) {
      const project = await ctx.db.get(id);
      if (!project || project.orgId !== member.orgId || project.deleting) throw new Error("Project not found.");
    }
    return { orgId: member.orgId, userId: member.userId, projectIds };
  },
});

export const insert = internalMutation({
  args: {
    orgId: v.string(),
    code: v.string(),
    projectIds: v.array(v.id("projects")),
    createdBy: v.string(),
    expiresAt: v.number(),
    maxUses: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"inviteCodes"> | null> => {
    const taken = await ctx.db
      .query("inviteCodes")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .first();
    if (taken) return null;
    return await ctx.db.insert("inviteCodes", { ...args, createdAt: Date.now(), uses: 0 });
  },
});

/** Random code from a real CSPRNG (actions aren't deterministic, unlike mutations). */
function generateCode(): string {
  const n = INVITE_CODE_ALPHABET.length;
  // Rejection sampling keeps every character equally likely.
  const limit = 256 - (256 % n);
  let code = "";
  while (code.length < INVITE_CODE_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(INVITE_CODE_LENGTH * 2))) {
      if (byte < limit && code.length < INVITE_CODE_LENGTH) code += INVITE_CODE_ALPHABET[byte % n];
    }
  }
  return code;
}

/** Creates a shareable code that adds whoever redeems it to the team and the selected projects. Admin only. */
export const create = action({
  args: { projectIds: v.array(v.id("projects")), expiresInDays: v.number(), maxUses: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ code: string }> => {
    const prepared = await ctx.runQuery(internal.inviteCodes.prepareCreate, args);
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      const id = await ctx.runMutation(internal.inviteCodes.insert, {
        orgId: prepared.orgId,
        code,
        projectIds: prepared.projectIds,
        createdBy: prepared.userId,
        expiresAt: Date.now() + args.expiresInDays * 86_400_000,
        maxUses: args.maxUses,
      });
      if (id) return { code };
    }
    throw new Error("Couldn't create an invite code. Try again.");
  },
});

/** Stops a code from being redeemed. People who already joined keep their access. Admin only. */
export const revoke = mutation({
  args: { id: v.id("inviteCodes") },
  handler: async (ctx, { id }) => {
    const member = await requireAdmin(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== member.orgId) throw new Error("Invite code not found.");
    if (row.revokedAt === undefined) await ctx.db.patch(id, { revokedAt: Date.now() });
  },
});

// ---------------------------------------------------------------------------
// Redemption (any signed-in user, with or without a team)
// ---------------------------------------------------------------------------

export const reserve = internalMutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in.");
    const code = normalizeInviteCode(args.code);
    if (!isInviteCode(code)) throw new Error("Enter a valid invite code.");
    const row = await ctx.db
      .query("inviteCodes")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    // Unknown, revoked, expired and used-up codes look the same, so guessing reveals nothing.
    if (!row || row.revokedAt !== undefined || row.expiresAt <= Date.now()) throw invalidCode();
    const userId = identity.subject;
    const previous = await ctx.db
      .query("inviteCodeRedemptions")
      .withIndex("by_code_user", (q) => q.eq("codeId", row._id).eq("userId", userId))
      .unique();
    let redemptionId: Id<"inviteCodeRedemptions"> | null = null;
    if (!previous) {
      if (row.maxUses !== undefined && row.uses >= row.maxUses) throw invalidCode();
      redemptionId = await ctx.db.insert("inviteCodeRedemptions", {
        codeId: row._id,
        orgId: row.orgId,
        userId,
        redeemedAt: Date.now(),
      });
      await ctx.db.patch(row._id, { uses: row.uses + 1 });
    }
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_org_user", (q) => q.eq("orgId", row.orgId).eq("userId", userId))
      .unique();
    return { codeId: row._id, orgId: row.orgId, userId, redemptionId, alreadyMember: membership?.active ?? false };
  },
});

/** Gives back a use reserved by a redemption that failed to add the person to the team. */
export const release = internalMutation({
  args: { redemptionId: v.id("inviteCodeRedemptions") },
  handler: async (ctx, { redemptionId }) => {
    const redemption = await ctx.db.get(redemptionId);
    if (!redemption) return;
    await ctx.db.delete(redemptionId);
    const row = await ctx.db.get(redemption.codeId);
    if (row) await ctx.db.patch(row._id, { uses: Math.max(0, row.uses - 1) });
  },
});

export const complete = internalMutation({
  args: {
    codeId: v.id("inviteCodes"),
    orgId: v.string(),
    userId: v.string(),
    membership: v.optional(
      v.object({ membershipId: v.string(), role: v.string(), createdAt: v.number(), updatedAt: v.number() }),
    ),
  },
  handler: async (ctx, { codeId, orgId, userId, membership }) => {
    // Mirror the new membership now; the Clerk webhook for it arrives later and is idempotent.
    if (membership) await applyMembershipEvent(ctx, { orgId, userId, active: true, ...membership });
    const row = await ctx.db.get(codeId);
    if (!row) return 0;
    let granted = 0;
    for (const projectId of row.projectIds) {
      const project = await ctx.db.get(projectId);
      if (!project || project.orgId !== orgId || project.deleting) continue;
      await grantProject(ctx, project, userId, row.createdBy);
      granted++;
    }
    return granted;
  },
});

type RedeemResult = { orgId: string; joined: boolean; projects: number };

/**
 * Joins the team behind an invite code (as a member) and receives its project grants. Works for
 * signed-in users without any team yet, and for members of other teams. Redeeming again is harmless.
 */
export const redeem = action({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<RedeemResult> => {
    const r = await ctx.runMutation(internal.inviteCodes.reserve, { code });
    let membership = null;
    if (!r.alreadyMember) {
      try {
        membership = await clerk.createMembership(r.orgId, r.userId, CODE_ROLE);
      } catch (error) {
        if (r.redemptionId) await ctx.runMutation(internal.inviteCodes.release, { redemptionId: r.redemptionId });
        throw error;
      }
    }
    const projects = await ctx.runMutation(internal.inviteCodes.complete, {
      codeId: r.codeId,
      orgId: r.orgId,
      userId: r.userId,
      membership: membership ?? undefined,
    });
    return { orgId: r.orgId, joined: membership !== null, projects };
  },
});
