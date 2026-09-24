import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { requireMember } from "./lib/auth";
import { isTombstoned, tombstone } from "./lib/tombstones";

const membership = v.object({
  membershipId: v.string(), userId: v.string(), role: v.string(), createdAt: v.number(), updatedAt: v.number(),
});

export const applyWebhook = internalMutation({
  args: {
    orgId: v.string(), userId: v.string(), membershipId: v.string(), role: v.string(), active: v.boolean(),
    createdAt: v.number(), updatedAt: v.number(),
  },
  handler: async (ctx, { orgId, userId, membershipId, role, active, createdAt, updatedAt }) => {
    if (!orgId || !userId || !membershipId || !Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) {
      throw new Error("Invalid membership event.");
    }
    // Clerk retries webhooks, and delivery may arrive out of order. A deleted
    // membership id never comes back; re-inviting creates a new id.
    if (await isTombstoned(ctx, "membership", membershipId) || await isTombstoned(ctx, "user", userId)) return;
    if (!active) await tombstone(ctx, "membership", membershipId);
    const existing = await ctx.db.query("memberships")
      .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", userId)).unique();
    const now = Date.now();
    if (!existing) {
      await ctx.db.insert("memberships", {
        orgId, userId, role, active, membershipId, membershipCreatedAt: createdAt, lastEventAt: updatedAt, updatedAt: now,
      });
      return;
    }
    if (existing.membershipId === membershipId) {
      if (active && (existing.lastEventAt ?? 0) > updatedAt) return;
    } else if (existing.membershipId && (existing.membershipCreatedAt ?? 0) > createdAt) {
      return;
    }
    await ctx.db.patch(existing._id, {
      role, active, membershipId, membershipCreatedAt: createdAt, lastEventAt: updatedAt, updatedAt: now,
    });
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
    for (const { membershipId, userId, role, createdAt, updatedAt } of members) {
      if (!userId || !membershipId) throw new Error("Invalid membership from Clerk.");
      const existing = await ctx.db.query("memberships")
        .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", userId)).unique();
      if (existing && existing.updatedAt >= startedAt) continue;
      const fields = {
        role, active: true, membershipId, membershipCreatedAt: createdAt, lastEventAt: updatedAt,
        updatedAt: startedAt, backfillRunId: runId,
      };
      if (await isTombstoned(ctx, "membership", membershipId) || await isTombstoned(ctx, "user", userId)) {
        if (existing) await ctx.db.patch(existing._id, { ...fields, active: false });
        continue;
      }
      if (existing) await ctx.db.patch(existing._id, fields);
      else await ctx.db.insert("memberships", { orgId, userId, ...fields });
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
      if (row.backfillRunId === runId || row.updatedAt >= startedAt) continue;
      if (row.membershipId) await tombstone(ctx, "membership", row.membershipId);
      if (row.active) await ctx.db.patch(row._id, { active: false, updatedAt: startedAt });
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
    // Offset pages can skip or repeat members if the list changes mid-read, so
    // only reconcile when two consecutive full reads return the same unique set.
    const first = await fetchAllMemberships(orgId, secret);
    const second = await fetchAllMemberships(orgId, secret);
    if (first.length !== second.length ||
        first.some((m, i) => m.membershipId !== second[i].membershipId || m.role !== second[i].role)) {
      throw new Error("Clerk memberships changed during backfill; retry.");
    }
    for (let i = 0; i < first.length; i += 100) {
      await ctx.runMutation(internal.memberships.applyBackfillPage, {
        orgId, runId, startedAt, members: first.slice(i, i + 100),
      });
    }

    let cursor: string | null = null;
    for (;;) {
      const page: { cursor: string; isDone: boolean } = await ctx.runMutation(
        internal.memberships.finishBackfillPage, { orgId, runId, startedAt, cursor },
      );
      if (page.isDone) break;
      cursor = page.cursor;
    }
    await ctx.runMutation(internal.memberships.completeBackfill, { orgId, startedAt });
    return first.length;
  },
});

type ClerkMembership = {
  membershipId: string; userId: string; role: string; createdAt: number; updatedAt: number;
};

async function fetchAllMemberships(orgId: string, secret: string): Promise<ClerkMembership[]> {
  const limit = 100;
  const byId = new Map<string, ClerkMembership>();
  const userIds = new Set<string>();
  let totalCount: number | undefined;
  let offset = 0;
  do {
    const url = new URL(`https://api.clerk.com/v1/organizations/${encodeURIComponent(orgId)}/memberships`);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    const response = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
    if (!response.ok) throw new Error(`Clerk membership backfill failed (${response.status}).`);
    const body = await response.json() as {
      data?: Array<{
        id?: unknown; role?: unknown; created_at?: unknown; updated_at?: unknown;
        public_user_data?: { user_id?: unknown };
      }>;
      total_count?: unknown;
    };
    if (!Array.isArray(body.data) || typeof body.total_count !== "number") {
      throw new Error("Unexpected Clerk membership response.");
    }
    if (totalCount !== undefined && body.total_count !== totalCount) {
      throw new Error("Clerk memberships changed during backfill; retry.");
    }
    totalCount = body.total_count;
    for (const m of body.data) {
      const member = {
        membershipId: m.id, userId: m.public_user_data?.user_id, role: m.role,
        createdAt: m.created_at, updatedAt: m.updated_at,
      };
      if (typeof member.membershipId !== "string" || !member.membershipId ||
          typeof member.userId !== "string" || !member.userId ||
          typeof member.role !== "string" || !member.role ||
          typeof member.createdAt !== "number" || typeof member.updatedAt !== "number") {
        throw new Error("Invalid Clerk membership response.");
      }
      if (byId.has(member.membershipId) || userIds.has(member.userId)) {
        throw new Error("Clerk memberships changed during backfill; retry.");
      }
      byId.set(member.membershipId, member as ClerkMembership);
      userIds.add(member.userId);
    }
    offset += body.data.length;
    if (body.data.length === 0 && offset < totalCount) throw new Error("Incomplete Clerk membership response.");
  } while (offset < totalCount);
  if (byId.size !== totalCount) throw new Error("Clerk memberships changed during backfill; retry.");
  return [...byId.values()].sort((a, b) => a.membershipId.localeCompare(b.membershipId));
}
