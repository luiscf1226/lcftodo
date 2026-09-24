import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireMember } from "./lib/auth";

// Called by the client after sign-in so teammates can see names and avatars.
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
