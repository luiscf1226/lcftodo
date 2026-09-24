import type { UserIdentity } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type Member = {
  userId: string;
  orgId: string;
  isAdmin: boolean;
};

// Supports both a Clerk JWT template named "convex" with custom claims
// { "org_id": "{{org.id}}", "org_role": "{{org.role}}" } and Clerk's native
// Convex integration, whose session token carries an `o: { id, rol }` claim.
function readOrg(identity: UserIdentity): { orgId?: string; role?: string } {
  const claims = identity as Record<string, unknown>;
  const o = claims.o as { id?: string; rol?: string } | undefined;
  const orgId = (claims.org_id ?? claims["o.id"] ?? o?.id) as string | undefined;
  const rawRole = (claims.org_role ?? claims["o.rol"] ?? o?.rol) as string | undefined;
  const role = rawRole && !rawRole.startsWith("org:") ? `org:${rawRole}` : rawRole;
  return { orgId: orgId || undefined, role };
}

export async function getMember(ctx: QueryCtx): Promise<Member | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const { orgId, role } = readOrg(identity);
  if (!orgId) return null;
  const sync = await ctx.db
    .query("membershipSync")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .unique();
  if (sync?.ready) {
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", identity.subject))
      .unique();
    if (!membership?.active) return null;
    return { userId: identity.subject, orgId, isAdmin: membership.role === "org:admin" };
  }
  // Existing organizations keep working until their one-off Clerk backfill completes.
  return { userId: identity.subject, orgId, isAdmin: role === "org:admin" };
}

export async function requireMember(ctx: QueryCtx): Promise<Member> {
  const member = await getMember(ctx);
  if (!member) throw new Error("You must be signed in to a team.");
  return member;
}

// ---------------------------------------------------------------------------
// Project access (#46)
//
// Policy:
// - Admins can read and manage every project of their team.
// - While a team has not turned on "restricted project access" (the default, and the state of
//   every team that existed before #46), every active member can read every project.
// - Once restricted, a non-admin member can only read and write projects they hold an explicit
//   `projectMemberships` grant for. Anything else behaves exactly as if the project didn't exist.
// ---------------------------------------------------------------------------

export async function isRestricted(ctx: QueryCtx, orgId: string): Promise<boolean> {
  const settings = await ctx.db
    .query("teamSettings")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .unique();
  return settings?.restrictedProjectAccess ?? false;
}

export async function hasProjectGrant(ctx: QueryCtx, projectId: Id<"projects">, userId: string): Promise<boolean> {
  const grant = await ctx.db
    .query("projectMemberships")
    .withIndex("by_project_user", (q) => q.eq("projectId", projectId).eq("userId", userId))
    .first();
  return grant !== null;
}

/**
 * The project ids a member may read, or `"all"` when the member is not restricted
 * (admins, and every member of an unrestricted team). Callers still filter by org and
 * `deleting` themselves.
 */
export async function accessibleProjectIds(ctx: QueryCtx, member: Member): Promise<"all" | Set<Id<"projects">>> {
  if (member.isAdmin || !(await isRestricted(ctx, member.orgId))) return "all";
  const grants = await ctx.db
    .query("projectMemberships")
    .withIndex("by_org_user", (q) => q.eq("orgId", member.orgId).eq("userId", member.userId))
    .collect();
  return new Set(grants.map((g) => g.projectId));
}

export const inScope = (scope: "all" | Set<Id<"projects">>, projectId: Id<"projects">) =>
  scope === "all" || scope.has(projectId);

/** True if the member may read this project (same team, not being deleted, and allowed by the access policy). */
export async function canReadProject(ctx: QueryCtx, member: Member, project: Doc<"projects"> | null): Promise<boolean> {
  if (!project || project.orgId !== member.orgId || project.deleting) return false;
  if (member.isAdmin || !(await isRestricted(ctx, member.orgId))) return true;
  return await hasProjectGrant(ctx, project._id, member.userId);
}

/**
 * Whether another team member (by Clerk user id) may access a project: used for assignee
 * eligibility. Requires an active synced membership in the project's team.
 */
export async function userCanAccessProject(ctx: QueryCtx, project: Doc<"projects">, userId: string): Promise<boolean> {
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_org_user", (q) => q.eq("orgId", project.orgId).eq("userId", userId))
    .unique();
  if (!membership?.active) return false;
  if (membership.role === "org:admin" || !(await isRestricted(ctx, project.orgId))) return true;
  return await hasProjectGrant(ctx, project._id, userId);
}

/**
 * Loads a project the member may access. Projects of other teams, and projects the member
 * has no access to, are reported identically as "not found" so ids reveal nothing.
 */
export async function requireProject(
  ctx: QueryCtx,
  member: Member,
  projectId: Id<"projects">,
): Promise<Doc<"projects">> {
  const project = await ctx.db.get(projectId);
  if (!project || project.orgId !== member.orgId) throw new Error("Project not found.");
  if (
    !member.isAdmin &&
    (await isRestricted(ctx, member.orgId)) &&
    !(await hasProjectGrant(ctx, projectId, member.userId))
  ) {
    throw new Error("Project not found.");
  }
  return project;
}

/** Alias that reads well at call sites that only need the access check. */
export const requireProjectAccess = requireProject;

/**
 * Like requireProject, but also rejects projects whose todos are frozen:
 * archived projects (#18) and projects that are being deleted (#16).
 */
export async function requireWritableProject(
  ctx: QueryCtx,
  member: Member,
  projectId: Id<"projects">,
): Promise<Doc<"projects">> {
  const project = await requireProject(ctx, member, projectId);
  if (project.archived) {
    throw new Error("This project is archived. Restore it to make changes.");
  }
  if (project.deleting) {
    throw new Error("This project is being deleted.");
  }
  return project;
}

export async function requireTodo(ctx: QueryCtx, member: Member, todoId: Id<"todos">): Promise<Doc<"todos">> {
  const todo = await ctx.db.get(todoId);
  if (!todo || todo.orgId !== member.orgId) throw new Error("Todo not found.");
  // A todo in a project the member can't access is reported the same way (#46).
  if (
    !member.isAdmin &&
    (await isRestricted(ctx, member.orgId)) &&
    !(await hasProjectGrant(ctx, todo.projectId, member.userId))
  ) {
    throw new Error("Todo not found.");
  }
  return todo;
}

export async function log(
  ctx: MutationCtx,
  member: Member,
  project: Doc<"projects">,
  entry: Omit<Doc<"activity">, "_id" | "_creationTime" | "orgId" | "projectId" | "projectName" | "actorId">,
) {
  await ctx.db.insert("activity", {
    orgId: member.orgId,
    projectId: project._id,
    projectName: project.name,
    actorId: member.userId,
    ...entry,
  });
}
