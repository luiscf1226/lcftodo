import { v } from "convex/values";
import type { UserIdentity } from "convex/server";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireMember } from "./lib/auth";

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

// Called by the client after sign-in so teammates can see names and avatars.
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in.");
    const fields = profileFields(identity);
    const existing = await findUser(ctx, identity.subject);
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("users", fields);
  },
});

export const byClerkIds = query({
  args: { clerkIds: v.array(v.string()) },
  handler: async (ctx, { clerkIds }) => {
    await requireMember(ctx);
    const users = await Promise.all(
      [...new Set(clerkIds)].slice(0, 200).map((clerkId) =>
        ctx.db
          .query("users")
          .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
          .unique(),
      ),
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
    await ctx.db.insert("users", { ...profileFields(identity), onboardingCompletedAt: Date.now() });
  },
});
