import type { MutationCtx, QueryCtx } from "../_generated/server";

type Kind = "membership" | "user";

export async function isTombstoned(ctx: QueryCtx, kind: Kind, clerkId: string): Promise<boolean> {
  const row = await ctx.db.query("tombstones")
    .withIndex("by_kind_clerkId", (q) => q.eq("kind", kind).eq("clerkId", clerkId)).first();
  return row !== null;
}

export async function tombstone(ctx: MutationCtx, kind: Kind, clerkId: string) {
  if (!(await isTombstoned(ctx, kind, clerkId))) await ctx.db.insert("tombstones", { kind, clerkId });
}
