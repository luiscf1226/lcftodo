import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const alice = { subject: "user_alice", name: "Alice", org_id: "org_a", org_role: "org:admin" };
const bob = { subject: "user_bob", name: "Bob", org_id: "org_a", org_role: "org:member" };

const newTest = () => convexTest(schema, modules);

const userRow = (t: ReturnType<typeof newTest>, clerkId: string) =>
  t.run((ctx) =>
    ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
      .unique(),
  );

describe("users.onboardingStatus", () => {
  test("returns null when signed out", async () => {
    const t = newTest();
    expect(await t.query(api.users.onboardingStatus, {})).toBeNull();
  });

  test("is not completed for a brand new user without a row", async () => {
    const a = newTest().withIdentity(alice);
    expect(await a.query(api.users.onboardingStatus, {})).toEqual({ completed: false, completedAt: null });
  });

  test("is not completed for an existing user row without the field", async () => {
    const t = newTest();
    // Rows created before the field existed have no onboardingCompletedAt.
    await t.run((ctx) => ctx.db.insert("users", { clerkId: "user_alice", name: "Alice" }));
    expect(await t.withIdentity(alice).query(api.users.onboardingStatus, {})).toEqual({
      completed: false,
      completedAt: null,
    });
  });
});

describe("users.completeOnboarding", () => {
  test("rejects signed-out callers", async () => {
    const t = newTest();
    await expect(t.mutation(api.users.completeOnboarding, {})).rejects.toThrow(/Not signed in/);
  });

  test("marks only the caller as completed", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-23T10:00:00Z"));
      const t = newTest();
      const a = t.withIdentity(alice);
      const b = t.withIdentity(bob);
      await a.mutation(api.users.store, {});
      await b.mutation(api.users.store, {});

      await a.mutation(api.users.completeOnboarding, {});

      const at = new Date("2026-09-23T10:00:00Z").getTime();
      expect(await a.query(api.users.onboardingStatus, {})).toEqual({ completed: true, completedAt: at });
      expect(await b.query(api.users.onboardingStatus, {})).toEqual({ completed: false, completedAt: null });
    } finally {
      vi.useRealTimers();
    }
  });

  test("creates the user row if store hasn't run yet", async () => {
    const t = newTest();
    await t.withIdentity(alice).mutation(api.users.completeOnboarding, {});
    const row = await userRow(t, "user_alice");
    expect(row).toMatchObject({ clerkId: "user_alice", name: "Alice" });
    expect(row?.onboardingCompletedAt).toEqual(expect.any(Number));
  });

  test("is idempotent and keeps the first completion time", async () => {
    vi.useFakeTimers();
    try {
      const t = newTest();
      const a = t.withIdentity(alice);
      vi.setSystemTime(new Date("2026-09-23T10:00:00Z"));
      await a.mutation(api.users.completeOnboarding, {});
      vi.setSystemTime(new Date("2026-09-24T10:00:00Z"));
      await a.mutation(api.users.completeOnboarding, {});
      expect((await userRow(t, "user_alice"))?.onboardingCompletedAt).toBe(new Date("2026-09-23T10:00:00Z").getTime());
    } finally {
      vi.useRealTimers();
    }
  });

  test("store keeps the completion when it refreshes the profile", async () => {
    const t = newTest();
    const a = t.withIdentity(alice);
    await a.mutation(api.users.store, {});
    await a.mutation(api.users.completeOnboarding, {});
    await t.withIdentity({ ...alice, name: "Alice Renamed" }).mutation(api.users.store, {});
    const row = await userRow(t, "user_alice");
    expect(row?.name).toBe("Alice Renamed");
    expect((await a.query(api.users.onboardingStatus, {}))?.completed).toBe(true);
  });
});
