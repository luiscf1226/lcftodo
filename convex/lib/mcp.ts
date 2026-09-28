// A minimal Model Context Protocol server (Streamable HTTP transport, stateless, JSON responses)
// served at `/mcp`, so Claude and other MCP clients can list and add tasks. Clients authenticate
// with a personal access token: `Authorization: Bearer lcf_...`.

import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { LIMITS } from "./constants";

export const MCP_PATH = "/mcp";
export const TOKEN_PREFIX_LENGTH = 8;
const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_BODY = 100_000;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A new random access token: "lcf_" + 32 random bytes. */
export function newToken(): string {
  return `lcf_${toBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

/** Hex SHA-256 of a token; only the hash is stored. */
export async function hashToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

const DATE_HINT = 'Calendar day "YYYY-MM-DD".';

const TOOLS = [
  {
    name: "create_task",
    title: "Add a task",
    description:
      "Add a task to LCF Todos. Without a project it goes to the user's private inbox (Bandeja); " +
      "with a project, the whole project can see it. Defaults to today in the team's time zone.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "What needs to be done.", maxLength: LIMITS.todoTitle },
        date: { type: "string", description: `Day the task is planned for. ${DATE_HINT} Defaults to today.` },
        notes: { type: "string", description: "Optional details.", maxLength: LIMITS.todoNotes },
        project: {
          type: "string",
          description: "Optional project name or id (see list_projects). Omit to add it to the inbox.",
        },
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    name: "list_projects",
    title: "List projects",
    description: "List the projects the user can see. Archived projects can't take new tasks.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_tasks",
    title: "List tasks",
    description:
      "List the user's visible tasks for a day or an inclusive date range (at most a few weeks). " +
      "Defaults to today in the team's time zone. Useful to avoid adding duplicates.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: `First day. ${DATE_HINT}` },
        to: { type: "string", description: `Last day. ${DATE_HINT} Defaults to \`from\`.` },
      },
      additionalProperties: false,
    },
  },
] as const;

type JsonRpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: unknown };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const rpcError = (id: JsonRpcRequest["id"], code: number, message: string, status = 200) =>
  json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, status);

const optionalString = (args: Record<string, unknown>, key: string): string | undefined => {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`\`${key}\` must be a string.`);
  return value;
};

async function callTool(ctx: ActionCtx, tokenHash: string, name: string, args: Record<string, unknown>) {
  switch (name) {
    case "create_task": {
      const title = optionalString(args, "title");
      if (!title) throw new Error("`title` is required.");
      const task = await ctx.runMutation(internal.mcp.createTask, {
        tokenHash,
        title,
        date: optionalString(args, "date"),
        notes: optionalString(args, "notes"),
        project: optionalString(args, "project"),
      });
      const where = task.project ? `project "${task.project}"` : "the inbox (no project)";
      return { text: `Added "${task.title}" to ${where} for ${task.date}.`, structured: task };
    }
    case "list_projects": {
      const projects = await ctx.runQuery(internal.mcp.listProjects, { tokenHash });
      return { text: JSON.stringify(projects), structured: { projects } };
    }
    case "list_tasks": {
      const tasks = await ctx.runQuery(internal.mcp.listTasks, {
        tokenHash,
        from: optionalString(args, "from"),
        to: optionalString(args, "to"),
      });
      return { text: JSON.stringify(tasks), structured: { tasks } };
    }
    default:
      return null;
  }
}

/** Convex prefixes thrown errors with request details; keep only the message. */
function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^[\s\S]*?Uncaught Error: /, "").split("\n")[0] || "Something went wrong.";
}

export async function handleMcpRequest(ctx: ActionCtx, request: Request): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
  const tokenHash = token && token.length <= 200 ? await hashToken(token) : null;
  if (!tokenHash || !(await ctx.runMutation(internal.mcp.authenticate, { tokenHash }))) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid access token. Create one in LCF Todos → Notificaciones." }),
      {
        status: 401,
        headers: { "Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="lcftodos"' },
      },
    );
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY) return rpcError(null, -32600, "Request too large.", 413);
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return rpcError(null, -32700, "Parse error.", 400);
  }
  if (!message || typeof message !== "object" || Array.isArray(message) || !("method" in message)) {
    // Responses from the client, and JSON-RPC batches, aren't used by this server.
    return new Response(null, { status: 202 });
  }
  const { id, method, params } = message as JsonRpcRequest;
  // Notifications (no id) need no answer.
  if (id === undefined) return new Response(null, { status: 202 });
  const p = params && typeof params === "object" ? (params as Record<string, unknown>) : {};

  switch (method) {
    case "initialize": {
      const requested = typeof p.protocolVersion === "string" ? p.protocolVersion : "";
      return json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "lcftodos", title: "LCF Todos", version: "1.0.0" },
          instructions:
            "Use create_task to add tasks to the user's LCF Todos. Call list_projects first if the user names a project.",
        },
      });
    }
    case "ping":
      return json({ jsonrpc: "2.0", id, result: {} });
    case "tools/list":
      return json({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    case "tools/call": {
      const name = typeof p.name === "string" ? p.name : "";
      const args = p.arguments && typeof p.arguments === "object" ? (p.arguments as Record<string, unknown>) : {};
      try {
        const out = await callTool(ctx, tokenHash, name, args);
        if (!out) return rpcError(id, -32602, `Unknown tool: ${name}`);
        return json({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: out.text }], structuredContent: out.structured },
        });
      } catch (error) {
        return json({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: cleanError(error) }], isError: true },
        });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}
