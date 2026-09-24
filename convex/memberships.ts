import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { requireMember } from "./lib/auth";

const membership = v.object({ userId: v.string(), role: v.string() });

export const applyWebhook = internalMutation({
  args: {
    orgId: v.string(), userId: v.string(), role: v.string(), active: v.boolean(), eventAt: v.number(),
  },
  handler: async (ctx, { orgId, userId, role, active, eventAt }) => {
    if (!orgId || !userId || !Number.isFinite(eventAt)) throw new Error("Invalid membership event.");
    const existing = await ctx.db.query("memberships")
      .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", userId)).unique();
    // Clerk retries webhooks, and delivery may arrive out of order.
    if (existing?.lastEventAt && existing.lastEventAt > eventAt) return;
    const updatedAt = Date.now();
    if (existing) await ctx.db.patch(existing._id, { role, active, lastEventAt: eventAt, updatedAt });
    else await ctx.db.insert("memberships", { orgId, userId, role, active, lastEventAt: eventAt, updatedAt });
  },
});

export const assertAdminForBackfill = internalQuery({
  args: {},
  handler: async (ctx) => {
    const member = await requireMember(ctx);
    if (!member.isAdmin) throw new Error("Only team admins can backfill memberships.");
    return member.orgId;
  },
});

export const applyBackfillPage = internalMutation({
  args: { orgId: v.string(), runId: v.string(), startedAt: v.number(), members: v.array(membership) },
  handler: async (ctx, { orgId, runId, startedAt, members }) => {
    for (const { userId, role } of members) {
      if (!userId) throw new Error("Invalid membership from Clerk.");
      const existing = await ctx.db.query("memberships")
        .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", userId)).unique();
      if (existing && existing.updatedAt >= startedAt) continue;
      if (existing) await ctx.db.patch(existing._id, { role, active: true, updatedAt: startedAt, backfillRunId: runId });
      else await ctx.db.insert("memberships", { orgId, userId, role, active: true, updatedAt: startedAt, backfillRunId: runId });
    }
  },
});

export const finishBackfillPage = internalMutation({
  args: { orgId: v.string(), runId: v.string(), startedAt: v.number(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { orgId, runId, startedAt, cursor }) => {
    const page = await ctx.db.query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .paginate({ numItems: 100, cursor });
    for (const row of page.page) {
      if (row.backfillRunId !== runId && row.updatedAt < startedAt && row.active) {
        await ctx.db.patch(row._id, { active: false, updatedAt: startedAt });
      }
    }
    return { cursor: page.continueCursor, isDone: page.isDone };
  },
});

export const completeBackfill = internalMutation({
  args: { orgId: v.string(), startedAt: v.number() },
  handler: async (ctx, { orgId, startedAt }) => {
    const existing = await ctx.db.query("membershipSync")
      .withIndex("by_org", (q) => q.eq("orgId", orgId)).unique();
    if (existing) await ctx.db.patch(existing._id, { ready: true, backfilledAt: startedAt });
    else await ctx.db.insert("membershipSync", { orgId, ready: true, backfilledAt: startedAt });
  },
});

/** Run once per existing organization after configuring the Clerk webhook. */
export const backfill = action({
  args: {},
  handler: async (ctx): Promise<number> => {
    const orgId = await ctx.runQuery(internal.memberships.assertAdminForBackfill, {});
    const secret = process.env.CLERK_SECRET_KEY;
    if (!secret) throw new Error("CLERK_SECRET_KEY is not configured in Convex.");
    const startedAt = Date.now();
    const runId = crypto.randomUUID();
    const limit = 100;
    let offset = 0;
    let totalCount = 0;
    do {
      const url = new URL(`https://api.clerk.com/v1/organizations/${encodeURIComponent(orgId)}/memberships`);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));
      const response = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
      if (!response.ok) throw new Error(`Clerk membership backfill failed (${response.status}).`);
      const body = await response.json() as {
        data?: Array<{ role?: string; public_user_data?: { user_id?: string } }>;
        total_count?: number;
      };
      if (!Array.isArray(body.data) || typeof body.total_count !== "number") {
        throw new Error("Unexpected Clerk membership response.");
      }
      const members = body.data.map((m) => ({ userId: m.public_user_data?.user_id ?? "", role: m.role ?? "" }));
      if (members.some((m) => !m.userId || !m.role)) throw new Error("Invalid Clerk membership response.");
      await ctx.runMutation(internal.memberships.applyBackfillPage, { orgId, runId, startedAt, members });
      offset += body.data.length;
      totalCount = body.total_count;
      if (body.data.length === 0 && offset < totalCount) throw new Error("Incomplete Clerk membership response.");
    } while (offset < totalCount);

    let cursor: string | null = null;
    for (;;) {
      const page: { cursor: string; isDone: boolean } = await ctx.runMutation(
        internal.memberships.finishBackfillPage, { orgId, runId, startedAt, cursor },
      );
      if (page.isDone) break;
      cursor = page.cursor;
    }
    await ctx.runMutation(internal.memberships.completeBackfill, { orgId, startedAt });
    return totalCount;
  },
});
