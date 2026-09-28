import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { formatInviteCode, isInviteCode, normalizeInviteCode } from "./lib/inviteCode";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const admin = { subject: "user_admin", name: "Admin", org_id: "org_a", org_role: "org:admin" };
const member = { subject: "user_member", name: "Member", org_id: "org_a", org_role: "org:member" };
// Signed in, but not on any team yet (the email invitation never arrived).
const newcomer = { subject: "user_new", name: "New" };

const clerkMembership = (userId: string) =>
  new Response(
    JSON.stringify({
      id: `mem_${userId}`,
      role: "org:member",
      created_at: 1,
      updated_at: 1,
      organization: { id: "org_a" },
      public_user_data: { user_id: userId },
    }),
    { status: 200 },
  );

let previousSecret: string | undefined;
beforeEach(() => {
  previousSecret = process.env.CLERK_SECRET_KEY;
  process.env.CLERK_SECRET_KEY = "sk_test_example";
});
afterEach(() => {
  vi.restoreAllMocks();
  if (previousSecret === undefined) delete process.env.CLERK_SECRET_KEY;
  else process.env.CLERK_SECRET_KEY = previousSecret;
});

async function setup(options: { maxUses?: number } = {}) {
  const t = convexTest(schema, modules);
  const a = t.withIdentity(admin);
  const projectId = await a.mutation(api.projects.create, { name: "Launch", color: "#6366f1" });
  await a.mutation(api.projectAccess.setRestricted, { enabled: true });
  const { code } = await a.action(api.inviteCodes.create, {
    projectIds: [projectId],
    expiresInDays: 7,
    maxUses: options.maxUses,
  });
  return { t, a, projectId, code };
}

describe("invite codes", () => {
  test("format helpers accept what people type", () => {
    expect(normalizeInviteCode(" abcde-fghjk ")).toBe("ABCDEFGHJK");
    expect(isInviteCode("ABCDEFGHJK")).toBe(true);
    expect(isInviteCode("ABCDEFGHJ0")).toBe(false);
    expect(formatInviteCode("ABCDEFGHJK")).toBe("ABCDE-FGHJK");
  });

  test("a newcomer joins the team and the code's projects", async () => {
    const { t, a, projectId, code } = await setup();
    expect(isInviteCode(code)).toBe(true);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(clerkMembership(newcomer.subject));

    const result = await t.withIdentity(newcomer).action(api.inviteCodes.redeem, { code: formatInviteCode(code) });

    expect(result).toEqual({ orgId: "org_a", joined: true, projects: 1 });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/organizations/org_a/memberships");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      user_id: newcomer.subject,
      role: "org:member",
    });
    const overview = await a.query(api.projectAccess.overview, {});
    expect(overview?.grantsByUser[newcomer.subject]).toEqual([projectId]);
    const [row] = (await a.query(api.inviteCodes.list, {}))!;
    expect(row.uses).toBe(1);
  });

  test("an existing member only receives the project grants", async () => {
    const { t, a, projectId, code } = await setup();
    await t.withIdentity(admin).run(async (ctx) => {
      await ctx.db.insert("memberships", {
        orgId: "org_a",
        userId: member.subject,
        role: "org:member",
        active: true,
        updatedAt: 1,
      });
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await t.withIdentity(member).action(api.inviteCodes.redeem, { code });

    expect(result).toEqual({ orgId: "org_a", joined: false, projects: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await a.query(api.projectAccess.overview, {}))?.grantsByUser[member.subject]).toEqual([projectId]);
  });

  test("used-up, revoked and unknown codes are rejected alike", async () => {
    const { t, a, code } = await setup({ maxUses: 1 });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => clerkMembership("x"));
    await t.withIdentity(newcomer).action(api.inviteCodes.redeem, { code });
    // Redeeming again by the same person doesn't consume another use.
    await t.withIdentity(newcomer).action(api.inviteCodes.redeem, { code });

    await expect(t.withIdentity({ subject: "user_other" }).action(api.inviteCodes.redeem, { code })).rejects.toThrow(
      /invalid or has expired/,
    );
    await expect(t.withIdentity(newcomer).action(api.inviteCodes.redeem, { code: "ZZZZZ-ZZZZZ" })).rejects.toThrow(
      /invalid or has expired/,
    );

    const [row] = (await a.query(api.inviteCodes.list, {}))!;
    await a.mutation(api.inviteCodes.revoke, { id: row._id });
    await expect(t.withIdentity(newcomer).action(api.inviteCodes.redeem, { code })).rejects.toThrow(
      /invalid or has expired/,
    );
  });

  test("a failed Clerk call gives the use back", async () => {
    const { t, a, code } = await setup({ maxUses: 1 });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: "Organization is full" }] }), { status: 403 }),
    );
    await expect(t.withIdentity(newcomer).action(api.inviteCodes.redeem, { code })).rejects.toThrow(/full/);
    const [row] = (await a.query(api.inviteCodes.list, {}))!;
    expect(row.uses).toBe(0);
  });

  test("only admins create or list codes", async () => {
    const { t } = await setup();
    const m = t.withIdentity(member);
    await expect(m.action(api.inviteCodes.create, { projectIds: [], expiresInDays: 7 })).rejects.toThrow(/admins/);
    expect(await m.query(api.inviteCodes.list, {})).toBeNull();
  });
});
