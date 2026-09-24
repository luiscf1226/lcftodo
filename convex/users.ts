import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireMember } from "./lib/auth";

// Called after sign-in to seed a user row. Webhooks own later profile updates.
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in.");
    const fields = {
      clerkId: identity.subject,
      name: identity.name ?? identity.nickname ?? identity.email ?? "Unknown",
      email: identity.email,
      imageUrl: identity.pictureUrl,
    };
    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (existing) return existing._id;
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
        return await ctx.db.query("users")
          .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId)).unique();
      }),
    );
    return users
      .filter((u) => u !== null)
      .map((u) => ({ clerkId: u.clerkId, name: u.name, imageUrl: u.imageUrl }));
  },
});

export const upsertFromWebhook = internalMutation({
  args: {
    clerkId: v.string(), name: v.string(), email: v.optional(v.string()), imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, fields) => {
    const existing = await ctx.db.query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", fields.clerkId)).unique();
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("users", fields);
  },
});

export const deleteFromWebhook = internalMutation({
  args: { clerkId: v.string(), eventAt: v.number() },
  handler: async (ctx, { clerkId, eventAt }) => {
    const user = await ctx.db.query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId)).unique();
    if (user) await ctx.db.delete(user._id);
    const memberships = await ctx.db.query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", clerkId)).collect();
    for (const membership of memberships) {
      if (!membership.lastEventAt || membership.lastEventAt <= eventAt) {
        await ctx.db.patch(membership._id, { active: false, lastEventAt: eventAt, updatedAt: Date.now() });
      }
    }
  },
});
