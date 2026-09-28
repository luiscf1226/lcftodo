import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

// The MCP endpoint (`/mcp`): personal access tokens and the create/list tools.

const modules = import.meta.glob("./**/*.ts");

const alice = { subject: "user_alice", name: "Alice", org_id: "org_a", org_role: "org:admin" };
const bob = { subject: "user_bob", name: "Bob", org_id: "org_a", org_role: "org:member" };

const MON = "2026-09-21";

async function setup() {
  const t = convexTest(schema, modules);
  for (const [i, user] of [alice, bob].entries()) {
    await t.mutation(internal.memberships.applyWebhook, {
      orgId: "org_a",
      userId: user.subject,
      membershipId: `mem_${user.subject}`,
      role: user.org_role,
      active: true,
      createdAt: i + 1,
      updatedAt: i + 1,
    });
  }
  await t.mutation(internal.memberships.completeBackfill, { orgId: "org_a", startedAt: 0 });
  const a = t.withIdentity(alice);
  const b = t.withIdentity(bob);
  const token = await a.action(api.mcp.createToken, { name: "Claude" });
  let nextId = 1;
  const rpc = async (method: string, params?: unknown, auth = token) => {
    const res = await t.fetch("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    });
    return { status: res.status, body: res.status === 200 ? await res.json() : null };
  };
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await rpc("tools/call", { name, arguments: args })).body.result;
  return { t, a, b, token, rpc, call };
}

describe("MCP endpoint", () => {
  test("rejects requests without a valid token", async () => {
    const { rpc } = await setup();
    expect((await rpc("tools/list", {}, "lcf_wrong")).status).toBe(401);
  });

  test("initializes and lists the tools", async () => {
    const { rpc } = await setup();
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: {} });
    expect(init.body.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} } });
    const tools = await rpc("tools/list");
    expect(tools.body.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "create_task",
      "list_projects",
      "list_tasks",
    ]);
  });

  test("notifications are accepted without a body", async () => {
    const { t, token } = await setup();
    const res = await t.fetch("/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(res.status).toBe(202);
  });

  test("create_task adds a personal task for the token's owner", async () => {
    const { a, call } = await setup();
    const result = await call("create_task", { title: "Call the bank", date: MON, notes: "Ask about fees" });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ title: "Call the bank", date: MON, project: null });
    const todos = await a.query(api.todos.listPersonal, { from: MON, to: MON });
    expect(todos.map((todo) => [todo.title, todo.notes, todo.createdBy])).toEqual([
      ["Call the bank", "Ask about fees", alice.subject],
    ]);
  });

  test("create_task defaults to today and resolves projects by name", async () => {
    const { a, call } = await setup();
    const projectId = await a.mutation(api.projects.create, { name: "Launch", color: "#6366f1" });
    const result = await call("create_task", { title: "Ship it", project: "launch" });
    expect(result.structuredContent.project).toBe("Launch");
    const today = new Date().toISOString().slice(0, 10);
    const todos = await a.query(api.todos.listForProject, { projectId, from: today, to: today });
    expect(todos.map((todo) => todo.title)).toEqual(["Ship it"]);
  });

  test("tool errors are reported to the client", async () => {
    const { call } = await setup();
    const unknownProject = await call("create_task", { title: "x", project: "Nope" });
    expect(unknownProject.isError).toBe(true);
    expect(unknownProject.content[0].text).toMatch(/not found/);
    const badDate = await call("create_task", { title: "x", date: "tomorrow" });
    expect(badDate).toMatchObject({ isError: true, content: [{ text: "Invalid date." }] });
  });

  test("list_projects and list_tasks respect project access", async () => {
    const { a, b, call } = await setup();
    await a.mutation(api.projects.create, { name: "Visible", color: "#6366f1" });
    await b.mutation(api.todos.create, { title: "Bob's private task", date: MON });
    await call("create_task", { title: "Mine", date: MON });
    const projects = await call("list_projects");
    expect(projects.structuredContent.projects.map((p: { name: string }) => p.name)).toEqual(["Visible"]);
    const tasks = await call("list_tasks", { from: MON });
    expect(tasks.structuredContent.tasks.map((task: { title: string }) => task.title)).toEqual(["Mine"]);
  });

  test("revoked tokens and removed members stop working", async () => {
    const { t, a, b, token, rpc } = await setup();
    const bobToken = await b.action(api.mcp.createToken, { name: "Laptop" });
    await t.mutation(internal.memberships.applyWebhook, {
      orgId: "org_a",
      userId: bob.subject,
      membershipId: `mem_${bob.subject}`,
      role: bob.org_role,
      active: false,
      createdAt: 2,
      updatedAt: 10,
    });
    expect((await rpc("tools/list", {}, bobToken)).status).toBe(401);

    const listed = await a.query(api.mcp.listTokens, {});
    expect(listed?.tokens).toHaveLength(1);
    expect(listed?.tokens[0]).toMatchObject({ name: "Claude", prefix: token.slice(0, 8) });
    expect(JSON.stringify(listed)).not.toContain(token);
    await expect(b.mutation(api.mcp.revokeToken, { tokenId: listed!.tokens[0]._id })).rejects.toThrow();
    await a.mutation(api.mcp.revokeToken, { tokenId: listed!.tokens[0]._id });
    expect((await rpc("tools/list", {}, token)).status).toBe(401);
  });
});
