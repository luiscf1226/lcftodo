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
  const sync = await ctx.db.query("membershipSync")
    .withIndex("by_org", (q) => q.eq("orgId", orgId)).unique();
  if (sync?.ready) {
    const membership = await ctx.db.query("memberships")
      .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", identity.subject)).unique();
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

export async function requireProject(
  ctx: QueryCtx,
  member: Member,
  projectId: Id<"projects">,
): Promise<Doc<"projects">> {
  const project = await ctx.db.get(projectId);
  if (!project || project.orgId !== member.orgId) throw new Error("Project not found.");
  return project;
}

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

export async function requireTodo(
  ctx: QueryCtx,
  member: Member,
  todoId: Id<"todos">,
): Promise<Doc<"todos">> {
  const todo = await ctx.db.get(todoId);
  if (!todo || todo.orgId !== member.orgId) throw new Error("Todo not found.");
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
