import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { accessibleProjectIds, getMember, hasProjectGrant, isRestricted, requireMember, type Member } from "./lib/auth";
import { MAX_RANGE_DAYS } from "./lib/constants";

// Project access management (#46). See the policy in lib/auth.ts.

async function requireAdmin(ctx: QueryCtx): Promise<Member> {
  const member = await requireMember(ctx);
  if (!member.isAdmin) throw new Error("Only team admins can manage project access.");
  return member;
}

/** A live project of the admin's team (not being deleted). */
async function teamProject(ctx: QueryCtx, member: Member, projectId: Id<"projects">): Promise<Doc<"projects">> {
  const project = await ctx.db.get(projectId);
  if (!project || project.orgId !== member.orgId || project.deleting) throw new Error("Project not found.");
  return project;
}

async function membershipOf(ctx: QueryCtx, orgId: string, userId: string) {
  return await ctx.db
    .query("memberships")
    .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", userId))
    .unique();
}

/** Idempotently grants a user access to a project. Returns true if a grant was created. */
export async function grantProject(
  ctx: MutationCtx,
  project: Doc<"projects">,
  userId: string,
  grantedBy: string,
): Promise<boolean> {
  if (await hasProjectGrant(ctx, project._id, userId)) return false;
  await ctx.db.insert("projectMemberships", {
    orgId: project.orgId,
    projectId: project._id,
    userId,
    grantedBy,
    grantedAt: Date.now(),
  });
  return true;
}

/** Removes every project grant a user holds in a team (team removal, #46). */
export async function revokeAllGrants(ctx: MutationCtx, orgId: string, userId: string) {
  const grants = await ctx.db
    .query("projectMemberships")
    .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", userId))
    .collect();
  for (const g of grants) await ctx.db.delete(g._id);
}

/** The caller's access summary, used for empty states and to hide admin controls. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const member = await getMember(ctx);
    if (!member) return null;
    const [restricted, scope] = await Promise.all([isRestricted(ctx, member.orgId), accessibleProjectIds(ctx, member)]);
    return {
      userId: member.userId,
      isAdmin: member.isAdmin,
      restricted,
      // Only meaningful for restricted members: how many projects they were granted.
      grantedProjects: scope === "all" ? null : scope.size,
    };
  },
});

/** Everything the Team page's access panel needs. Admin only. */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const member = await getMember(ctx);
    if (!member?.isAdmin) return null;
    const [settings, sync, grants, invitations, projects] = await Promise.all([
      ctx.db
        .query("teamSettings")
        .withIndex("by_org", (q) => q.eq("orgId", member.orgId))
        .unique(),
      ctx.db
        .query("membershipSync")
        .withIndex("by_org", (q) => q.eq("orgId", member.orgId))
        .unique(),
      ctx.db
        .query("projectMemberships")
        .withIndex("by_org", (q) => q.eq("orgId", member.orgId))
        .collect(),
      ctx.db
        .query("projectInvitations")
        .withIndex("by_org", (q) => q.eq("orgId", member.orgId))
        .order("desc")
        .take(200),
      ctx.db
        .query("projects")
        .withIndex("by_org", (q) => q.eq("orgId", member.orgId))
        .collect(),
    ]);
    const live = new Set(projects.filter((p) => !p.deleting).map((p) => p._id));
    const grantsByUser: Record<string, Id<"projects">[]> = {};
    for (const g of grants) {
      if (!live.has(g.projectId)) continue;
      (grantsByUser[g.userId] ??= []).push(g.projectId);
    }
    return {
      restricted: settings?.restrictedProjectAccess ?? false,
      membershipSyncReady: sync?.ready ?? false,
      grantsByUser,
      invitations: invitations.map((i) => ({
        _id: i._id,
        email: i.email,
        role: i.role,
        status: i.status,
        projectIds: i.projectIds.filter((id) => live.has(id)),
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
        expiresAt: i.expiresAt ?? null,
        acceptedUserId: i.acceptedUserId ?? null,
      })),
    };
  },
});

/**
 * Who may be assigned work in a project. `restricted: false` means every active team member
 * is eligible (the UI then shows the whole team); otherwise `userIds` lists the eligible people.
 */
export const assignable = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const member = await getMember(ctx);
    if (!member) return null;
    const project = await ctx.db.get(projectId);
    if (!project || project.orgId !== member.orgId || project.deleting) return null;
    const restricted = await isRestricted(ctx, member.orgId);
    if (!restricted) return { restricted: false as const, userIds: [] as string[] };
    if (!member.isAdmin && !(await hasProjectGrant(ctx, projectId, member.userId))) return null;
    const [memberships, grants] = await Promise.all([
      ctx.db
        .query("memberships")
        .withIndex("by_org", (q) => q.eq("orgId", member.orgId))
        .collect(),
      ctx.db
        .query("projectMemberships")
        .withIndex("by_project_user", (q) => q.eq("projectId", projectId))
        .collect(),
    ]);
    const granted = new Set(grants.map((g) => g.userId));
    const userIds = memberships
      .filter((m) => m.active && (m.role === "org:admin" || granted.has(m.userId)))
      .map((m) => m.userId);
    return { restricted: true as const, userIds };
  },
});

/**
 * Turns restricted project access on or off for the team. Turning it on can first grant every
 * member the projects they already work in (assigned to or created a todo in the last year,
 * or created the project), so nobody silently loses their current work.
 */
export const setRestricted = mutation({
  args: { enabled: v.boolean(), seedFromWork: v.optional(v.boolean()) },
  handler: async (ctx, { enabled, seedFromWork }) => {
    const member = await requireAdmin(ctx);
    let seeded = 0;
    if (enabled && seedFromWork) seeded = await seedGrantsFromWork(ctx, member);
    const existing = await ctx.db
      .query("teamSettings")
      .withIndex("by_org", (q) => q.eq("orgId", member.orgId))
      .unique();
    const fields = { restrictedProjectAccess: enabled, updatedBy: member.userId, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, fields);
    // The row is shared with the time zone / carry-over settings (#21, #22); keep their defaults.
    else await ctx.db.insert("teamSettings", { orgId: member.orgId, autoCarryOver: false, ...fields });
    return { seeded };
  },
});

const SEED_TODO_CAP = 8000;

async function seedGrantsFromWork(ctx: MutationCtx, member: Member): Promise<number> {
  const since = new Date(Date.now() - MAX_RANGE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [projects, todos, memberships] = await Promise.all([
    ctx.db
      .query("projects")
      .withIndex("by_org", (q) => q.eq("orgId", member.orgId))
      .collect(),
    ctx.db
      .query("todos")
      .withIndex("by_org_date", (q) => q.eq("orgId", member.orgId).gte("date", since))
      .take(SEED_TODO_CAP),
    ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", member.orgId))
      .collect(),
  ]);
  // Removed members get nothing; people without a synced row yet (pre-backfill) are included.
  const inactive = new Set(memberships.filter((m) => !m.active).map((m) => m.userId));
  const admins = new Set(memberships.filter((m) => m.active && m.role === "org:admin").map((m) => m.userId));
  const byId = new Map(projects.filter((p) => !p.deleting).map((p) => [p._id, p]));
  const pairs = new Map<string, { project: Doc<"projects">; userId: string }>();
  const add = (projectId: Id<"projects">, userId: string | undefined) => {
    const project = byId.get(projectId);
    if (!project || !userId || inactive.has(userId) || admins.has(userId) || userId === member.userId) return;
    pairs.set(`${projectId}:${userId}`, { project, userId });
  };
  for (const p of byId.values()) add(p._id, p.createdBy);
  for (const t of todos) {
    // Personal todos (no project) grant nothing.
    if (!t.projectId) continue;
    add(t.projectId, t.assigneeId);
    add(t.projectId, t.createdBy);
  }
  let created = 0;
  for (const { project, userId } of pairs.values()) {
    if (await grantProject(ctx, project, userId, member.userId)) created++;
  }
  return created;
}

/** Grants an existing, active team member access to a project. Admin only. */
export const grant = mutation({
  args: { projectId: v.id("projects"), userId: v.string() },
  handler: async (ctx, { projectId, userId }) => {
    const member = await requireAdmin(ctx);
    const project = await teamProject(ctx, member, projectId);
    const membership = await membershipOf(ctx, member.orgId, userId);
    if (!membership?.active) throw new Error("That person isn't an active member of this team yet.");
    await grantProject(ctx, project, userId, member.userId);
  },
});

/**
 * Revokes a member's access to a project. Admin only. Their reads and writes stop immediately.
 * Todos already assigned to them keep the historical assignee (so history stays accurate) but
 * leave their work list; the returned count tells the admin how many open todos to reassign.
 */
export const revoke = mutation({
  args: { projectId: v.id("projects"), userId: v.string() },
  handler: async (ctx, { projectId, userId }) => {
    const member = await requireAdmin(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.orgId !== member.orgId) throw new Error("Project not found.");
    const grants = await ctx.db
      .query("projectMemberships")
      .withIndex("by_project_user", (q) => q.eq("projectId", projectId).eq("userId", userId))
      .collect();
    for (const g of grants) await ctx.db.delete(g._id);
    return { openAssigned: await openAssignedCount(ctx, projectId, userId) };
  },
});

const OPEN_SCAN_CAP = 2000;

async function openAssignedCount(ctx: QueryCtx, projectId: Id<"projects">, userId: string) {
  const since = new Date(Date.now() - MAX_RANGE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const todos = await ctx.db
    .query("todos")
    .withIndex("by_project_date", (q) => q.eq("projectId", projectId).gte("date", since))
    .take(OPEN_SCAN_CAP);
  return todos.filter((t) => t.assigneeId === userId && (t.status === "todo" || t.status === "doing")).length;
}

/** First-run checklist for a new admin: team → first project → invite → assign. */
export const setupStatus = query({
  args: {},
  handler: async (ctx) => {
    const member = await getMember(ctx);
    if (!member?.isAdmin) return null;
    const [project, invitation, memberships, todos] = await Promise.all([
      ctx.db
        .query("projects")
        .withIndex("by_org", (q) => q.eq("orgId", member.orgId))
        .first(),
      ctx.db
        .query("projectInvitations")
        .withIndex("by_org", (q) => q.eq("orgId", member.orgId))
        .first(),
      ctx.db
        .query("memberships")
        .withIndex("by_org", (q) => q.eq("orgId", member.orgId))
        .take(2),
      ctx.db
        .query("todos")
        .withIndex("by_org_date", (q) => q.eq("orgId", member.orgId))
        .order("desc")
        .take(200),
    ]);
    return {
      hasProject: project !== null,
      hasInvited: invitation !== null || memberships.length > 1,
      hasAssigned: todos.some((t) => t.assigneeId !== undefined),
    };
  },
});
