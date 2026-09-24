import { v } from "convex/values";
import type { UserIdentity } from "convex/server";
import { internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import { requireMember } from "./lib/auth";
import { isTombstoned, tombstone } from "./lib/tombstones";

function profileFields(identity: UserIdentity) {
  return {
    clerkId: identity.subject,
    name: identity.name ?? identity.nickname ?? identity.email ?? "Unknown",
    email: identity.email,
    imageUrl: identity.pictureUrl,
  };
}

function findUser(ctx: QueryCtx, clerkId: string) {
  return ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
    .unique();
}

// Called after sign-in so teammates can see names and avatars. Once a Clerk webhook has
// synced the profile (clerkUpdatedAt), webhooks own it and a stale session token can't
// overwrite it.
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in.");
    const fields = profileFields(identity);
    const existing = await findUser(ctx, identity.subject);
    if (existing) {
      if (existing.clerkUpdatedAt === undefined) await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    if (await isTombstoned(ctx, "user", identity.subject)) throw new Error("This account was deleted.");
    return await ctx.db.insert("users", fields);
  },
});

export const byClerkIds = query({
  args: { clerkIds: v.array(v.string()) },
  handler: async (ctx, { clerkIds }) => {
    const member = await requireMember(ctx);
    const users = await Promise.all(
      [...new Set(clerkIds)].slice(0, 200).map(async (clerkId) => {
        const membership = await ctx.db.query("memberships")
          .withIndex("by_org_user", (q) => q.eq("orgId", member.orgId).eq("userId", clerkId)).unique();
        if (!membership && clerkId !== member.userId) return null;
        return await findUser(ctx, clerkId);
      }),
    );
    return users
      .filter((u) => u !== null)
      .map((u) => ({ clerkId: u.clerkId, name: u.name, imageUrl: u.imageUrl }));
  },
});

// First-run tutorial status for the signed-in caller. Null when signed out.
// Users without a row yet (store hasn't run) or without the field haven't completed it.
export const onboardingStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await findUser(ctx, identity.subject);
    const completedAt = user?.onboardingCompletedAt ?? null;
    return { completed: completedAt !== null, completedAt };
  },
});

// Marks the tutorial as finished for the caller so it stops showing on every device.
export const completeOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in.");
    const existing = await findUser(ctx, identity.subject);
    if (existing) {
      // Keep the original completion time if this runs twice (e.g. two tabs).
      if (existing.onboardingCompletedAt === undefined) {
        await ctx.db.patch(existing._id, { onboardingCompletedAt: Date.now() });
      }
      return;
    }
    if (await isTombstoned(ctx, "user", identity.subject)) throw new Error("This account was deleted.");
    await ctx.db.insert("users", { ...profileFields(identity), onboardingCompletedAt: Date.now() });
  },
});

export const upsertFromWebhook = internalMutation({
  args: {
    clerkId: v.string(), name: v.string(), email: v.optional(v.string()), imageUrl: v.optional(v.string()),
    updatedAt: v.number(),
  },
  handler: async (ctx, { updatedAt, ...fields }) => {
    if (!Number.isFinite(updatedAt)) throw new Error("Invalid user event.");
    if (await isTombstoned(ctx, "user", fields.clerkId)) return;
    const existing = await findUser(ctx, fields.clerkId);
    if (existing && (existing.clerkUpdatedAt ?? 0) > updatedAt) return;
    if (existing) await ctx.db.patch(existing._id, { ...fields, clerkUpdatedAt: updatedAt });
    else await ctx.db.insert("users", { ...fields, clerkUpdatedAt: updatedAt });
  },
});

export const deleteFromWebhook = internalMutation({
  args: { clerkId: v.string() },
  handler: async (ctx, { clerkId }) => {
    await tombstone(ctx, "user", clerkId);
    const user = await findUser(ctx, clerkId);
    if (user) await ctx.db.delete(user._id);
    const memberships = await ctx.db.query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", clerkId)).collect();
    for (const membership of memberships) {
      if (membership.membershipId) await tombstone(ctx, "membership", membership.membershipId);
      if (membership.active) await ctx.db.patch(membership._id, { active: false, updatedAt: Date.now() });
    }
  },
});
