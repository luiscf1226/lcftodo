import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { canReadProject, getMember, getTokenMember, requireMember, type Member } from "./lib/auth";
import { hashToken, newToken, TOKEN_PREFIX_LENGTH } from "./lib/mcp";
import { dateKeyInZone } from "./lib/timezone";
import { requiredText } from "./lib/validate";
import { createTodo, teamTodos } from "./todos";

// Personal access tokens for the MCP endpoint (see ./lib/mcp.ts and the `/mcp` route in ./http.ts).

export const MAX_TOKENS = 10;

/** The caller's tokens in the current team (never the token itself) and the MCP endpoint URL. */
export const listTokens = query({
  args: {},
  handler: async (ctx) => {
    const member = await getMember(ctx);
    if (!member) return null;
    const tokens = await ctx.db
      .query("apiTokens")
      .withIndex("by_user_org", (q) => q.eq("userId", member.userId).eq("orgId", member.orgId))
      .collect();
    const site = process.env.CONVEX_SITE_URL;
    return {
      endpoint: site ? `${site.replace(/\/+$/, "")}/mcp` : null,
      tokens: tokens.map((t) => ({
        _id: t._id,
        name: t.name,
        prefix: t.prefix,
        createdAt: t._creationTime,
        lastUsedAt: t.lastUsedAt ?? null,
      })),
    };
  },
});

/** Creates a token and returns it. This is the only time the token itself is available. */
export const createToken = action({
  args: { name: v.string() },
  handler: async (ctx, { name }): Promise<string> => {
    const token = newToken();
    await ctx.runMutation(internal.mcp.insertToken, {
      name,
      tokenHash: await hashToken(token),
      prefix: token.slice(0, TOKEN_PREFIX_LENGTH),
    });
    return token;
  },
});

export const insertToken = internalMutation({
  args: { name: v.string(), tokenHash: v.string(), prefix: v.string() },
  handler: async (ctx, { name, tokenHash, prefix }) => {
    const member = await requireMember(ctx);
    const existing = await ctx.db
      .query("apiTokens")
      .withIndex("by_user_org", (q) => q.eq("userId", member.userId).eq("orgId", member.orgId))
      .collect();
    if (existing.length >= MAX_TOKENS) throw new Error(`You can have at most ${MAX_TOKENS} access tokens.`);
    await ctx.db.insert("apiTokens", {
      orgId: member.orgId,
      userId: member.userId,
      name: requiredText(name, 60, "Name"),
      tokenHash,
      prefix,
      isAdmin: member.isAdmin,
    });
  },
});

export const revokeToken = mutation({
  args: { tokenId: v.id("apiTokens") },
  handler: async (ctx, { tokenId }) => {
    const member = await requireMember(ctx);
    const token = await ctx.db.get(tokenId);
    if (!token || token.userId !== member.userId || token.orgId !== member.orgId) {
      throw new Error("Access token not found.");
    }
    await ctx.db.delete(tokenId);
  },
});

// --- Used by the `/mcp` HTTP route. Each call re-checks the token, so a revoked token stops at once. ---

async function requireTokenMember(ctx: QueryCtx, tokenHash: string): Promise<Member> {
  const found = await getTokenMember(ctx, tokenHash);
  if (!found) throw new Error("Invalid access token.");
  return found.member;
}

/** Validates a token and records when it was last used (at most once a minute). */
export const authenticate = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const found = await getTokenMember(ctx, tokenHash);
    if (!found) return false;
    const now = Date.now();
    if (!found.token.lastUsedAt || now - found.token.lastUsedAt > 60_000) {
      await ctx.db.patch(found.token._id, { lastUsedAt: now });
    }
    return true;
  },
});

async function teamToday(ctx: QueryCtx, orgId: string): Promise<string> {
  const settings = await ctx.db
    .query("teamSettings")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .unique();
  return dateKeyInZone(Date.now(), settings?.timeZone ?? "UTC");
}

/** Projects the member can read, including archived ones (flagged; they can't take new tasks). */
async function readableProjects(ctx: QueryCtx, member: Member): Promise<Doc<"projects">[]> {
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_org", (q) => q.eq("orgId", member.orgId))
    .collect();
  const readable: Doc<"projects">[] = [];
  for (const project of projects) if (await canReadProject(ctx, member, project)) readable.push(project);
  return readable;
}

/** Resolves a project given by id or by (case-insensitive) name. */
async function findProject(ctx: QueryCtx, member: Member, ref: string): Promise<Id<"projects">> {
  const projects = await readableProjects(ctx, member);
  const byId = projects.find((p) => p._id === ref);
  if (byId) return byId._id;
  const wanted = ref.trim().toLowerCase();
  const matches = projects.filter((p) => p.name.trim().toLowerCase() === wanted);
  if (matches.length === 1) return matches[0]._id;
  if (matches.length > 1) throw new Error(`More than one project is named "${ref}". Use its id instead.`);
  throw new Error(`Project "${ref}" not found. Call list_projects to see the available projects.`);
}

export const listProjects = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const member = await requireTokenMember(ctx, tokenHash);
    return (await readableProjects(ctx, member)).map((p) => ({
      id: p._id,
      name: p.name,
      description: p.description ?? null,
      archived: p.archived,
    }));
  },
});

export const listTasks = internalQuery({
  args: { tokenHash: v.string(), from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, { tokenHash, from, to }) => {
    const member = await requireTokenMember(ctx, tokenHash);
    const start = from ?? to ?? (await teamToday(ctx, member.orgId));
    const todos = await teamTodos(ctx, member, start, to ?? start);
    return todos.map((t) => ({
      id: t._id,
      title: t.title,
      date: t.date,
      status: t.status,
      project: t.projectId ? t.projectName : null,
      notes: t.notes ?? null,
    }));
  },
});

export const createTask = internalMutation({
  args: {
    tokenHash: v.string(),
    title: v.string(),
    date: v.optional(v.string()),
    notes: v.optional(v.string()),
    project: v.optional(v.string()),
  },
  handler: async (ctx, { tokenHash, title, date, notes, project }) => {
    const member = await requireTokenMember(ctx, tokenHash);
    const projectId = project?.trim() ? await findProject(ctx, member, project) : undefined;
    const day = date ?? (await teamToday(ctx, member.orgId));
    const todoId = await createTodo(ctx, member, { projectId, title, date: day, notes });
    const todo = (await ctx.db.get(todoId))!;
    const projectName = projectId ? (await ctx.db.get(projectId))!.name : null;
    return { id: todoId, title: todo.title, date: todo.date, project: projectName };
  },
});
